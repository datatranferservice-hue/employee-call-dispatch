import express from "express";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { query, transaction, healthcheck } from "./db.js";
import { chooseEmployee, isWithinBusinessHours, normalizeStrategy } from "./routing.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
const allowedOrigins = new Set(String(process.env.ALLOWED_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean));

app.set("trust proxy", Number(process.env.TRUST_PROXY || 1));
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'"
  });
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.size === 0 || allowedOrigins.has(origin))) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CallFlow-Signature");
    res.set("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({
  limit: process.env.MAX_JSON_BODY || "1mb",
  verify: (req, _res, buffer) => { req.rawBody = buffer; }
}));
app.get("/", (_req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.get("/index.html", (_req, res) => res.sendFile(path.join(ROOT, "index.html")));

const jsonError = (res, status, message) => res.status(status).json({ ok: false, error: message });
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const safeEqual = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
const passwordHash = async password => {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key)));
  return "scrypt$" + salt + "$" + derived.toString("hex");
};
const passwordValid = async (password, stored) => {
  const [algorithm, salt, encoded] = String(stored).split("$");
  if (algorithm !== "scrypt" || !salt || !encoded) return false;
  const derived = await new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key)));
  return safeEqual(derived.toString("hex"), encoded);
};
async function audit(organizationId, actorUserId, eventType, metadata = {}) {
  await query("INSERT INTO audit_events(organization_id,actor_user_id,event_type,metadata) VALUES($1,$2,$3,$4)", [organizationId, actorUserId || null, eventType, metadata]);
}
async function auth(req, res, next) {
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return jsonError(res, 401, "Authentication required");
    const result = await query(`SELECT u.id,u.organization_id,u.name,u.email,u.role,u.active,e.id employee_id
      FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN employees e ON e.user_id=u.id
      WHERE s.token_hash=$1 AND s.expires_at>now()`, [sha256(token)]);
    if (!result.rowCount || !result.rows[0].active) return jsonError(res, 401, "Session expired or account inactive");
    req.user = result.rows[0];
    next();
  } catch (error) { next(error); }
}
const requireRole = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : jsonError(res, 403, "Insufficient permission");
const webhookAuthorized = req => {
  const secret = process.env.TELEPHONY_WEBHOOK_SECRET;
  if (process.env.NODE_ENV === "production" && !secret) return { ok: false, status: 503, error: "Telephony webhook is not configured" };
  if (!secret) return { ok: true };
  const supplied = String(req.headers["x-callflow-signature"] || "");
  const expected = crypto.createHmac("sha256", secret).update(req.rawBody || Buffer.alloc(0)).digest("hex");
  return safeEqual(supplied, expected)
    ? { ok: true }
    : { ok: false, status: 401, error: "Invalid webhook signature" };
};

