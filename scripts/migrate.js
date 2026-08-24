import {
  readFile
} from "node:fs/promises";

import crypto from "node:crypto";

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

    const ownerEmail = String(process.env.BOOTSTRAP_OWNER_EMAIL || "").trim().toLowerCase();
    const ownerPassword = String(process.env.BOOTSTRAP_OWNER_PASSWORD || "");
    const ownerName = String(process.env.BOOTSTRAP_OWNER_NAME || "Cezar Morris").trim();
    const companyName = String(process.env.BOOTSTRAP_COMPANY_NAME || "Employee Call Dispatch").trim();

    if (ownerEmail && ownerPassword) {
      if (ownerPassword.length < 12) throw new Error("BOOTSTRAP_OWNER_PASSWORD must contain at least 12 characters");
      const existing = await client.query("SELECT id FROM users WHERE lower(email)=lower($1) LIMIT 1", [ownerEmail]);
      if (!existing.rowCount) {
        const salt = crypto.randomBytes(16).toString("hex");
        const key = await new Promise((resolve, reject) =>
          crypto.scrypt(ownerPassword, salt, 64, (error, value) => error ? reject(error) : resolve(value))
        );
        const passwordHash = "scrypt$" + salt + "$" + key.toString("hex");
        const organization = await client.query("INSERT INTO organizations(name) VALUES($1) RETURNING id", [companyName]);
        await client.query("INSERT INTO organization_settings(organization_id) VALUES($1)", [organization.rows[0].id]);
        const user = await client.query(`INSERT INTO users(organization_id,name,email,password_hash,role)
          VALUES($1,$2,$3,$4,'owner') RETURNING id`,
          [organization.rows[0].id, ownerName, ownerEmail, passwordHash]);
        await client.query(`INSERT INTO employees(organization_id,user_id,phone_verified,phone_approved)
          VALUES($1,$2,true,true)`, [organization.rows[0].id, user.rows[0].id]);
        console.log("Initial owner account created.");
      } else {
        console.log("Owner account already exists; bootstrap skipped.");
      }
    }

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
