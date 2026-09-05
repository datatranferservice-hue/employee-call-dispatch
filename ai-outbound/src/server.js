import express from "express";
import { healthcheck, query } from "./db.js";
import { aiConfigured, acceptRealtimeSipCall, buildInstructions, extractIncomingCall, ownerTransferConfigured } from "./openai.js";
import { asteriskConfigured } from "./transport.js";
import { snapshot, campaignList, dispatchCampaign, sessionContext, markAnswered, finishSession, bookAppointment, cleanupStaleDialingSessions } from "./engine.js";
import { attachRealtimeSideband, sidebandStatus } from "./sideband.js";
import { verifiedOpenAIEvent, webhookVerificationMode } from "./webhook.js";
import { attachMarketing } from "./marketing.js";

const app = express();
const PORT = Number(process.env.PORT || 10000);
const WORKER_INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS || 5000);
let workerBusy = false;

app.set("trust proxy", 1);
app.use(express.json({
  limit: "1mb",
  verify: (req, _res, buffer) => { req.rawBody = buffer.toString("utf8"); }
}));
app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store"
  });
  next();
});

attachMarketing(app);

const jsonError = (res, status, error) => res.status(status).json({ ok: false, error });
const liveEnabled = () => String(process.env.ALLOW_LIVE_AI_CALLS || "false").toLowerCase() === "true";
const adminAuth = (req, res, next) => {
  const configured = process.env.ADMIN_API_KEY;
  if (!configured) return jsonError(res, 503, "Admin API key is not configured");
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (supplied !== configured) return jsonError(res, 401, "Unauthorized");
  next();
};
const asteriskAuth = (req, res, next) => {
  const configured = process.env.ASTERISK_EVENT_SECRET;
  if (!configured || req.headers["x-asterisk-secret"] !== configured) return jsonError(res, 401, "Unauthorized");
  next();
};

app.get("/api", (_req, res) => res.json({
  ok: true,
  service: "Sentinel Zero AI Outbound Caller",
  version: "1.3.0",
  liveDialingEnabled: liveEnabled()
}));

app.get("/health", async (_req, res, next) => {
  try {
    const db = await healthcheck();
    const webhookMode = webhookVerificationMode();
    const components = {
      database: true,
      ai: aiConfigured(),
      asterisk: asteriskConfigured(),
      webhookVerification: webhookMode,
      ownerTransfer: ownerTransferConfigured(),
      liveDialing: liveEnabled()
    };
    res.json({
      ok: true,
      service: "Sentinel Zero AI Outbound Caller",
      version: "1.3.0",
      databaseTime: db.database_time,
      components,
      liveReady: components.ai && components.asterisk && components.liveDialing && webhookMode !== "unconfigured",
      sideband: { active: sidebandStatus().active }
    });
  } catch (error) { next(error); }
});

app.get("/api/status", adminAuth, async (_req, res, next) => {
  try {
    res.json({
      ok: true,
      snapshot: await snapshot(),
      campaigns: await campaignList(),
      readiness: {
        aiConfigured: aiConfigured(),
        asteriskConfigured: asteriskConfigured(),
        webhookVerification: webhookVerificationMode(),
        ownerTransferConfigured: ownerTransferConfigured(),
        liveDialingEnabled: liveEnabled()
      },
      sideband: sidebandStatus()
    });
  } catch (error) { next(error); }
});

app.post("/api/campaigns/:id/start", adminAuth, async (req, res, next) => {
  try {
    const campaign = await query(`SELECT * FROM ai_campaigns WHERE id=$1`, [req.params.id]);
    if (!campaign.rowCount) return jsonError(res, 404, "Campaign not found");
    const c = campaign.rows[0];
    if (c.compliance_status !== "approved") return jsonError(res, 409, "Campaign compliance must be approved before starting");
    if (c.transport === "asterisk" && !liveEnabled()) return jsonError(res, 409, "Live AI calling is disabled at the service level");
    if (c.transport === "asterisk" && (!aiConfigured() || !asteriskConfigured())) return jsonError(res, 409, "AI voice and Asterisk transport must both be configured before live campaign start");
    await query(`UPDATE ai_campaigns SET status='running',updated_at=now() WHERE id=$1`, [req.params.id]);
    res.json({ ok: true, status: "running" });
  } catch (error) { next(error); }
});

app.post("/api/campaigns/:id/pause", adminAuth, async (req, res, next) => {
  try {
    await query(`UPDATE ai_campaigns SET status='paused',updated_at=now() WHERE id=$1`, [req.params.id]);
    res.json({ ok: true, status: "paused" });
  } catch (error) { next(error); }
});

