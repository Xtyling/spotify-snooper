import { getConfig } from "../config.js";
import { claimDuePlaylists, markPlaylistFailed } from "../db/repository.js";
import { SpotifyApiError } from "../spotify/client.js";
import { pollPlaylist } from "./service.js";

interface PollLogger {
  info(message: string): void;
  error(message: string): void;
}

export async function runPollingBatch(logger: PollLogger = console): Promise<number> {
  const due = await claimDuePlaylists(getConfig().POLL_BATCH_SIZE);
  if (due.length > 0) logger.info(`Claimed ${due.length} due playlist(s)`);

  for (const playlist of due) {
    try {
      const result = await pollPlaylist(playlist.id);
      logger.info(`${playlist.name}: ${result}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown polling failure";
      const retryAfter = error instanceof SpotifyApiError
        ? error.retryAfterSeconds
        : undefined;
      await markPlaylistFailed(playlist.id, message, retryAfter ?? 300);
      logger.error(`${playlist.name}: ${message}`);
    }
  }

  return due.length;
}

export function startPollingScheduler(logger: PollLogger = console): () => void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await runPollingBatch(logger);
    } catch (error) {
      logger.error(error instanceof Error ? error.message : "Automatic polling failed");
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(
    () => void tick(),
    getConfig().SCHEDULER_INTERVAL_SECONDS * 1000,
  );
  return () => clearInterval(timer);
}
