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
const SALES_ACTIVITIES = new Set(["dial", "connect", "decision_maker"]);

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

function parseDate(value, label = "date/time") {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) throw new Error(`Invalid ${label}`);
  return d.toISOString();
}

function parseNextAction(value) {
  if (value === null || value === "") return null;
  return parseDate(value, "next-action date/time");
}

async function logSalesActivity(req, { organizationId, leadId = null, action, caller, metadata = {} }) {
  await query(`INSERT INTO audit_events(organization_id,action,entity_type,entity_id,metadata,ip_address,user_agent)
    VALUES($1,$2,'lead',$3,$4::jsonb,$5,$6)`, [
    organizationId,
    `sales.${action}`,
    leadId,
    JSON.stringify({ caller: clean(caller, 120) || "Unassigned", ...metadata }),
    clean(req.ip || req.socket?.remoteAddress, 100) || null,
    clean(req.headers["user-agent"], 500) || null
  ]);
}

export function attachMarketing(app) {
  app.use("/assets", express.static(PUBLIC_DIR, { maxAge: "1h", index: false }));
  app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
  app.get("/business", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "business.html")));
  app.get("/mobile", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "mobile.html")));
  app.get("/sales", salesAuth, (_req, res) => {
    res.set("X-Robots-Tag", "noindex, nofollow");
    const files = ["sales-v3.html", "sales-v2.html", "sales.html"].map(name => path.join(PUBLIC_DIR, name));
    res.sendFile(files.find(file => fs.existsSync(file)) || files[files.length - 1]);
  });
  app.get("/playbook", salesAuth, (_req, res) => {
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.sendFile(path.join(PUBLIC_DIR, "playbook.html"));
  });
  app.get("/manager", salesAuth, (_req, res) => {
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.sendFile(path.join(PUBLIC_DIR, "manager.html"));
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
      const result = await query(`SELECT id,company_name,contact_name,phone,email,segment,source,status,priority,notes,last_contact_at,next_action_at,do_not_call,suppression_reason,created_at,updated_at
        FROM leads
        ORDER BY do_not_call ASC,
          CASE WHEN next_action_at IS NOT NULL AND next_action_at <= now() THEN 0 ELSE 1 END,
          CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
          COALESCE(next_action_at, created_at) ASC
        LIMIT 200`);
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

  app.post("/api/sales/activity", salesAuth, async (req, res, next) => {
    try {
      const leadId = String(req.body?.leadId || "");
      const action = clean(req.body?.activityType, 40);
      const caller = clean(req.body?.caller, 120);
      const outcome = clean(req.body?.outcome, 300);
      if (!UUID_RE.test(leadId)) return res.status(400).json({ ok: false, error: "Invalid lead id" });
      if (!SALES_ACTIVITIES.has(action)) return res.status(400).json({ ok: false, error: "Invalid activity type" });
      if (!caller) return res.status(400).json({ ok: false, error: "Caller name is required" });
      const lead = await query("SELECT id,organization_id,do_not_call,status FROM leads WHERE id=$1", [leadId]);
      if (!lead.rowCount) return res.status(404).json({ ok: false, error: "Lead not found" });
      if (lead.rows[0].do_not_call) return res.status(409).json({ ok: false, error: "This prospect is marked Do Not Call" });
      await logSalesActivity(req, { organizationId: lead.rows[0].organization_id, leadId, action, caller, metadata: { outcome } });
      if (action === "connect" || action === "decision_maker") {
        await query(`UPDATE leads SET last_contact_at=now(),status=CASE WHEN status='new' THEN 'working' ELSE status END,updated_at=now() WHERE id=$1`, [leadId]);
      }
      res.status(201).json({ ok: true, activityType: action });
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
        RETURNING id,organization_id,company_name,contact_name,phone,email,segment,source,status,priority,notes,last_contact_at,next_action_at,do_not_call,suppression_reason,created_at,updated_at`, values);
      if (!result.rowCount) return res.status(404).json({ ok: false, error: "Lead not found" });
      const caller = clean(body.caller, 120) || "Unassigned";
      if (Object.prototype.hasOwnProperty.call(body, "nextActionAt") && body.nextActionAt) {
        await logSalesActivity(req, { organizationId: result.rows[0].organization_id, leadId: id, action: "follow_up_set", caller, metadata: { nextActionAt: result.rows[0].next_action_at } });
      }
      if (body.doNotCall === true) {
        await logSalesActivity(req, { organizationId: result.rows[0].organization_id, leadId: id, action: "dnc", caller, metadata: { reason: result.rows[0].suppression_reason } });
      }
      res.json({ ok: true, lead: result.rows[0] });
    } catch (error) {
      if (/Invalid .*date\/time/i.test(error.message || "")) return res.status(400).json({ ok: false, error: error.message });
      next(error);
    }
  });

  app.post("/api/sales/leads/:id/appointment", salesAuth, async (req, res, next) => {
    try {
      const leadId = String(req.params.id || "");
      if (!UUID_RE.test(leadId)) return res.status(400).json({ ok: false, error: "Invalid lead id" });
      const scheduledAt = parseDate(req.body?.scheduledAt, "appointment date/time");
      if (new Date(scheduledAt).getTime() < Date.now() - 5 * 60 * 1000) return res.status(400).json({ ok: false, error: "Appointment must be in the future" });
      const meetingType = clean(req.body?.meetingType, 120) || "15-minute Sentinel Zero fit call";
      const caller = clean(req.body?.caller, 120) || "Sales Desk";
      const note = clean(req.body?.notes, 1500);
      const result = await query(`WITH target AS (
          SELECT id,organization_id FROM leads WHERE id=$1 AND do_not_call=false
        ), booked AS (
          INSERT INTO appointments(organization_id,lead_id,scheduled_at,status,meeting_type,notes,source)
          SELECT organization_id,id,$2,'scheduled',$3,$4,'human_sales_desk' FROM target
          RETURNING id,organization_id,lead_id,scheduled_at,status,meeting_type,notes,source
        ), moved AS (
          UPDATE leads SET status='appointment',priority='high',next_action_at=$2,last_contact_at=now(),
            notes=concat_ws(E'\\n',NULLIF(notes,''),$5),updated_at=now()
          WHERE id=$1 AND EXISTS(SELECT 1 FROM booked)
          RETURNING id
        )
        SELECT b.* FROM booked b JOIN moved m ON m.id=b.lead_id`,
        [leadId, scheduledAt, meetingType, note || `Appointment booked by ${caller}`, `[${caller}] Appointment booked for ${scheduledAt}: ${meetingType}${note ? ` — ${note}` : ""}`]);
      if (!result.rowCount) return res.status(404).json({ ok: false, error: "Lead not found or is suppressed" });
      await logSalesActivity(req, {
        organizationId: result.rows[0].organization_id,
        leadId,
        action: "appointment_booked",
        caller,
        metadata: { appointmentId: result.rows[0].id, scheduledAt: result.rows[0].scheduled_at, meetingType }
      });
      res.status(201).json({ ok: true, appointment: result.rows[0] });
    } catch (error) {
      if (/Invalid appointment|must be in the future/i.test(error.message || "")) return res.status(400).json({ ok: false, error: error.message });
      next(error);
    }
  });

  app.get("/api/sales/appointments", salesAuth, async (_req, res, next) => {
    try {
      const result = await query(`SELECT a.id,a.lead_id,a.scheduled_at,a.status,a.meeting_type,a.notes,a.source,
          l.company_name,l.contact_name,l.phone,l.email,l.segment
        FROM appointments a LEFT JOIN leads l ON l.id=a.lead_id
        WHERE a.status='scheduled' AND a.scheduled_at >= now() - interval '1 day'
        ORDER BY a.scheduled_at ASC LIMIT 100`);
      res.json({ ok: true, appointments: result.rows });
    } catch (error) { next(error); }
  });

  app.get("/api/sales/manager", salesAuth, async (_req, res, next) => {
    try {
      const [funnel, segments, sources, appointments, due, callers] = await Promise.all([
        query(`SELECT status,count(*)::int AS count FROM leads GROUP BY status ORDER BY status`),
        query(`SELECT COALESCE(segment,'unclassified') AS segment,count(*)::int AS count,
          count(*) FILTER(WHERE status IN ('appointment','qualified','closed'))::int AS advanced
          FROM leads WHERE do_not_call=false GROUP BY COALESCE(segment,'unclassified') ORDER BY count DESC`),
        query(`SELECT COALESCE(source,'unknown') AS source,count(*)::int AS count,
          count(*) FILTER(WHERE status IN ('appointment','qualified','closed'))::int AS advanced
          FROM leads GROUP BY COALESCE(source,'unknown') ORDER BY count DESC LIMIT 20`),
        query(`SELECT a.id,a.scheduled_at,a.status,a.meeting_type,l.company_name,l.contact_name,l.phone,l.email
          FROM appointments a LEFT JOIN leads l ON l.id=a.lead_id
          WHERE a.status='scheduled' AND a.scheduled_at >= now() - interval '1 day'
          ORDER BY a.scheduled_at ASC LIMIT 50`),
        query(`SELECT id,company_name,contact_name,phone,email,segment,status,priority,next_action_at
          FROM leads WHERE do_not_call=false AND status NOT IN ('closed','not_interested') AND next_action_at IS NOT NULL
          ORDER BY CASE WHEN next_action_at<=now() THEN 0 ELSE 1 END,next_action_at ASC LIMIT 50`),
        query(`SELECT COALESCE(NULLIF(metadata->>'caller',''),'Unassigned') AS caller,
          count(*) FILTER(WHERE action='sales.dial')::int AS dials,
          count(*) FILTER(WHERE action='sales.connect')::int AS connects,
          count(*) FILTER(WHERE action='sales.decision_maker')::int AS decision_makers,
          count(*) FILTER(WHERE action='sales.appointment_booked')::int AS appointments,
          count(*) FILTER(WHERE action='sales.follow_up_set')::int AS follow_ups,
          count(*) FILTER(WHERE action='sales.dnc')::int AS dnc
          FROM audit_events
          WHERE action LIKE 'sales.%' AND created_at >= now() - interval '30 days'
          GROUP BY COALESCE(NULLIF(metadata->>'caller',''),'Unassigned')
          ORDER BY appointments DESC,decision_makers DESC,connects DESC,dials DESC`)
      ]);
      res.json({ ok: true, funnel: funnel.rows, segments: segments.rows, sources: sources.rows, appointments: appointments.rows, due: due.rows, callers: callers.rows });
    } catch (error) { next(error); }
  });

  app.get("/api/admin/marketing/leads", async (req, res, next) => {
    try {
      const configured = process.env.ADMIN_API_KEY;
      const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!configured) return res.status(503).json({ ok: false, error: "Admin API key is not configured" });
      if (supplied !== configured) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const result = await query(`SELECT id,company_name,contact_name,phone,email,segment,source,status,priority,notes,last_contact_at,next_action_at,do_not_call,created_at,updated_at
        FROM leads ORDER BY created_at DESC LIMIT 250`);
      res.json({ ok: true, leads: result.rows });
    } catch (error) { next(error); }
  });
}
