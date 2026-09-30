import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "./pool.js";

interface MigrationRow extends RowDataPacket {
  name: string;
}

interface MigrationLockRow extends RowDataPacket {
  acquired: number;
}

export async function runMigrations(): Promise<string[]> {
  const directory = resolve(process.cwd(), "migrations");
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const connection = await getPool().getConnection();
  const applied: string[] = [];
  let lockAcquired = false;

  try {
    const [lockRows] = await connection.query<MigrationLockRow[]>(
      "SELECT GET_LOCK('spotify_snooper_schema_migrations', 30) AS acquired",
    );
    lockAcquired = lockRows[0]?.acquired === 1;
    if (!lockAcquired) throw new Error("Timed out waiting for the database migration lock");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    for (const file of files) {
      const [rows] = await connection.query<MigrationRow[]>(
        "SELECT name FROM schema_migrations WHERE name = ?",
        [file],
      );
      if (rows.length > 0) continue;

      const sql = await readFile(resolve(directory, file), "utf8");
      const statements = sql
        .split(/;\s*(?:\r?\n|$)/u)
        .map((statement) => statement.trim())
        .filter(Boolean);

      for (const statement of statements) await connection.query(statement);
      await connection.query("INSERT INTO schema_migrations (name) VALUES (?)", [file]);
      applied.push(file);
    }

    return applied;
  } finally {
    try {
      if (lockAcquired) {
        await connection.query("SELECT RELEASE_LOCK('spotify_snooper_schema_migrations')");
      }
    } finally {
      connection.release();
    }
  }
}
