import { createHash } from "node:crypto";
import type { SpotifyPlaylistItem } from "../spotify/types.js";

export interface CanonicalItem {
  position: number;
  occurrenceKey: string;
  uri: string | null;
  type: string;
  name: string;
  artists: string;
  spotifyUrl: string | null;
  addedAt: Date | null;
}

export interface ChangeEvent {
  type:
    | "title_changed"
    | "description_changed"
    | "item_added"
    | "item_removed"
    | "items_reordered";
  summary: string;
  details: Record<string, unknown>;
}

export function canonicalizeItems(items: SpotifyPlaylistItem[]): CanonicalItem[] {
  const occurrences = new Map<string, number>();
  return items.map((entry, position) => {
    const uri = entry.item?.uri ?? null;
    const identity = uri ?? `unavailable:${position}`;
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return {
      position,
      occurrenceKey: `${identity}#${occurrence}`,
      uri,
      type: entry.item?.type ?? "unavailable",
      name: entry.item?.name ?? "Unavailable item",
      artists: entry.item?.artists?.map((artist) => artist.name).join(", ") ?? "",
      spotifyUrl: entry.item?.external_urls?.spotify ?? null,
      addedAt: entry.added_at ? new Date(entry.added_at) : null,
    };
  });
}

export function contentHash(items: CanonicalItem[]): string {
  const serializable = items.map(({ occurrenceKey, uri, type }) => ({ occurrenceKey, uri, type }));
  return createHash("sha256").update(`v1:${JSON.stringify(serializable)}`).digest("hex");
}

export function diffItems(previous: CanonicalItem[], current: CanonicalItem[]): ChangeEvent[] {
  const before = new Map(previous.map((item) => [item.occurrenceKey, item]));
  const after = new Map(current.map((item) => [item.occurrenceKey, item]));
  const events: ChangeEvent[] = [];

  for (const item of current) {
    if (!before.has(item.occurrenceKey)) {
      events.push({
        type: "item_added",
        summary: `Added ${item.name}`,
        details: { name: item.name, uri: item.uri, position: item.position },
      });
    }
  }
  for (const item of previous) {
    if (!after.has(item.occurrenceKey)) {
      events.push({
        type: "item_removed",
        summary: `Removed ${item.name}`,
        details: { name: item.name, uri: item.uri, previousPosition: item.position },
      });
    }
  }

  const previousSurvivors = previous
    .filter((item) => after.has(item.occurrenceKey))
    .map((item) => item.occurrenceKey);
  const currentSurvivors = current
    .filter((item) => before.has(item.occurrenceKey))
    .map((item) => item.occurrenceKey);
  if (previousSurvivors.some((key, index) => key !== currentSurvivors[index])) {
    events.push({
      type: "items_reordered",
      summary: "Reordered playlist items",
      details: { previousOrder: previousSurvivors, currentOrder: currentSurvivors },
    });
  }

  return events;
}
