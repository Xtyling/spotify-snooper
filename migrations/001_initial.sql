CREATE TABLE IF NOT EXISTS spotify_connections (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  spotify_account_id VARCHAR(255) NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  scopes TEXT NOT NULL,
  authorized_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitored_playlists (
  id CHAR(36) NOT NULL PRIMARY KEY,
  spotify_playlist_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  owner_name VARCHAR(255) NOT NULL,
  spotify_url VARCHAR(512) NOT NULL,
  image_url VARCHAR(1024) NULL,
  spotify_snapshot_id VARCHAR(255) NOT NULL,
  content_hash CHAR(64) NOT NULL,
  item_count INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  next_poll_at DATETIME(3) NOT NULL,
  lease_token CHAR(36) NULL,
  lease_expires_at DATETIME(3) NULL,
  last_polled_at DATETIME(3) NOT NULL,
  last_changed_at DATETIME(3) NOT NULL,
  initial_logged_at DATETIME(3) NOT NULL,
  last_error VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_monitored_playlists_spotify_id (spotify_playlist_id),
  KEY ix_monitored_playlists_due (status, next_poll_at),
  KEY ix_monitored_playlists_lease (lease_expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS playlist_snapshots (
  id CHAR(36) NOT NULL PRIMARY KEY,
  monitored_playlist_id CHAR(36) NOT NULL,
  spotify_snapshot_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  item_count INT UNSIGNED NOT NULL,
  observed_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_snapshots_playlist FOREIGN KEY (monitored_playlist_id)
    REFERENCES monitored_playlists(id) ON DELETE CASCADE,
  KEY ix_snapshots_playlist_observed (monitored_playlist_id, observed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS playlist_snapshot_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  snapshot_id CHAR(36) NOT NULL,
  position INT UNSIGNED NOT NULL,
  occurrence_key VARCHAR(600) NOT NULL,
  spotify_item_uri VARCHAR(512) NULL,
  item_type VARCHAR(32) NOT NULL,
  name VARCHAR(500) NOT NULL,
  artists VARCHAR(1000) NOT NULL,
  spotify_url VARCHAR(1024) NULL,
  added_at DATETIME(3) NULL,
  CONSTRAINT fk_snapshot_items_snapshot FOREIGN KEY (snapshot_id)
    REFERENCES playlist_snapshots(id) ON DELETE CASCADE,
  UNIQUE KEY uq_snapshot_position (snapshot_id, position),
  KEY ix_snapshot_items_snapshot (snapshot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS change_events (
  id CHAR(36) NOT NULL PRIMARY KEY,
  monitored_playlist_id CHAR(36) NOT NULL,
  snapshot_id CHAR(36) NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  summary VARCHAR(1000) NOT NULL,
  details_json JSON NOT NULL,
  detected_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_events_playlist FOREIGN KEY (monitored_playlist_id)
    REFERENCES monitored_playlists(id) ON DELETE CASCADE,
  CONSTRAINT fk_events_snapshot FOREIGN KEY (snapshot_id)
    REFERENCES playlist_snapshots(id) ON DELETE CASCADE,
  KEY ix_events_playlist_detected (monitored_playlist_id, detected_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schema_migrations (
  name VARCHAR(255) NOT NULL PRIMARY KEY,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