app.post("/api/campaigns/:id/dispatch", adminAuth, async (req, res, next) => {
  try { res.json(await dispatchCampaign(req.params.id)); }
  catch (error) { next(error); }
});

app.get("/api/sessions/:id", adminAuth, async (req, res, next) => {
  try {
    const context = await sessionContext(req.params.id);
    if (!context) return jsonError(res, 404, "Session not found");
    const [turns, events] = await Promise.all([
      query(`SELECT speaker,text,metadata,created_at FROM ai_turns WHERE session_id=$1 ORDER BY id`, [req.params.id]),
      query(`SELECT event_type,payload,created_at FROM ai_events WHERE session_id=$1 ORDER BY id DESC LIMIT 100`, [req.params.id])
    ]);
    res.json({ ok: true, session: context, turns: turns.rows, events: events.rows });
  } catch (error) { next(error); }
});

app.post("/api/sessions/:id/answered", adminAuth, async (req, res, next) => {
  try { res.json({ ok: true, session: await markAnswered(req.params.id) }); }
  catch (error) { next(error); }
});

app.post("/api/sessions/:id/finish", adminAuth, async (req, res, next) => {
  try { res.json(await finishSession(req.params.id, req.body || {})); }
  catch (error) { next(error); }
});

app.post("/api/sessions/:id/appointment", adminAuth, async (req, res, next) => {
  try {
    if (!req.body?.scheduledAt) return jsonError(res, 400, "scheduledAt is required");
    const appointment = await bookAppointment(req.params.id, req.body.scheduledAt, req.body.notes || null);
    res.json({ ok: true, appointment });
  } catch (error) { next(error); }
});

app.post("/webhooks/asterisk/sessions/:id/status", asteriskAuth, async (req, res, next) => {
  try {
    const status = req.body?.status;
    if (status === "answered") return res.json({ ok: true, session: await markAnswered(req.params.id) });
    if (status === "completed") return res.json(await finishSession(req.params.id, {
      outcome: req.body?.outcome || "connected",
      summary: req.body?.summary || null,
      callbackAt: req.body?.callbackAt || null
    }));
    return jsonError(res, 400, "Unsupported status");
  } catch (error) { next(error); }
});

app.post("/webhooks/openai", async (req, res, next) => {
  try {
    const event = await verifiedOpenAIEvent(req);
    const incoming = extractIncomingCall(event);
    if (!incoming) return res.json({ ok: true, ignored: true });
    if (!incoming.callId || !incoming.sessionId) return jsonError(res, 400, "Incoming SIP call is missing call/session correlation");
    const context = await sessionContext(incoming.sessionId);
    if (!context) return jsonError(res, 404, "AI session not found");
    if (context.status !== "dialing") return jsonError(res, 409, "AI session is not awaiting a SIP call");
    const instructions = buildInstructions({
      script: { system_prompt: context.system_prompt, opening_text: context.opening_text },
      lead: { company_name: context.company_name, contact_name: context.contact_name },
      company: "Sentinel Zero"
    });
    await acceptRealtimeSipCall({ callId: incoming.callId, instructions });
    attachRealtimeSideband({ callId: incoming.callId, sessionId: incoming.sessionId });
    await markAnswered(incoming.sessionId);
    res.json({ ok: true, accepted: true, sideband: "attaching" });
  } catch (error) {
    if (/signature|verification|webhook/i.test(error.message || "")) return jsonError(res, 401, "Invalid webhook");
    next(error);
  }
});

async function workerTick() {
  if (workerBusy || String(process.env.WORKER_ENABLED || "true").toLowerCase() !== "true") return;
  workerBusy = true;
  try {
    await cleanupStaleDialingSessions();
    const running = await query(`SELECT id FROM ai_campaigns WHERE status='running' ORDER BY updated_at`);
    for (const campaign of running.rows) {
      try { await dispatchCampaign(campaign.id); }
      catch (error) { console.error("dispatch error", campaign.id, error.message); }
    }
  } finally { workerBusy = false; }
}

setInterval(workerTick, WORKER_INTERVAL_MS).unref();

app.use((_req, res) => jsonError(res, 404, "Route not found"));
app.use((error, _req, res, _next) => {
  console.error(error);
  jsonError(res, 500, process.env.NODE_ENV === "production" ? "Internal server error" : error.message);
});

app.listen(PORT, "0.0.0.0", () => console.log(`Sentinel Zero AI Outbound Caller listening on ${PORT}`));