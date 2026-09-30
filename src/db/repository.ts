import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool, inTransaction } from "./pool.js";
import type { CanonicalItem, ChangeEvent } from "../monitoring/diff.js";

interface ConnectionRow extends RowDataPacket {
  spotifyAccountId: string;
  encryptedRefreshToken: string;
  scopes: string;
  authorizedAt: Date;
}

export interface StoredConnection {
  spotifyAccountId: string;
  encryptedRefreshToken: string;
  scopes: string;
  authorizedAt: Date;
}

export interface StoredPlaylist {
  id: string;
  spotifyPlaylistId: string;
  name: string;
  description: string;
  ownerName: string;
  spotifyUrl: string;
  imageUrl: string | null;
  spotifySnapshotId: string;
  contentHash: string;
  itemCount: number;
  monitoringMode: "full" | "metadata_only";
  status: string;
  nextPollAt: Date;
  lastPolledAt: Date;
  lastChangedAt: Date;
  initialLoggedAt: Date;
  lastError: string | null;
}

interface PlaylistRow extends StoredPlaylist, RowDataPacket {}

interface ItemRow extends RowDataPacket {
  position: number;
  occurrenceKey: string;
  uri: string | null;
  type: string;
  name: string;
  artists: string;
  spotifyUrl: string | null;
  addedAt: Date | null;
}

interface EventRow extends RowDataPacket {
  id: string;
  type: string;
  summary: string;
  detailsJson: string | Record<string, unknown>;
  detectedAt: Date;
}

export interface StoredEvent {
  id: string;
  type: string;
  summary: string;
  details: Record<string, unknown>;
  detectedAt: Date;
}

const PLAYLIST_COLUMNS = `
  id,
  spotify_playlist_id AS spotifyPlaylistId,
  name,
  description,
  owner_name AS ownerName,
  spotify_url AS spotifyUrl,
  image_url AS imageUrl,
  spotify_snapshot_id AS spotifySnapshotId,
  content_hash AS contentHash,
  item_count AS itemCount,
  monitoring_mode AS monitoringMode,
  status,
  next_poll_at AS nextPollAt,
  last_polled_at AS lastPolledAt,
  last_changed_at AS lastChangedAt,
  initial_logged_at AS initialLoggedAt,
  last_error AS lastError
`;

export async function getSpotifyConnection(): Promise<StoredConnection | null> {
  const [rows] = await getPool().query<ConnectionRow[]>(`
    SELECT spotify_account_id AS spotifyAccountId,
           encrypted_refresh_token AS encryptedRefreshToken,
           scopes,
           authorized_at AS authorizedAt
    FROM spotify_connections WHERE id = 1
  `);
  return rows[0] ?? null;
}

export async function saveSpotifyConnection(input: StoredConnection): Promise<void> {
  await getPool().execute(
    `INSERT INTO spotify_connections
       (id, spotify_account_id, encrypted_refresh_token, scopes, authorized_at)
     VALUES (1, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       spotify_account_id = VALUES(spotify_account_id),
       encrypted_refresh_token = VALUES(encrypted_refresh_token),
       scopes = VALUES(scopes),
       authorized_at = VALUES(authorized_at)`,
    [input.spotifyAccountId, input.encryptedRefreshToken, input.scopes, input.authorizedAt],
  );
}

export async function updateRefreshToken(encryptedRefreshToken: string): Promise<void> {
  await getPool().execute(
    "UPDATE spotify_connections SET encrypted_refresh_token = ? WHERE id = 1",
    [encryptedRefreshToken],
  );
}

export async function listPlaylists(): Promise<StoredPlaylist[]> {
  const [rows] = await getPool().query<PlaylistRow[]>(`
    SELECT ${PLAYLIST_COLUMNS}
    FROM monitored_playlists
    ORDER BY created_at DESC
  `);
  return rows;
}

export async function getPlaylist(id: string): Promise<StoredPlaylist | null> {
  const [rows] = await getPool().execute<PlaylistRow[]>(`
    SELECT ${PLAYLIST_COLUMNS}
    FROM monitored_playlists WHERE id = ?
  `, [id]);
  return rows[0] ?? null;
}

