import { describe, expect, it } from "vitest";
import { parsePlaylistId } from "../src/lib/playlist-id.js";

const id = "37i9dQZF1DXcBWIGoYBM5M";

describe("parsePlaylistId", () => {
  it("accepts URLs, URIs, and raw IDs", () => {
    expect(parsePlaylistId(`https://open.spotify.com/playlist/${id}?si=test`)).toBe(id);
    expect(parsePlaylistId(`spotify:playlist:${id}`)).toBe(id);
    expect(parsePlaylistId(id)).toBe(id);
  });

  it("rejects non-Spotify links", () => {
    expect(() => parsePlaylistId(`https://example.com/playlist/${id}`)).toThrow();
  });
});
