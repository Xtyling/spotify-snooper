import { getConfig } from "./config.js";
import { runMigrations } from "./db/migrations.js";
import { closePool } from "./db/pool.js";
import { claimDuePlaylists, markPlaylistFailed } from "./db/repository.js";
import { pollPlaylist } from "./monitoring/service.js";
import { SpotifyApiError } from "./spotify/client.js";

async function run(): Promise<void> {
  const applied = await runMigrations();
  if (applied.length > 0) console.log(`Applied migrations: ${applied.join(", ")}`);
  const due = await claimDuePlaylists(getConfig().POLL_BATCH_SIZE);
  console.log(`Claimed ${due.length} playlist(s)`);
  for (const playlist of due) {
    try {
      const result = await pollPlaylist(playlist.id);
      console.log(`${playlist.name}: ${result}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown polling failure";
      const retryAfter = error instanceof SpotifyApiError
        ? error.retryAfterSeconds
        : undefined;
      await markPlaylistFailed(playlist.id, message, retryAfter ?? 300);
      console.error(`${playlist.name}: ${message}`);
    }
  }
}

run()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
