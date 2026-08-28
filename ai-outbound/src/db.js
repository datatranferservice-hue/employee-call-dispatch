import pg from "pg";

const { Pool } = pg;

function normalizedConnectionString(raw) {
  if (!raw) throw new Error("DATABASE_URL is required");
  const url = new URL(raw);
  // Preserve the current strict TLS behavior explicitly ahead of pg v9 semantics.
  if (url.searchParams.get("sslmode") === "require") url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}

export const pool = new Pool({
  connectionString: normalizedConnectionString(process.env.DATABASE_URL),
  max: Number(process.env.DB_POOL_MAX || 5),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

export const query = (text, params = []) => pool.query(text, params);

export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function healthcheck() {
  const result = await query("SELECT now() database_time");
  return result.rows[0];
}