export async function getPlaylistBySpotifyId(
  spotifyPlaylistId: string,
): Promise<StoredPlaylist | null> {
  const [rows] = await getPool().execute<PlaylistRow[]>(`
    SELECT ${PLAYLIST_COLUMNS}
    FROM monitored_playlists WHERE spotify_playlist_id = ?
  `, [spotifyPlaylistId]);
  return rows[0] ?? null;
}

export async function getCurrentItems(playlistId: string): Promise<CanonicalItem[]> {
  const [rows] = await getPool().execute<ItemRow[]>(`
    SELECT i.position,
           i.occurrence_key AS occurrenceKey,
           i.spotify_item_uri AS uri,
           i.item_type AS type,
           i.name,
           i.artists,
           i.spotify_url AS spotifyUrl,
           i.added_at AS addedAt
    FROM playlist_snapshot_items i
    INNER JOIN playlist_snapshots s ON s.id = i.snapshot_id
    WHERE s.monitored_playlist_id = ?
      AND s.id = (
        SELECT id FROM playlist_snapshots
        WHERE monitored_playlist_id = ?
        ORDER BY observed_at DESC LIMIT 1
      )
    ORDER BY i.position
  `, [playlistId, playlistId]);
  return rows;
}

export async function getEvents(playlistId: string): Promise<StoredEvent[]> {
  const [rows] = await getPool().execute<EventRow[]>(`
    SELECT id, event_type AS type, summary,
           details_json AS detailsJson, detected_at AS detectedAt
    FROM change_events
    WHERE monitored_playlist_id = ?
    ORDER BY detected_at DESC, id DESC
    LIMIT 250
  `, [playlistId]);
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    summary: row.summary,
    details:
      typeof row.detailsJson === "string"
        ? JSON.parse(row.detailsJson) as Record<string, unknown>
        : row.detailsJson,
    detectedAt: row.detectedAt,
  }));
}

interface SnapshotInput {
  spotifyPlaylistId: string;
  name: string;
  description: string;
  ownerName: string;
  spotifyUrl: string;
  imageUrl: string | null;
  spotifySnapshotId: string;
  contentHash: string;
  monitoringMode: "full" | "metadata_only";
  items: CanonicalItem[];
}

async function insertSnapshot(
  connection: PoolConnection,
  playlistId: string,
  input: SnapshotInput,
  observedAt: Date,
): Promise<string> {
  const snapshotId = randomUUID();
  await connection.execute(
    `INSERT INTO playlist_snapshots
       (id, monitored_playlist_id, spotify_snapshot_id, name, description,
        content_hash, item_count, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [snapshotId, playlistId, input.spotifySnapshotId, input.name, input.description,
      input.contentHash, input.items.length, observedAt],
  );

  for (const item of input.items) {
    await connection.execute(
      `INSERT INTO playlist_snapshot_items
         (snapshot_id, position, occurrence_key, spotify_item_uri, item_type,
          name, artists, spotify_url, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [snapshotId, item.position, item.occurrenceKey, item.uri, item.type,
        item.name, item.artists, item.spotifyUrl, item.addedAt],
    );
  }
  return snapshotId;
}

