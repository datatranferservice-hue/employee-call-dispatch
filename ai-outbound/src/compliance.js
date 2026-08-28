const truthy = value => ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());

export function localClockParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "America/Phoenix",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  return Object.fromEntries(parts.map(p => [p.type, p.value]));
}

function minutes(value) {
  const [h, m] = String(value || "00:00").slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

export function campaignWindowOpen(campaign, date = new Date()) {
  const parts = localClockParts(date, campaign.timezone || "America/Phoenix");
  if (campaign.weekdays_only && ["Sat", "Sun"].includes(parts.weekday)) return false;
  const nowMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  return nowMinutes >= minutes(campaign.call_window_start) && nowMinutes < minutes(campaign.call_window_end);
}

export function leadGate(campaign, lead, { isTest = false } = {}) {
  if (!lead?.phone) return { ok: false, reason: "missing_phone" };
  if (lead.do_not_call) return { ok: false, reason: "do_not_call" };
  if (isTest) return { ok: true };
  if (campaign.compliance_status !== "approved") return { ok: false, reason: "campaign_compliance_not_approved" };
  if (!campaignWindowOpen(campaign)) return { ok: false, reason: "outside_call_window" };
  if (campaign.transport !== "simulation" && !truthy(process.env.ALLOW_LIVE_AI_CALLS)) {
    return { ok: false, reason: "live_ai_calls_disabled" };
  }
  if (truthy(process.env.REQUIRE_LEAD_AI_PERMISSION_FLAG ?? "true")) {
    const notes = String(lead.notes || "");
    if (!notes.includes("[AI_CALL_OK]")) return { ok: false, reason: "lead_ai_permission_not_verified" };
  }
  return { ok: true };
}

export function assertTestDestination(phone) {
  const allowed = String(process.env.TEST_CALL_NUMBERS || "")
    .split(",")
    .map(v => v.replace(/\D/g, ""))
    .filter(Boolean);
  const candidate = String(phone || "").replace(/\D/g, "");
  return Boolean(candidate && allowed.includes(candidate));
}
