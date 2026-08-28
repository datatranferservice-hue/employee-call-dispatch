import crypto from "node:crypto";
import { query, transaction } from "./db.js";
import { leadGate, assertTestDestination } from "./compliance.js";
import { originate } from "./transport.js";

const outcomes = new Set(["no_answer","voicemail","connected","callback","appointment","not_interested","wrong_number","do_not_call"]);

export async function snapshot() {
  const result = await query(`SELECT
    (SELECT count(*)::int FROM organizations) organizations,
    (SELECT count(*)::int FROM leads) leads,
    (SELECT count(*)::int FROM leads WHERE do_not_call=true) do_not_call,
    (SELECT count(*)::int FROM ai_campaigns) campaigns,
    (SELECT count(*)::int FROM ai_campaigns WHERE status='running') running_campaigns,
    (SELECT count(*)::int FROM ai_campaign_leads WHERE status IN ('queued','retry')) queued,
    (SELECT count(*)::int FROM ai_call_sessions) sessions,
    (SELECT count(*)::int FROM ai_call_sessions WHERE status='active') active_sessions,
    (SELECT count(*)::int FROM appointments WHERE source='ai') ai_appointments`);
  return result.rows[0];
}

export async function campaignList() {
  const result = await query(`SELECT c.id,c.name,c.status,c.transport,c.timezone,c.call_window_start,c.call_window_end,
    c.weekdays_only,c.max_concurrent,c.max_attempts_per_lead,c.retry_minutes,c.max_calls_per_hour,
    c.min_seconds_between_calls,c.compliance_status,c.compliance_notes,c.caller_id,c.last_dispatch_at,
    count(cl.lead_id)::int lead_count,
    count(cl.lead_id) FILTER (WHERE cl.status IN ('queued','retry'))::int queued_count
    FROM ai_campaigns c LEFT JOIN ai_campaign_leads cl ON cl.campaign_id=c.id
    GROUP BY c.id ORDER BY c.created_at DESC`);
  return result.rows;
}

export async function sessionContext(sessionId) {
  const result = await query(`SELECT s.*,l.company_name,l.contact_name,l.phone,l.email,l.notes lead_notes,l.do_not_call,
      c.name campaign_name,c.caller_id,c.transport campaign_transport,
      sc.name script_name,sc.opening_text,sc.system_prompt
    FROM ai_call_sessions s
    JOIN leads l ON l.id=s.lead_id
    LEFT JOIN ai_campaigns c ON c.id=s.campaign_id
    LEFT JOIN ai_scripts sc ON sc.id=c.script_id
    WHERE s.id=$1`, [sessionId]);
  return result.rows[0] || null;
}

