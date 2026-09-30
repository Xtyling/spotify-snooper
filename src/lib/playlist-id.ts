const PLAYLIST_ID = /^[A-Za-z0-9]{10,64}$/u;

export function parsePlaylistId(input: string): string {
  const value = input.trim();
  if (PLAYLIST_ID.test(value)) return value;

  if (value.startsWith("spotify:playlist:")) {
    const id = value.slice("spotify:playlist:".length);
    if (PLAYLIST_ID.test(id)) return id;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a Spotify playlist link, URI, or ID");
  }

  if (url.hostname !== "open.spotify.com") {
    throw new Error("The playlist link must use open.spotify.com");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const playlistIndex = parts.indexOf("playlist");
  const id = playlistIndex >= 0 ? parts[playlistIndex + 1] : undefined;
  if (!id || !PLAYLIST_ID.test(id)) {
    throw new Error("The Spotify playlist link is not valid");
  }
  return id;
}
