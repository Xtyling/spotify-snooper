import { getConfig } from "../config.js";
import {
  createPlaylist,
  getCurrentItems,
  getPlaylist,
  getPlaylistBySpotifyId,
  getSpotifyConnection,
  markPlaylistUnchanged,
  saveChangedPlaylist,
  updateRefreshToken,
  type StoredPlaylist,
} from "../db/repository.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { parsePlaylistId } from "../lib/playlist-id.js";
import { SpotifyApiError, SpotifyClient } from "../spotify/client.js";
import type { SpotifyPlaylistMetadata } from "../spotify/types.js";
import {
  canonicalizeItems,
  contentHash,
  diffItems,
  type CanonicalItem,
  type ChangeEvent,
} from "./diff.js";

function client(): SpotifyClient {
  const config = getConfig();
  return new SpotifyClient({
    clientId: config.SPOTIFY_CLIENT_ID,
    clientSecret: config.SPOTIFY_CLIENT_SECRET,
    redirectUri: config.SPOTIFY_REDIRECT_URI,
  });
}

export async function getAccessToken(): Promise<string> {
  const config = getConfig();
  const connection = await getSpotifyConnection();
  if (!connection) throw new Error("Connect Spotify before adding or polling playlists");
  const refreshToken = decryptSecret(
    connection.encryptedRefreshToken,
    config.TOKEN_ENCRYPTION_KEY,
  );
  const tokens = await client().refreshAccessToken(refreshToken);
  if (tokens.refresh_token) {
    await updateRefreshToken(encryptSecret(tokens.refresh_token, config.TOKEN_ENCRYPTION_KEY));
  }
  return tokens.access_token;
}

function snapshotInput(
  metadata: SpotifyPlaylistMetadata,
  items: CanonicalItem[],
  hash: string,
) {
  return {
    spotifyPlaylistId: metadata.id,
    name: metadata.name,
    description: metadata.description ?? "",
    ownerName: metadata.owner.display_name ?? "Unknown owner",
    spotifyUrl: metadata.external_urls.spotify ?? `https://open.spotify.com/playlist/${metadata.id}`,
    imageUrl: metadata.images[0]?.url ?? null,
    spotifySnapshotId: metadata.snapshot_id,
    contentHash: hash,
    items,
  };
}

async function fetchItems(spotifyPlaylistId: string, accessToken: string): Promise<CanonicalItem[]> {
  try {
    return canonicalizeItems(await client().getAllPlaylistItems(spotifyPlaylistId, accessToken));
  } catch (error) {
    if (error instanceof SpotifyApiError && error.status === 403) {
      throw new Error(
        "Spotify only exposes playlist contents when your account owns the playlist or is a collaborator",
      );
    }
    throw error;
  }
}

export async function addPlaylist(input: string): Promise<string> {
  const spotifyPlaylistId = parsePlaylistId(input);
  const existing = await getPlaylistBySpotifyId(spotifyPlaylistId);
  if (existing) return existing.id;

  const accessToken = await getAccessToken();
  const metadata = await client().getPlaylistMetadata(spotifyPlaylistId, accessToken);
  const items = await fetchItems(spotifyPlaylistId, accessToken);
  return createPlaylist(
    snapshotInput(metadata, items, contentHash(items)),
    getConfig().POLL_INTERVAL_MINUTES,
  );
}

function metadataEvents(
  previous: StoredPlaylist,
  metadata: SpotifyPlaylistMetadata,
): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  const description = metadata.description ?? "";
  if (previous.name !== metadata.name) {
    events.push({
      type: "title_changed",
      summary: `Renamed “${previous.name}” to “${metadata.name}”`,
      details: { before: previous.name, after: metadata.name },
    });
  }
  if (previous.description !== description) {
    events.push({
      type: "description_changed",
      summary: "Changed the playlist description",
      details: { before: previous.description, after: description },
    });
  }
  return events;
}

export async function pollPlaylist(id: string): Promise<"changed" | "unchanged"> {
  const previous = await getPlaylist(id);
  if (!previous) throw new Error("Playlist monitor not found");

  const accessToken = await getAccessToken();
  const metadata = await client().getPlaylistMetadata(previous.spotifyPlaylistId, accessToken);
  const events = metadataEvents(previous, metadata);
  const spotifySnapshotChanged = metadata.snapshot_id !== previous.spotifySnapshotId;

  if (!spotifySnapshotChanged && events.length === 0) {
    await markPlaylistUnchanged(id, getConfig().POLL_INTERVAL_MINUTES);
    return "unchanged";
  }

  const oldItems = await getCurrentItems(id);
  const items = spotifySnapshotChanged
    ? await fetchItems(previous.spotifyPlaylistId, accessToken)
    : oldItems;
  const hash = contentHash(items);
  if (spotifySnapshotChanged) events.push(...diffItems(oldItems, items));

  await saveChangedPlaylist(
    id,
    snapshotInput(metadata, items, hash),
    events,
    getConfig().POLL_INTERVAL_MINUTES,
  );
  return events.length > 0 ? "changed" : "unchanged";
}
