import { buildApp } from "./app.js";
import { getConfig } from "./config.js";

async function start(): Promise<void> {
  const config = getConfig();
  const app = await buildApp();

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

void start();
