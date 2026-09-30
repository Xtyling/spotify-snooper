import { runMigrations } from "./db/migrations.js";
import { closePool } from "./db/pool.js";
import { runPollingBatch } from "./monitoring/scheduler.js";

async function run(): Promise<void> {
  const applied = await runMigrations();
  if (applied.length > 0) console.log(`Applied migrations: ${applied.join(", ")}`);
  await runPollingBatch();
}

run()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
