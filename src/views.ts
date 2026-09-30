import type { StoredEvent, StoredPlaylist } from "./db/repository.js";
import type { CanonicalItem } from "./monitoring/diff.js";
import { escapeHtml, formatDate, layout } from "./lib/html.js";

function notice(message?: string, error?: string): string {
  if (error) return `<p class="card error">${escapeHtml(error)}</p>`;
  if (message) return `<p class="card success">${escapeHtml(message)}</p>`;
  return "";
}

function pollCountdown(playlist: StoredPlaylist): string {
  return `<span class="countdown" data-countdown data-playlist-id="${escapeHtml(playlist.id)}" data-status="${escapeHtml(playlist.status)}" data-next-poll="${escapeHtml(new Date(playlist.nextPollAt).toISOString())}" data-last-error="${escapeHtml(playlist.lastError ?? "")}" title="Next scheduled automated check">⏱ <span>${playlist.status === "paused" ? "Paused" : "Calculating…"}</span></span>`;
}

export function loginPage(error?: string): string {
  return layout("Sign in", `
    <section class="card" style="max-width:30rem;margin:4rem auto">
      <h1>Owner sign in</h1>
      <p class="muted">Enter the dashboard password configured on the server.</p>
      ${notice(undefined, error)}
      <form method="post" action="/login">
        <p><input type="password" name="password" autocomplete="current-password" required autofocus></p>
        <button type="submit">Sign in</button>
      </form>
    </section>`);
}

export function dashboardPage(input: {
  connected: boolean;
  playlists: StoredPlaylist[];
  message?: string;
  error?: string;
}): string {
  const connection = input.connected
    ? `<p class="success">Spotify connected</p>`
    : `<section class="card"><h2>Connect Spotify</h2><p class="muted">Authorize the account that owns or collaborates on the playlists you want to log.</p><a href="/auth/spotify">Connect with Spotify</a></section>`;
  const addForm = input.connected
    ? `<section class="card">
         <h2>Log a playlist</h2>
         <form class="add-form" method="post" action="/playlists">
           <input name="playlist" aria-label="Spotify playlist link" placeholder="https://open.spotify.com/playlist/…" required>
           <button type="submit">Start logging</button>
         </form>
       </section>`
    : "";
  const cards = input.playlists.length
    ? input.playlists.map((playlist) => `
      <article class="card">
        <div class="playlist-head">
          ${playlist.imageUrl ? `<img class="cover" src="${escapeHtml(playlist.imageUrl)}" alt="">` : ""}
          <div><h2><a href="/playlists/${playlist.id}">${escapeHtml(playlist.name)}</a></h2>
          <p class="muted">${playlist.monitoringMode === "metadata_only" ? "Title and description only" : `${playlist.itemCount} items`} · ${escapeHtml(playlist.status)}</p></div>
        </div>
        <p>${escapeHtml(playlist.description || "No description")}</p>
        <p class="muted">Last checked ${formatDate(playlist.lastPolledAt)}</p>
        <p>${pollCountdown(playlist)}</p>
        ${playlist.lastError ? `<p class="error">${escapeHtml(playlist.lastError)}</p>` : ""}
      </article>`).join("")
    : `<p class="muted">No playlists are being logged yet.</p>`;

  return layout("Dashboard", `
    <h1>Playlist change log</h1>
    ${notice(input.message, input.error)}
    ${connection}
    ${addForm}
    <section style="margin-top:2rem"><h2>Monitored playlists</h2><div class="grid">${cards}</div></section>`);
}

function eventDetails(event: StoredEvent): string {
  const text = (key: string): string =>
    typeof event.details[key] === "string" ? event.details[key] : "";
  const position = (key: string): string =>
    typeof event.details[key] === "number"
      ? String((event.details[key] as number) + 1)
      : "";

  if (event.type === "title_changed" || event.type === "description_changed") {
    return `<div class="change-values">
      <div><small class="muted">Before</small><p>${escapeHtml(text("before") || "Empty")}</p></div>
      <div><small class="muted">After</small><p>${escapeHtml(text("after") || "Empty")}</p></div>
    </div>`;
  }
  if (event.type === "item_added") {
    return `<p class="muted">Added at position ${position("position") || "unknown"}.</p>`;
  }
  if (event.type === "item_removed") {
    return `<p class="muted">Previously at position ${position("previousPosition") || "unknown"}.</p>`;
  }
  if (event.type === "items_reordered") {
    const moves = Array.isArray(event.details.moves)
      ? event.details.moves as Array<Record<string, unknown>>
      : [];
    if (moves.length === 0) {
      return `<p class="muted">Detailed positions were not recorded for this older event.</p>`;
    }
    return `<ul>${moves.map((move) => `<li>${escapeHtml(move.name)}: position ${escapeHtml(move.fromPosition)} → ${escapeHtml(move.toPosition)}</li>`).join("")}</ul>`;
  }
  return "";
}

export function playlistPage(
  playlist: StoredPlaylist,
  items: CanonicalItem[],
  events: StoredEvent[],
  message?: string,
  error?: string,
): string {
  const itemList = playlist.monitoringMode === "metadata_only"
    ? `<p class="card muted">Spotify does not expose this playlist's items to your account. Snooper is logging public title and description changes only.</p>`
    : items.length
    ? `<ol class="items">${items.map((item) => `<li>
        ${item.spotifyUrl ? `<a href="${escapeHtml(item.spotifyUrl)}">${escapeHtml(item.name)}</a>` : escapeHtml(item.name)}
        ${item.artists ? `<span class="muted"> — ${escapeHtml(item.artists)}</span>` : ""}
      </li>`).join("")}</ol>`
    : `<p class="muted">This playlist currently has no items.</p>`;
  const history = events.length
    ? events.map((event) => `<article class="event"><strong>${escapeHtml(event.summary)}</strong><br><span class="muted">${formatDate(event.detectedAt)}</span>${eventDetails(event)}</article>`).join("")
    : `<p class="muted">No changes have been detected since logging began.</p>`;

  return layout(playlist.name, `
    ${notice(message, error)}
    <section class="playlist-head">
      ${playlist.imageUrl ? `<img class="cover" src="${escapeHtml(playlist.imageUrl)}" alt="">` : ""}
      <div><h1>${escapeHtml(playlist.name)}</h1><p class="muted">By ${escapeHtml(playlist.ownerName)} · first logged ${formatDate(playlist.initialLoggedAt)}</p>${pollCountdown(playlist)}</div>
    </section>
    <p>${escapeHtml(playlist.description || "No description")}</p>
    <p><a href="${escapeHtml(playlist.spotifyUrl)}">Open in Spotify</a></p>
    <div class="actions">
      <form class="inline" method="post" action="/playlists/${playlist.id}/poll"><button type="submit">Check now</button></form>
      <form class="inline" method="post" action="/playlists/${playlist.id}/${playlist.status === "paused" ? "resume" : "pause"}"><button class="secondary" type="submit">${playlist.status === "paused" ? "Resume" : "Pause"}</button></form>
      <form class="inline" method="post" action="/playlists/${playlist.id}/delete" onsubmit="return confirm('Delete this playlist and its history?')"><button class="secondary" type="submit">Delete</button></form>
    </div>
    ${playlist.lastError ? `<p class="card error">${escapeHtml(playlist.lastError)}</p>` : ""}
    <section style="margin-top:2rem"><h2>Changes</h2>${history}</section>
    <section style="margin-top:2rem"><h2>${playlist.monitoringMode === "metadata_only" ? "Content access" : `Current items (${items.length})`}</h2>${itemList}</section>`);
}
