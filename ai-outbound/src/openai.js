const apiBase = process.env.OPENAI_API_BASE || "https://api.openai.com/v1";

export function aiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function buildInstructions({ script, lead, company = "Sentinel Zero" }) {
  return [
    script?.system_prompt || "You are a professional outbound business development voice agent.",
    `You are calling on behalf of ${company}.`,
    `Prospect company: ${lead?.company_name || "unknown"}. Contact: ${lead?.contact_name || "unknown"}.`,
    `Opening: ${script?.opening_text || "Introduce yourself clearly and state why you are calling."}`,
    "At the beginning of the live conversation, clearly disclose that you are an AI voice assistant calling on behalf of the company.",
    "Your goal is only to identify the right decision-maker, briefly qualify whether there is a relevant operational/cybersecurity need, and if appropriate request a short discovery appointment with a human closer.",
    "Do not claim HIPAA compliance, guaranteed breach prevention, guaranteed insurance savings, audit completion, monitoring, legal conclusions, or guaranteed results.",
    "Do not quote final pricing unless the script explicitly authorizes it.",
    "If the person says stop, do not call, remove me, or otherwise opts out, apologize briefly, confirm the request, and end the call immediately.",
    "If asked whether you are human, answer truthfully that you are an AI voice assistant.",
    "Be concise, conversational, and respectful. Do not pressure the person."
  ].join("\n");
}

export async function acceptRealtimeSipCall({ callId, instructions }) {
  if (!aiConfigured()) throw new Error("OPENAI_API_KEY is not configured");
  const response = await fetch(`${apiBase}/realtime/calls/${encodeURIComponent(callId)}/accept`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      type: "realtime",
      model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini",
      instructions,
      output_modalities: ["audio"],
      tracing: "auto"
    })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI Realtime accept failed (${response.status}): ${body.slice(0, 500)}`);
  }
  return { ok: true };
}

export function extractIncomingCall(payload) {
  const type = payload?.type || payload?.event?.type;
  if (type !== "realtime.call.incoming" && type !== "live.call.incoming") return null;
  const data = payload?.data || payload?.event?.data || {};
  const callId = data.call_id || data.id || payload.call_id;
  const headers = data.sip_headers || data.headers || {};
  const headerPairs = Array.isArray(headers) ? headers : Object.entries(headers).map(([name, value]) => ({ name, value }));
  const sessionHeader = headerPairs.find(h => String(h.name || "").toLowerCase() === "x-ssag-session-id");
  return { callId, sessionId: sessionHeader?.value || data.metadata?.ssag_session_id || null };
}
