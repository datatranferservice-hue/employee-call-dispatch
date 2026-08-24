import crypto from "node:crypto";
import { transaction, pool } from "../src/db.js";

const [name, email, password, company = "CallFlow Command"] = process.argv.slice(2);
if (!name || !email || !password || password.length < 12) {
  console.error("Usage: npm run create-owner -- \"Owner Name\" owner@example.com \"12+ character password\" \"Company Name\"");
  process.exit(1);
}
const passwordHash = async value => {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await new Promise((resolve, reject) => crypto.scrypt(value, salt, 64, (error, result) => error ? reject(error) : resolve(result)));
  return "scrypt$" + salt + "$" + key.toString("hex");
};

try {
  const result = await transaction(async client => {
    const organization = await client.query("INSERT INTO organizations(name) VALUES($1) RETURNING *", [company]);
    await client.query("INSERT INTO organization_settings(organization_id) VALUES($1)", [organization.rows[0].id]);
    const user = await client.query(`INSERT INTO users(organization_id,name,email,password_hash,role)
      VALUES($1,$2,$3,$4,'owner') RETURNING id,name,email,role`,
      [organization.rows[0].id, name, email.toLowerCase(), await passwordHash(password)]);
    const employee = await client.query(`INSERT INTO employees(organization_id,user_id,phone_verified,phone_approved)
      VALUES($1,$2,true,true) RETURNING id`, [organization.rows[0].id, user.rows[0].id]);
    return { organization: organization.rows[0], user: user.rows[0], employeeId: employee.rows[0].id };
  });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} finally {
  await pool.end();
}