async function reserveLead(campaignId) {
  return transaction(async client => {
    const campaignResult = await client.query(`SELECT * FROM ai_campaigns WHERE id=$1 FOR UPDATE`, [campaignId]);
    if (!campaignResult.rowCount) throw new Error("Campaign not found");
    const campaign = campaignResult.rows[0];
    if (campaign.status !== "running") throw new Error("Campaign is not running");
    const active = await client.query(`SELECT count(*)::int count FROM ai_call_sessions WHERE campaign_id=$1 AND status IN ('dialing','active')`, [campaignId]);
    if (active.rows[0].count >= campaign.max_concurrent) return { idle: true, reason: "max_concurrent" };
    const row = await client.query(`SELECT cl.*,l.* FROM ai_campaign_leads cl JOIN leads l ON l.id=cl.lead_id
      WHERE cl.campaign_id=$1 AND cl.status IN ('queued','retry') AND cl.next_attempt_at<=now()
        AND cl.attempts < $2
      ORDER BY CASE l.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, cl.next_attempt_at, l.created_at
      FOR UPDATE OF cl SKIP LOCKED LIMIT 1`, [campaignId, campaign.max_attempts_per_lead]);
    if (!row.rowCount) return { idle: true, reason: "queue_empty" };
    const lead = row.rows[0];
    const gate = leadGate(campaign, lead);
    if (!gate.ok) {
      const terminal = ["do_not_call","missing_phone","lead_ai_permission_not_verified"].includes(gate.reason);
      await client.query(`UPDATE ai_campaign_leads SET status=$3,last_error=$4,updated_at=now() WHERE campaign_id=$1 AND lead_id=$2`,
        [campaignId, lead.id, terminal ? "skipped" : "retry", gate.reason]);
      return { idle: true, reason: gate.reason };
    }
    const sessionId = crypto.randomUUID();
    await client.query(`UPDATE ai_campaign_leads SET status='dialing',attempts=attempts+1,last_error=NULL,updated_at=now() WHERE campaign_id=$1 AND lead_id=$2`, [campaignId, lead.id]);
    await client.query(`INSERT INTO ai_call_sessions(id,organization_id,campaign_id,lead_id,status,transport)
      VALUES($1,$2,$3,$4,'dialing',$5)`, [sessionId, campaign.organization_id, campaign.id, lead.id, campaign.transport]);
    await client.query(`UPDATE ai_campaigns SET last_dispatch_at=now(),updated_at=now() WHERE id=$1`, [campaignId]);
    return { campaign, lead, sessionId };
  });
}

export async function dispatchCampaign(campaignId) {
  const reserved = await reserveLead(campaignId);
  if (reserved.idle) return { ok: true, dispatched: false, ...reserved };
  const { campaign, lead, sessionId } = reserved;
  try {
    const provider = await originate({ transport: campaign.transport, phone: lead.phone, sessionId, callerId: campaign.caller_id });
    if (campaign.transport === "simulation") {
      await query(`UPDATE ai_call_sessions SET status='completed',disposition='simulation_only',summary='SIMULATION ONLY — no external telephone call was placed.',ended_at=now(),updated_at=now() WHERE id=$1`, [sessionId]);
      await query(`UPDATE ai_campaign_leads SET status='completed',last_session_id=$2,updated_at=now() WHERE campaign_id=$1 AND lead_id=$3`, [campaign.id, sessionId, lead.id]);
    } else {
      await query(`UPDATE ai_campaign_leads SET last_session_id=$3,updated_at=now() WHERE campaign_id=$1 AND lead_id=$2`, [campaign.id, lead.id, sessionId]);
    }
    return { ok: true, dispatched: true, sessionId, provider, transport: campaign.transport };
  } catch (error) {
    await query(`UPDATE ai_call_sessions SET status='failed',summary=$2,ended_at=now(),updated_at=now() WHERE id=$1`, [sessionId, error.message.slice(0, 1000)]);
    await query(`UPDATE ai_campaign_leads SET status='retry',last_error=$3,next_attempt_at=now()+($4 || ' minutes')::interval,updated_at=now() WHERE campaign_id=$1 AND lead_id=$2`, [campaign.id, lead.id, error.message.slice(0, 1000), campaign.retry_minutes]);
    throw error;
  }
}

