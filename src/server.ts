import { buildApp } from "./app.js";
import { getConfig } from "./config.js";
import { runMigrations } from "./db/migrations.js";
import { startPollingScheduler } from "./monitoring/scheduler.js";

async function start(): Promise<void> {
  try {
    const config = getConfig();
    const applied = await runMigrations();
    if (applied.length > 0) console.log(`Applied migrations: ${applied.join(", ")}`);
    const app = await buildApp();
    const stopScheduler = startPollingScheduler({
      info: (message) => app.log.info(message),
      error: (message) => app.log.error(message),
    });
    app.addHook("onClose", async () => stopScheduler());
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

void start();
