import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { closePool, getPool, inTransaction } from "./pool.js";

async function migrate(): Promise<void> {
  const directory = resolve(process.cwd(), "migrations");
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  await getPool().query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  for (const file of files) {
    const [rows] = await getPool().query(
      "SELECT name FROM schema_migrations WHERE name = ?",
      [file],
    );
    if (Array.isArray(rows) && rows.length > 0) continue;

    const sql = await readFile(resolve(directory, file), "utf8");
    const statements = sql
      .split(/;\s*(?:\r?\n|$)/u)
      .map((statement) => statement.trim())
      .filter(Boolean);

    await inTransaction(async (connection) => {
      for (const statement of statements) await connection.query(statement);
      await connection.query("INSERT INTO schema_migrations (name) VALUES (?)", [file]);
    });
    console.log(`Applied migration ${file}`);
  }
}

migrate()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