export async function createTestSession({ phone, companyName = "Owner Test Call" }) {
  if (!assertTestDestination(phone)) throw new Error("Test destination is not allowlisted");
  const org = await query(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`);
  if (!org.rowCount) throw new Error("No organization exists");
  const lead = await query(`INSERT INTO leads(organization_id,company_name,phone,source,notes)
    VALUES($1,$2,$3,'owner_test','[AI_CALL_OK] Owner-authorized test destination') RETURNING *`, [org.rows[0].id, companyName, phone]);
  return lead.rows[0];
}

export async function markAnswered(sessionId) {
  const result = await query(`UPDATE ai_call_sessions SET status='active',answered_at=COALESCE(answered_at,now()),updated_at=now() WHERE id=$1 RETURNING *`, [sessionId]);
  return result.rows[0] || null;
}

export async function finishSession(sessionId, { outcome, summary = null, callbackAt = null }) {
  if (!outcomes.has(outcome)) throw new Error("Unsupported outcome");
  return transaction(async client => {
    const sessionResult = await client.query(`SELECT * FROM ai_call_sessions WHERE id=$1 FOR UPDATE`, [sessionId]);
    if (!sessionResult.rowCount) throw new Error("Session not found");
    const s = sessionResult.rows[0];
    await client.query(`UPDATE ai_call_sessions SET status='completed',disposition=$2,summary=$3,ended_at=COALESCE(ended_at,now()),updated_at=now() WHERE id=$1`, [sessionId, outcome, summary]);
    await client.query(`INSERT INTO call_attempts(organization_id,lead_id,started_at,ended_at,duration_seconds,ai_session_id,outcome,notes,next_action_at)
      VALUES($1,$2,$3,now(),GREATEST(0,EXTRACT(EPOCH FROM (now()-$3))::int),$4,$5,$6,$7)
      ON CONFLICT(ai_session_id) DO UPDATE SET ended_at=EXCLUDED.ended_at,duration_seconds=EXCLUDED.duration_seconds,outcome=EXCLUDED.outcome,notes=EXCLUDED.notes,next_action_at=EXCLUDED.next_action_at`,
      [s.organization_id, s.lead_id, s.started_at, sessionId, outcome, summary, callbackAt]);
    if (outcome === "do_not_call") {
      await client.query(`UPDATE leads SET do_not_call=true,suppression_reason='AI call opt-out',status='not_interested',last_contact_at=now(),updated_at=now() WHERE id=$1`, [s.lead_id]);
    } else if (outcome === "appointment") {
      await client.query(`UPDATE leads SET status='appointment',last_contact_at=now(),updated_at=now() WHERE id=$1`, [s.lead_id]);
    } else if (outcome === "callback") {
      await client.query(`UPDATE leads SET status='follow_up',next_action_at=$2,last_contact_at=now(),updated_at=now() WHERE id=$1`, [s.lead_id, callbackAt]);
    } else if (["not_interested","wrong_number"].includes(outcome)) {
      await client.query(`UPDATE leads SET status='not_interested',last_contact_at=now(),updated_at=now() WHERE id=$1`, [s.lead_id]);
    } else {
      await client.query(`UPDATE leads SET status='working',last_contact_at=now(),updated_at=now() WHERE id=$1`, [s.lead_id]);
    }
    if (s.campaign_id) {
      const status = outcome === "callback" ? "retry" : "completed";
      await client.query(`UPDATE ai_campaign_leads SET status=$3,next_attempt_at=COALESCE($4,next_attempt_at),updated_at=now() WHERE campaign_id=$1 AND lead_id=$2`, [s.campaign_id, s.lead_id, status, callbackAt]);
    }
    return { ok: true, sessionId, outcome };
  });
}

export async function bookAppointment(sessionId, scheduledAt, notes = null) {
  const context = await sessionContext(sessionId);
  if (!context) throw new Error("Session not found");
  const owner = await query(`SELECT id FROM users WHERE organization_id=$1 AND role='owner' AND active=true ORDER BY created_at LIMIT 1`, [context.organization_id]);
  const result = await query(`INSERT INTO appointments(organization_id,lead_id,owner_user_id,scheduled_at,status,meeting_type,notes,source,source_session_id)
    VALUES($1,$2,$3,$4,'scheduled','15-minute fit call',$5,'ai',$6)
    ON CONFLICT(source_session_id) WHERE source_session_id IS NOT NULL DO UPDATE SET scheduled_at=EXCLUDED.scheduled_at,notes=EXCLUDED.notes,updated_at=now()
    RETURNING *`, [context.organization_id, context.lead_id, owner.rows[0]?.id || null, scheduledAt, notes, sessionId]);
  await finishSession(sessionId, { outcome: "appointment", summary: notes || "Appointment booked by AI caller" });
  return result.rows[0];
}