export async function createPlaylist(input: SnapshotInput, intervalMinutes: number): Promise<string> {
  const playlistId = randomUUID();
  const now = new Date();
  const nextPollAt = new Date(now.getTime() + intervalMinutes * 60_000);
  await inTransaction(async (connection) => {
    await connection.execute(
      `INSERT INTO monitored_playlists
         (id, spotify_playlist_id, name, description, owner_name, spotify_url,
          image_url, spotify_snapshot_id, content_hash, item_count, monitoring_mode, status,
          next_poll_at, last_polled_at, last_changed_at, initial_logged_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      [playlistId, input.spotifyPlaylistId, input.name, input.description,
        input.ownerName, input.spotifyUrl, input.imageUrl, input.spotifySnapshotId,
        input.contentHash, input.items.length, input.monitoringMode, nextPollAt, now, now, now],
    );
    await insertSnapshot(connection, playlistId, input, now);
  });
  return playlistId;
}

export async function saveChangedPlaylist(
  playlistId: string,
  input: SnapshotInput,
  events: ChangeEvent[],
  intervalMinutes: number,
): Promise<void> {
  const now = new Date();
  const nextPollAt = new Date(now.getTime() + intervalMinutes * 60_000);
  await inTransaction(async (connection) => {
    const snapshotId = await insertSnapshot(connection, playlistId, input, now);
    for (const event of events) {
      await connection.execute(
        `INSERT INTO change_events
           (id, monitored_playlist_id, snapshot_id, event_type, summary,
            details_json, detected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), playlistId, snapshotId, event.type, event.summary,
          JSON.stringify(event.details), now],
      );
    }
    await connection.execute(
      `UPDATE monitored_playlists SET
         name = ?, description = ?, owner_name = ?, spotify_url = ?, image_url = ?,
         spotify_snapshot_id = ?, content_hash = ?, item_count = ?, monitoring_mode = ?,
         next_poll_at = ?, last_polled_at = ?, last_changed_at = ?, last_error = NULL,
         lease_token = NULL, lease_expires_at = NULL
       WHERE id = ?`,
      [input.name, input.description, input.ownerName, input.spotifyUrl, input.imageUrl,
        input.spotifySnapshotId, input.contentHash, input.items.length, input.monitoringMode, nextPollAt,
        now, now, playlistId],
    );
  });
}

export async function markPlaylistUnchanged(
  playlistId: string,
  intervalMinutes: number,
): Promise<void> {
  const now = new Date();
  const nextPollAt = new Date(now.getTime() + intervalMinutes * 60_000);
  await getPool().execute(
    `UPDATE monitored_playlists SET last_polled_at = ?, next_poll_at = ?,
       last_error = NULL, lease_token = NULL, lease_expires_at = NULL
     WHERE id = ?`,
    [now, nextPollAt, playlistId],
  );
}

export async function setPlaylistStatus(id: string, status: "active" | "paused"): Promise<void> {
  await getPool().execute(
    "UPDATE monitored_playlists SET status = ?, next_poll_at = NOW(3) WHERE id = ?",
    [status, id],
  );
}

export async function deletePlaylist(id: string): Promise<void> {
  await getPool().execute("DELETE FROM monitored_playlists WHERE id = ?", [id]);
}

export async function claimDuePlaylists(limit: number): Promise<StoredPlaylist[]> {
  return inTransaction(async (connection) => {
    const [rows] = await connection.query<PlaylistRow[]>(`
      SELECT ${PLAYLIST_COLUMNS}
      FROM monitored_playlists
      WHERE status = 'active' AND next_poll_at <= NOW(3)
        AND (lease_expires_at IS NULL OR lease_expires_at < NOW(3))
      ORDER BY next_poll_at
      LIMIT ? FOR UPDATE SKIP LOCKED
    `, [limit]);
    if (rows.length === 0) return [];
    const leaseToken = randomUUID();
    const placeholders = rows.map(() => "?").join(",");
    await connection.query(
      `UPDATE monitored_playlists
       SET lease_token = ?, lease_expires_at = DATE_ADD(NOW(3), INTERVAL 5 MINUTE)
       WHERE id IN (${placeholders})`,
      [leaseToken, ...rows.map((row) => row.id)],
    );
    return rows;
  });
}

export async function markPlaylistFailed(
  id: string,
  message: string,
  retryAfterSeconds = 300,
): Promise<void> {
  const nextPollAt = new Date(Date.now() + retryAfterSeconds * 1000);
  await getPool().execute(
    `UPDATE monitored_playlists SET last_error = ?, next_poll_at = ?,
       lease_token = NULL, lease_expires_at = NULL WHERE id = ?`,
    [message.slice(0, 500), nextPollAt, id],
  );
}
