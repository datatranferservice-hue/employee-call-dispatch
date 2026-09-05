import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "./db.js";

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const attempts = new Map();
const clean = (value, max = 500) => String(value || "").trim().slice(0, max);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEAD_STATUSES = new Set(["new", "working", "follow_up", "appointment", "qualified", "not_interested", "closed"]);
const PRIORITIES = new Set(["low", "normal", "high"]);

function leadRateLimit(req, res, next) {
  const key = String(req.ip || req.socket?.remoteAddress || "unknown");
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const current = attempts.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    attempts.set(key, { startedAt: now, count: 1 });
    return next();
  }
  current.count += 1;
  if (current.count > 15) return res.status(429).json({ ok: false, error: "Too many requests. Please try again later." });
  next();
}

function salesAuth(req, res, next) {
  const password = String(process.env.SALES_DESK_PASSWORD || "");
  if (!password) return res.status(503).send("Sales desk access is not configured.");
  const authorization = String(req.headers.authorization || "");
  const encoded = authorization.startsWith("Basic ") ? authorization.slice(6) : "";
  let supplied = "";
  try { supplied = Buffer.from(encoded, "base64").toString("utf8"); } catch {}
  const [username, ...parts] = supplied.split(":");
  if (username !== "sentinel" || parts.join(":") !== password) {
    res.set("WWW-Authenticate", 'Basic realm="Sentinel Zero Sales Desk"');
    return res.status(401).send("Authorized Sentinel Zero callers only.");
  }
  next();
}

