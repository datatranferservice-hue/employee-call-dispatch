import {
  readFile
} from "node:fs/promises";

import {
  fileURLToPath
} from "node:url";

import {
  dirname,
  join
} from "node:path";

import {
  pool
} from "../src/db.js";

const currentFile =
  fileURLToPath(import.meta.url);

const currentDirectory =
  dirname(currentFile);

const schemaPath =
  join(
    currentDirectory,
    "..",
    "schema.sql"
  );

async function migrate() {
  console.log(
    "CallFlow Command database migration starting..."
  );

  const schema =
    await readFile(
      schemaPath,
      "utf8"
    );

  const client =
    await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(schema);

    await client.query("COMMIT");

    console.log(
      "Database migration completed successfully."
    );
  } catch (error) {
    await client.query("ROLLBACK");

    console.error(
      "Database migration failed:"
    );

    console.error(error);

    process.exitCode = 1;
  } finally {
    client.release();

    await pool.end();
  }
}

await migrate();
