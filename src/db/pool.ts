import mysql, { type Pool, type PoolConnection } from "mysql2/promise";
import { getConfig } from "../config.js";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const config = getConfig();
    pool = mysql.createPool({
      host: config.DB_HOST,
      port: config.DB_PORT,
      database: config.DB_NAME,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      connectionLimit: 5,
      dateStrings: false,
      decimalNumbers: true,
      enableKeepAlive: true,
    });
  }
  return pool;
}

export async function inTransaction<T>(
  work: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
