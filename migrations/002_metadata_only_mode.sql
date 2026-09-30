ALTER TABLE monitored_playlists
  ADD COLUMN monitoring_mode VARCHAR(32) NOT NULL DEFAULT 'full' AFTER item_count;
