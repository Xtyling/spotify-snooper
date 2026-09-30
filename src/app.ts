import { randomBytes, timingSafeEqual } from "node:crypto";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { getConfig } from "./config.js";
import {
  deletePlaylist,
  getCurrentItems,
  getEvents,
  getPlaylist,
  getSpotifyConnection,
  listPlaylists,
  saveSpotifyConnection,
  setPlaylistStatus,
} from "./db/repository.js";
import { getPool } from "./db/pool.js";
import { encryptSecret } from "./lib/crypto.js";
import { addPlaylist, pollPlaylist } from "./monitoring/service.js";
import { SpotifyClient } from "./spotify/client.js";
import { dashboardPage, loginPage, playlistPage } from "./views.js";

const ADMIN_COOKIE = "snooper_admin";
const OAUTH_STATE_COOKIE = "spotify_oauth_state";

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function redirectWith(
  reply: FastifyReply,
  path: string,
  key: "message" | "error",
  value: string,
) {
  const separator = path.includes("?") ? "&" : "?";
  return reply.redirect(`${path}${separator}${key}=${encodeURIComponent(value)}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred";
}

export async function buildApp() {
  const config = getConfig();
  const app = Fastify({ logger: true, trustProxy: config.NODE_ENV === "production" });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(formbody);
  await app.register(helmet, { contentSecurityPolicy: false });

  app.addHook("onRequest", async (request, reply) => {
    if (
      request.url.startsWith("/login") ||
      request.url.startsWith("/health/") ||
      request.url.startsWith("/auth/spotify/callback")
    ) return;
    const rawCookie = request.cookies[ADMIN_COOKIE];
    const valid = rawCookie ? request.unsignCookie(rawCookie) : null;
    if (!valid?.valid || valid.value !== "owner") return reply.redirect("/login");
  });

  app.get("/login", async (request, reply) => {
    const query = request.query as { error?: string };
    return reply.type("text/html").send(loginPage(query.error));
  });

  app.post("/login", async (request, reply) => {
    const body = request.body as { password?: string };
    if (!body.password || !safeEqual(body.password, config.ADMIN_PASSWORD)) {
      return redirectWith(reply, "/login", "error", "Incorrect password");
    }
    reply.setCookie(ADMIN_COOKIE, "owner", {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: config.NODE_ENV === "production",
      signed: true,
      maxAge: 60 * 60 * 24 * 30,
    });
    return reply.redirect("/");
  });

  app.get("/", async (request, reply) => {
    const query = request.query as { message?: string; error?: string };
    const [connection, playlists] = await Promise.all([
      getSpotifyConnection(),
      listPlaylists(),
    ]);
    return reply.type("text/html").send(dashboardPage({
      connected: Boolean(connection),
      playlists,
      ...(query.message ? { message: query.message } : {}),
      ...(query.error ? { error: query.error } : {}),
    }));
  });

  app.get("/auth/spotify", async (_request, reply) => {
    const state = randomBytes(32).toString("base64url");
    reply.setCookie(OAUTH_STATE_COOKIE, state, {
      path: "/auth/spotify/callback",
      httpOnly: true,
      sameSite: "lax",
      secure: config.NODE_ENV === "production",
      signed: true,
      maxAge: 600,
    });
    const spotify = new SpotifyClient({
      clientId: config.SPOTIFY_CLIENT_ID,
      clientSecret: config.SPOTIFY_CLIENT_SECRET,
      redirectUri: config.SPOTIFY_REDIRECT_URI,
    });
    return reply.redirect(spotify.authorizationUrl(state));
  });

  app.get("/auth/spotify/callback", async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    const signedState = request.cookies[OAUTH_STATE_COOKIE];
    const cookieState = signedState ? request.unsignCookie(signedState) : null;
    reply.clearCookie(OAUTH_STATE_COOKIE, { path: "/auth/spotify/callback" });
    if (query.error) return redirectWith(reply, "/", "error", `Spotify: ${query.error}`);
    if (!query.code || !query.state || !cookieState?.valid || !safeEqual(query.state, cookieState.value)) {
      return redirectWith(reply, "/", "error", "Spotify authorization state did not match");
    }

    try {
      const spotify = new SpotifyClient({
        clientId: config.SPOTIFY_CLIENT_ID,
        clientSecret: config.SPOTIFY_CLIENT_SECRET,
        redirectUri: config.SPOTIFY_REDIRECT_URI,
      });
      const tokens = await spotify.exchangeCode(query.code);
      if (!tokens.refresh_token) throw new Error("Spotify did not return a refresh token");
      const profile = await spotify.getProfile(tokens.access_token);
      const accountId = profile.account_id ?? profile.id;
      if (!accountId) throw new Error("Spotify profile did not include an account ID");
      await saveSpotifyConnection({
        spotifyAccountId: accountId,
        encryptedRefreshToken: encryptSecret(tokens.refresh_token, config.TOKEN_ENCRYPTION_KEY),
        scopes: tokens.scope,
        authorizedAt: new Date(),
      });
      return redirectWith(reply, "/", "message", "Spotify connected");
    } catch (error) {
      request.log.error(error);
      return redirectWith(reply, "/", "error", errorMessage(error));
    }
  });

  app.post("/playlists", async (request, reply) => {
    const body = request.body as { playlist?: string };
    if (!body.playlist) return redirectWith(reply, "/", "error", "Enter a playlist link");
    try {
      const id = await addPlaylist(body.playlist);
      return redirectWith(reply, `/playlists/${id}`, "message", "Playlist logging started");
    } catch (error) {
      request.log.error(error);
      return redirectWith(reply, "/", "error", errorMessage(error));
    }
  });

  app.get("/playlists/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { message?: string; error?: string };
    const playlist = await getPlaylist(id);
    if (!playlist) return reply.code(404).type("text/plain").send("Playlist not found");
    const [items, events] = await Promise.all([getCurrentItems(id), getEvents(id)]);
    return reply.type("text/html").send(
      playlistPage(playlist, items, events, query.message, query.error),
    );
  });

  app.post("/playlists/:id/poll", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await pollPlaylist(id);
      return redirectWith(reply, `/playlists/${id}`, "message", `Check complete: ${result}`);
    } catch (error) {
      request.log.error(error);
      return redirectWith(reply, `/playlists/${id}`, "error", errorMessage(error));
    }
  });

  for (const [action, status] of [["pause", "paused"], ["resume", "active"]] as const) {
    app.post(`/playlists/:id/${action}`, async (request, reply) => {
      const { id } = request.params as { id: string };
      await setPlaylistStatus(id, status);
      return redirectWith(reply, `/playlists/${id}`, "message", `Monitoring ${action}d`);
    });
  }

  app.post("/playlists/:id/delete", async (request, reply) => {
    const { id } = request.params as { id: string };
    await deletePlaylist(id);
    return redirectWith(reply, "/", "message", "Playlist and history deleted");
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      await getPool().query("SELECT 1");
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
  });

  return app;
}