app.get("/api/health", async (_req, res, next) => {
  try {
    const database = await healthcheck();
    res.json({ ok: true, service: "CallFlow Command", version: "2.1.0", database: "connected", databaseTime: database.database_time });
  } catch (error) { next(error); }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || !password) return jsonError(res, 400, "Email and password are required");
    const result = await query("SELECT * FROM users WHERE email=$1 AND active=true ORDER BY created_at LIMIT 1", [email]);
    if (!result.rowCount || !(await passwordValid(password, result.rows[0].password_hash))) {
      await new Promise(resolve => setTimeout(resolve, 350));
      return jsonError(res, 401, "Incorrect email or password");
    }
    const user = result.rows[0];
    const token = crypto.randomBytes(32).toString("base64url");
    await query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+($3 || ' hours')::interval)", [sha256(token), user.id, SESSION_HOURS]);
    await audit(user.organization_id, user.id, "auth.login", { ip: req.ip });
    res.json({ ok: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (error) { next(error); }
});
app.post("/api/auth/logout", auth, async (req, res, next) => {
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    await query("DELETE FROM sessions WHERE token_hash=$1", [sha256(token)]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});
app.get("/api/me", auth, (req, res) => res.json({ ok: true, user: req.user }));

app.get("/api/dashboard", auth, async (req, res, next) => {
  try {
    const org = req.user.organization_id;
    const [employees, calls, appointments, settings, events] = await Promise.all([
      query(`SELECT e.*,u.name,u.email,u.role,
        (SELECT clock_in FROM shifts WHERE employee_id=e.id AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1) clock_in
        FROM employees e LEFT JOIN users u ON u.id=e.user_id WHERE e.organization_id=$1 ORDER BY u.name`, [org]),
      query("SELECT * FROM calls WHERE organization_id=$1 ORDER BY started_at DESC LIMIT 100", [org]),
      query(`SELECT a.*,u.name employee_name FROM appointments a LEFT JOIN employees e ON e.id=a.employee_id
        LEFT JOIN users u ON u.id=e.user_id WHERE a.organization_id=$1 ORDER BY scheduled_at LIMIT 100`, [org]),
      query("SELECT * FROM organization_settings WHERE organization_id=$1", [org]),
      query("SELECT * FROM audit_events WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100", [org])
    ]);
    res.json({ ok: true, employees: employees.rows, calls: calls.rows, appointments: appointments.rows, settings: settings.rows[0], audit: events.rows });
  } catch (error) { next(error); }
});

app.post("/api/admin/employees", auth, requireRole("owner", "admin"), async (req, res, next) => {
  try {
    const { name, email, password, role = "employee", forwardingPhone } = req.body || {};
    if (!name || !email || !password || password.length < 12) return jsonError(res, 400, "Name, email and a password of at least 12 characters are required");
    const hash = await passwordHash(password);
    const result = await transaction(async client => {
      const user = await client.query(`INSERT INTO users(organization_id,name,email,password_hash,role)
        VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,role`, [req.user.organization_id, name, String(email).toLowerCase(), hash, role]);
      const employee = await client.query(`INSERT INTO employees(organization_id,user_id,forwarding_phone)
        VALUES($1,$2,$3) RETURNING *`, [req.user.organization_id, user.rows[0].id, forwardingPhone || null]);
      return { user: user.rows[0], employee: employee.rows[0] };
    });
    await audit(req.user.organization_id, req.user.id, "employee.created", { employeeId: result.employee.id, email: result.user.email });
    res.status(201).json({ ok: true, ...result });
  } catch (error) { next(error); }
});
app.patch("/api/admin/employees/:id", auth, requireRole("owner", "admin"), async (req, res, next) => {
  try {
    const fields = req.body || {};
    const result = await query(`UPDATE employees SET
      forwarding_phone=COALESCE($3,forwarding_phone),
      phone_verified=COALESCE($4,phone_verified),
      phone_approved=COALESCE($5,phone_approved),
      active=COALESCE($6,active),
      busy=COALESCE($7,busy)
      WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [req.params.id, req.user.organization_id, fields.forwardingPhone, fields.phoneVerified, fields.phoneApproved, fields.active, fields.busy]);
    if (!result.rowCount) return jsonError(res, 404, "Employee not found");
    await audit(req.user.organization_id, req.user.id, "employee.updated", { employeeId: req.params.id, fields: Object.keys(fields) });
    res.json({ ok: true, employee: result.rows[0] });
  } catch (error) { next(error); }
});
app.post("/api/me/duty", auth, requireRole("employee", "admin", "owner"), async (req, res, next) => {
  try {
    if (!req.user.employee_id) return jsonError(res, 400, "This account has no employee profile");
    const onDuty = Boolean(req.body?.onDuty);
    await transaction(async client => {
      await client.query("UPDATE employees SET on_duty=$1,busy=false WHERE id=$2 AND organization_id=$3", [onDuty, req.user.employee_id, req.user.organization_id]);
      if (onDuty) {
        await client.query("UPDATE shifts SET clock_out=now() WHERE employee_id=$1 AND clock_out IS NULL", [req.user.employee_id]);
        await client.query("INSERT INTO shifts(organization_id,employee_id) VALUES($1,$2)", [req.user.organization_id, req.user.employee_id]);
      } else {
        await client.query("UPDATE shifts SET clock_out=now() WHERE employee_id=$1 AND clock_out IS NULL", [req.user.employee_id]);
      }
    });
    await audit(req.user.organization_id, req.user.id, onDuty ? "shift.started" : "shift.ended");
    res.json({ ok: true, onDuty });
  } catch (error) { next(error); }
});

app.post("/api/appointments", auth, async (req, res, next) => {
  try {
    const { employeeId, customerName, customerPhone, scheduledAt, notes } = req.body || {};
    if (!customerName || !scheduledAt) return jsonError(res, 400, "Customer name and scheduled time are required");
    const result = await query(`INSERT INTO appointments(organization_id,employee_id,customer_name,customer_phone,scheduled_at,notes)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [req.user.organization_id, employeeId || req.user.employee_id, customerName, customerPhone || null, scheduledAt, notes || null]);
    await audit(req.user.organization_id, req.user.id, "appointment.created", { appointmentId: result.rows[0].id });
    res.status(201).json({ ok: true, appointment: result.rows[0] });
  } catch (error) { next(error); }
});

async function routeInbound(organizationId, callerPhone, providerCallId) {
  return transaction(async client => {
    const settingsResult = await client.query("SELECT * FROM organization_settings WHERE organization_id=$1 FOR UPDATE", [organizationId]);
    const settings = settingsResult.rows[0];
    if (!settings) throw new Error("Organization settings missing");
    if (!isWithinBusinessHours(new Date(), settings.timezone || "America/Phoenix", settings.business_hours, settings.closed_override)) {
      const call = await client.query(`INSERT INTO calls(organization_id,provider_call_id,caller_phone,status,metadata)
        VALUES($1,$2,$3,'after_hours',$4) ON CONFLICT(provider_call_id) DO UPDATE SET metadata=EXCLUDED.metadata RETURNING *`,
        [organizationId, providerCallId, callerPhone, { message: settings.after_hours_message }]);
      return { mode: "after_hours", call: call.rows[0], message: settings.after_hours_message, overflow: settings.overflow_action };
    }
    const employees = await client.query(`SELECT * FROM employees WHERE organization_id=$1 AND active=true
      AND on_duty=true AND busy=false AND phone_verified=true AND phone_approved=true AND forwarding_phone IS NOT NULL FOR UPDATE SKIP LOCKED`, [organizationId]);
    const selected = chooseEmployee(employees.rows, normalizeStrategy(settings.routing_strategy), settings.route_cursor);
    if (!selected) {
      const call = await client.query(`INSERT INTO calls(organization_id,provider_call_id,caller_phone,status)
        VALUES($1,$2,$3,'overflow') ON CONFLICT(provider_call_id) DO UPDATE SET status='overflow' RETURNING *`, [organizationId, providerCallId, callerPhone]);
      return { mode: "overflow", call: call.rows[0], overflow: settings.overflow_action };
    }
    await client.query("UPDATE employees SET busy=true,routed_calls=routed_calls+1,last_routed_at=now() WHERE id=$1", [selected.id]);
    await client.query("UPDATE organization_settings SET route_cursor=route_cursor+1,updated_at=now() WHERE organization_id=$1", [organizationId]);
    const call = await client.query(`INSERT INTO calls(organization_id,employee_id,provider_call_id,caller_phone,status)
      VALUES($1,$2,$3,$4,'routing') ON CONFLICT(provider_call_id) DO UPDATE SET employee_id=EXCLUDED.employee_id,status='routing' RETURNING *`,
      [organizationId, selected.id, providerCallId, callerPhone]);
    return { mode: "route", call: call.rows[0], employee: { id: selected.id, phone: selected.forwarding_phone }, ringSeconds: settings.ring_seconds, maxAttempts: settings.max_attempts };
  });
}

app.post("/api/webhooks/telephony/inbound", async (req, res, next) => {
  try {
    const authorization = webhookAuthorized(req);
    if (!authorization.ok) return jsonError(res, authorization.status, authorization.error);
    const { organizationId, callerPhone, providerCallId } = req.body || {};
    if (!organizationId || !providerCallId) return jsonError(res, 400, "organizationId and providerCallId are required");
    const route = await routeInbound(organizationId, callerPhone || null, providerCallId);
    res.json({ ok: true, ...route });
  } catch (error) { next(error); }
});

app.post("/api/webhooks/telephony/status", async (req, res, next) => {
  try {
    const authorization = webhookAuthorized(req);
    if (!authorization.ok) return jsonError(res, authorization.status, authorization.error);
    const { providerCallId, status } = req.body || {};
    if (!providerCallId || !status) return jsonError(res, 400, "providerCallId and status are required");
    const result = await query(`UPDATE calls SET status=$2,answered_at=CASE WHEN $2='answered' THEN now() ELSE answered_at END,
      ended_at=CASE WHEN $2 IN ('completed','failed','busy','no_answer') THEN now() ELSE ended_at END
      WHERE provider_call_id=$1 RETURNING organization_id,employee_id`, [providerCallId, status]);
    if (result.rowCount && ["completed", "failed", "busy", "no_answer"].includes(status)) {
      await query("UPDATE employees SET busy=false WHERE id=$1", [result.rows[0].employee_id]);
    }
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.use((req, res) => jsonError(res, 404, "Route not found"));
app.use((error, _req, res, _next) => {
  console.error(error);
  const message = process.env.NODE_ENV === "production" ? "Internal server error" : error.message;
  jsonError(res, 500, message);
});

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, "0.0.0.0", () => console.log(`CallFlow Command listening on ${PORT}`));
}

export { app, passwordHash, passwordValid, routeInbound };
