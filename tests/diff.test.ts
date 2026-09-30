import { describe, expect, it } from "vitest";
import { canonicalizeItems, contentHash, diffItems } from "../src/monitoring/diff.js";
import type { SpotifyPlaylistItem } from "../src/spotify/types.js";

function item(uri: string, name = uri): SpotifyPlaylistItem {
  return {
    added_at: "2026-01-01T00:00:00Z",
    item: {
      uri,
      name,
      type: "track",
      external_urls: { spotify: `https://open.spotify.com/track/${uri}` },
      artists: [{ name: "Artist" }],
    },
  };
}

describe("playlist diff", () => {
  it("records an insertion without treating shifted items as reordered", () => {
    const before = canonicalizeItems([item("a"), item("b")]);
    const after = canonicalizeItems([item("x"), item("a"), item("b")]);
    expect(diffItems(before, after).map((event) => event.type)).toEqual(["item_added"]);
  });

  it("preserves duplicate occurrences", () => {
    const before = canonicalizeItems([item("a"), item("a")]);
    const after = canonicalizeItems([item("a")]);
    const changes = diffItems(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.type).toBe("item_removed");
  });

  it("detects a reorder", () => {
    const before = canonicalizeItems([item("a"), item("b")]);
    const after = canonicalizeItems([item("b"), item("a")]);
    expect(diffItems(before, after).map((event) => event.type)).toEqual(["items_reordered"]);
  });

  it("produces a stable content hash", () => {
    const items = canonicalizeItems([item("a"), item("b")]);
    expect(contentHash(items)).toBe(contentHash(items));
    expect(contentHash(items)).not.toBe(contentHash([...items].reverse()));
  });
});
