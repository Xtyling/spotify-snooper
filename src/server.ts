import { buildApp } from "./app.js";
import { getConfig } from "./config.js";
import { runMigrations } from "./db/migrations.js";

async function start(): Promise<void> {
  try {
    const config = getConfig();
    const applied = await runMigrations();
    if (applied.length > 0) console.log(`Applied migrations: ${applied.join(", ")}`);
    const app = await buildApp();
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

void start();
