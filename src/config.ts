import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_BASE_URL: z.string().url(),
  ADMIN_PASSWORD: z.string().min(12),
  SESSION_SECRET: z.string().min(32),
  DATABASE_URL: z.string().startsWith("mysql"),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  SPOTIFY_CLIENT_ID: z.string().min(1),
  SPOTIFY_CLIENT_SECRET: z.string().min(1),
  SPOTIFY_REDIRECT_URI: z.string().url(),
  POLL_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(10),
  POLL_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cached) return cached;

  const result = schema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  cached = result.data;
  return cached;
}
