import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

if (!config.database.url) {
  throw new Error(
    "DATABASE_URL is required to start CallFlow Command."
  );
}

export const pool = new Pool({
  connectionString: config.database.url,

  ssl: config.database.ssl
    ? { rejectUnauthorized: false }
    : false,

  max: 20,

  idleTimeoutMillis: 30_000,

  connectionTimeoutMillis: 10_000,

  application_name:
    "callflow-command"
});

pool.on("error", error => {
  console.error(
    "[DATABASE] Unexpected PostgreSQL pool error:",
    error
  );
});

export async function query(text, params = []) {
  return pool.query(text, params);
}

export async function one(text, params = []) {
  const result = await pool.query(text, params);

  return result.rows[0] || null;
}

export async function many(text, params = []) {
  const result = await pool.query(text, params);

  return result.rows;
}

export async function transaction(work) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await work(client);

    await client.query("COMMIT");

    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function healthCheck() {
  const started = Date.now();

  const result = await pool.query(`
    SELECT
      NOW() AS database_time,
      current_database() AS database_name
  `);

  return {
    ok: true,
    responseMs: Date.now() - started,
    database:
      result.rows[0].database_name,
    time:
      result.rows[0].database_time
  };
}

export async function closeDatabase() {
  await pool.end();
}
