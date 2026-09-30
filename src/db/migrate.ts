import { closePool } from "./pool.js";
import { runMigrations } from "./migrations.js";

async function migrate(): Promise<void> {
  const applied = await runMigrations();
  console.log(applied.length > 0
    ? `Applied migrations: ${applied.join(", ")}`
    : "Database schema is up to date");
}

migrate()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