function parseNextAction(value) {
  if (value === null || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid next-action date/time");
  return d.toISOString();
}

export function attachMarketing(app) {
  app.use("/assets", express.static(PUBLIC_DIR, { maxAge: "1h", index: false }));
  app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
  app.get("/business", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "business.html")));
  app.get("/mobile", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "mobile.html")));
  app.get("/sales", salesAuth, (_req, res) => {
    res.set("X-Robots-Tag", "noindex, nofollow");
    const preferred = path.join(PUBLIC_DIR, "sales-v2.html");
    const fallback = path.join(PUBLIC_DIR, "sales.html");
    const file = fs.existsSync(preferred) ? preferred : fallback;
    res.sendFile(file);
  });
  app.get("/playbook", salesAuth, (_req, res) => {
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.sendFile(path.join(PUBLIC_DIR, "playbook.html"));
  });

  app.post("/api/public/leads", leadRateLimit, async (req, res, next) => {
    try {
      if (clean(req.body?.website, 200)) return res.status(202).json({ ok: true, accepted: true });
      const contactName = clean(req.body?.contactName, 150);
      const companyName = clean(req.body?.companyName, 200) || "Consumer / Mobile Security";
      const phone = clean(req.body?.phone, 60) || null;
      const email = clean(req.body?.email, 254).toLowerCase() || null;
      const source = clean(req.body?.source, 100) || "sentinel_website";
      const interest = clean(req.body?.interest, 200);
      const message = clean(req.body?.message, 2500);
      if (!contactName) return res.status(400).json({ ok: false, error: "Your name is required." });
      if (!phone && !email) return res.status(400).json({ ok: false, error: "Please provide a phone number or email." });
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: "Please enter a valid email address." });
      const org = await query("SELECT id FROM organizations ORDER BY created_at LIMIT 1");
      if (!org.rowCount) return res.status(503).json({ ok: false, error: "Lead intake is temporarily unavailable." });
      const attribution = {
        interest,
        message,
        utm_source: clean(req.body?.utm_source, 120),
        utm_medium: clean(req.body?.utm_medium, 120),
        utm_campaign: clean(req.body?.utm_campaign, 160),
        utm_content: clean(req.body?.utm_content, 160),
        utm_term: clean(req.body?.utm_term, 160),
        landing_path: clean(req.headers.referer, 500)
      };
      const notes = "Website/caller intake: " + JSON.stringify(attribution);
      const result = await query(`INSERT INTO leads(organization_id,company_name,contact_name,phone,email,source,notes)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,created_at`,
        [org.rows[0].id, companyName, contactName, phone, email, source, notes]);
      res.status(201).json({ ok: true, leadId: result.rows[0].id, createdAt: result.rows[0].created_at });
    } catch (error) { next(error); }
  });

  app.get("/api/sales/leads", salesAuth, async (_req, res, next) => {
    try {
      const result = await query(`SELECT id,company_name,contact_name,phone,email,source,status,priority,notes,last_contact_at,next_action_at,do_not_call,suppression_reason,created_at,updated_at
        FROM leads
        ORDER BY do_not_call ASC,
          CASE WHEN next_action_at IS NOT NULL AND next_action_at <= now() THEN 0 ELSE 1 END,
          CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
          COALESCE(next_action_at, created_at) ASC
        LIMIT 150`);
      res.json({ ok: true, leads: result.rows });
    } catch (error) { next(error); }
  });

  app.get("/api/sales/metrics", salesAuth, async (_req, res, next) => {
    try {
      const result = await query(`SELECT
        count(*) FILTER (WHERE status='new' AND do_not_call=false) AS new_count,
        count(*) FILTER (WHERE status='working' AND do_not_call=false) AS working_count,
        count(*) FILTER (WHERE status='follow_up' AND do_not_call=false) AS follow_up_count,
        count(*) FILTER (WHERE status='appointment' AND do_not_call=false) AS appointment_count,
        count(*) FILTER (WHERE status='qualified' AND do_not_call=false) AS qualified_count,
        count(*) FILTER (WHERE status='closed') AS closed_count,
        count(*) FILTER (WHERE next_action_at IS NOT NULL AND next_action_at <= now() AND do_not_call=false AND status NOT IN ('closed','not_interested')) AS due_now,
        count(*) FILTER (WHERE (created_at AT TIME ZONE 'America/Phoenix')::date = (now() AT TIME ZONE 'America/Phoenix')::date) AS added_today
        FROM leads`);
      res.json({ ok: true, metrics: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.patch("/api/sales/leads/:id", salesAuth, async (req, res, next) => {
    try {
      const id = String(req.params.id || "");
      if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "Invalid lead id" });
      const body = req.body || {};
      const sets = [];
      const values = [];
      const add = (sql, value) => { values.push(value); sets.push(sql.replace("?", `$${values.length}`)); };

      if (body.status !== undefined) {
        const status = clean(body.status, 40);
        if (!LEAD_STATUSES.has(status)) return res.status(400).json({ ok: false, error: "Invalid lead status" });
        add("status=?", status);
      }
      if (body.priority !== undefined) {
        const priority = clean(body.priority, 20);
        if (!PRIORITIES.has(priority)) return res.status(400).json({ ok: false, error: "Invalid priority" });
        add("priority=?", priority);
      }
      if (Object.prototype.hasOwnProperty.call(body, "nextActionAt")) add("next_action_at=?", parseNextAction(body.nextActionAt));
      if (body.markContacted === true) sets.push("last_contact_at=now()");
      const append = clean(body.notesAppend, 2000);
      if (append) add("notes=concat_ws(E'\\n',NULLIF(notes,''),?)", append);
      if (body.doNotCall === true) {
        sets.push("do_not_call=true");
        sets.push("status='not_interested'");
        sets.push("next_action_at=NULL");
        add("suppression_reason=?", clean(body.suppressionReason, 250) || "Manual opt-out recorded by sales desk");
      }
      if (!sets.length) return res.status(400).json({ ok: false, error: "No lead changes supplied" });
      sets.push("updated_at=now()");
      values.push(id);
      const result = await query(`UPDATE leads SET ${sets.join(",")} WHERE id=$${values.length}
        RETURNING id,company_name,contact_name,phone,email,source,status,priority,notes,last_contact_at,next_action_at,do_not_call,suppression_reason,created_at,updated_at`, values);
      if (!result.rowCount) return res.status(404).json({ ok: false, error: "Lead not found" });
      res.json({ ok: true, lead: result.rows[0] });
    } catch (error) {
      if (/Invalid next-action/i.test(error.message || "")) return res.status(400).json({ ok: false, error: error.message });
      next(error);
    }
  });

  app.get("/api/admin/marketing/leads", async (req, res, next) => {
    try {
      const configured = process.env.ADMIN_API_KEY;
      const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!configured) return res.status(503).json({ ok: false, error: "Admin API key is not configured" });
      if (supplied !== configured) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const result = await query(`SELECT id,company_name,contact_name,phone,email,source,status,priority,notes,last_contact_at,next_action_at,do_not_call,created_at,updated_at
        FROM leads ORDER BY created_at DESC LIMIT 250`);
      res.json({ ok: true, leads: result.rows });
    } catch (error) { next(error); }
  });
}
