import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "./db.js";

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const attempts = new Map();
const clean = (value, max = 500) => String(value || "").trim().slice(0, max);

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

export function attachMarketing(app) {
  app.use("/assets", express.static(PUBLIC_DIR, { maxAge: "1h", index: false }));
  app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
  app.get("/business", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "business.html")));
  app.get("/mobile", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "mobile.html")));
  app.get("/sales", (_req, res) => {
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.sendFile(path.join(PUBLIC_DIR, "sales.html"));
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

  app.get("/api/admin/marketing/leads", async (req, res, next) => {
    try {
      const configured = process.env.ADMIN_API_KEY;
      const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!configured) return res.status(503).json({ ok: false, error: "Admin API key is not configured" });
      if (supplied !== configured) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const result = await query(`SELECT id,company_name,contact_name,phone,email,source,status,priority,notes,last_contact_at,next_action_at,created_at
        FROM leads ORDER BY created_at DESC LIMIT 250`);
      res.json({ ok: true, leads: result.rows });
    } catch (error) { next(error); }
  });
}
