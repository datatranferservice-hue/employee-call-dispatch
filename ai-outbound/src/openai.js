const apiBase = process.env.OPENAI_API_BASE || "https://api.openai.com/v1";

export function aiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function ownerTransferConfigured() {
  return Boolean(process.env.OWNER_TRANSFER_NUMBER);
}

export function buildInstructions({ script, lead, company = "Sentinel Zero" }) {
  return [
    script?.system_prompt || "You are a professional outbound business development voice agent.",
    `You are calling on behalf of ${company}.`,
    `Prospect company: ${lead?.company_name || "unknown"}. Contact: ${lead?.contact_name || "unknown"}.`,
    `Opening: ${script?.opening_text || "Introduce yourself clearly and state why you are calling."}`,
    "At the beginning of the live conversation, clearly disclose that you are an AI voice assistant calling on behalf of the company.",
    "Your goal is only to identify the right decision-maker, briefly qualify whether there is a relevant operational/cybersecurity need, and if appropriate request a short discovery appointment with a human closer.",
    "If a discovery time is agreed, call book_discovery with an ISO-8601 scheduled_at value and a short factual note.",
    "If the prospect requests a callback, call request_callback with the agreed callback time.",
    "If the prospect explicitly asks to speak to the owner/human closer now, call transfer_to_owner. Never transfer merely to pressure or surprise the prospect.",
    "If the prospect says stop, do not call, remove me, or otherwise opts out, briefly confirm the request and call mark_do_not_call immediately.",
    "At the end of a connected call that did not book, opt out, transfer, or request a callback, call record_disposition exactly once with the best factual outcome.",
    "Do not claim HIPAA compliance, guaranteed breach prevention, guaranteed insurance savings, audit completion, monitoring, legal conclusions, or guaranteed results.",
    "Do not quote final pricing unless the script explicitly authorizes it.",
    "If asked whether you are human, answer truthfully that you are an AI voice assistant.",
    "Never invent an appointment time, contact name, need, result, or promise. Ask when necessary.",
    "Be concise, conversational, and respectful. Do not pressure the person."
  ].join("\n");
}

const tools = [
  {
    type: "function",
    name: "mark_do_not_call",
    description: "Immediately suppress future calls when the prospect asks not to be called or contacted by phone.",
    parameters: {
      type: "object",
      properties: { reason: { type: "string", description: "Short factual description of the opt-out request." } },
      required: ["reason"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "request_callback",
    description: "Schedule a callback only after the prospect explicitly asks for or agrees to a callback time.",
    parameters: {
      type: "object",
      properties: {
        callback_at: { type: "string", description: "Agreed callback date/time as ISO-8601." },
        notes: { type: "string", description: "Short factual callback context." }
      },
      required: ["callback_at", "notes"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "book_discovery",
    description: "Book the 15-minute human discovery/fit call only after the prospect explicitly agrees to a specific date and time.",
    parameters: {
      type: "object",
      properties: {
        scheduled_at: { type: "string", description: "Agreed appointment date/time as ISO-8601." },
        notes: { type: "string", description: "Short factual summary of why the prospect agreed to meet." }
      },
      required: ["scheduled_at", "notes"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "transfer_to_owner",
    description: "Transfer the current call to the configured human owner/closer only after the prospect explicitly asks or agrees to speak with a human now. The destination number is controlled by the server and is never supplied by the model.",
    parameters: {
      type: "object",
      properties: { reason: { type: "string", description: "Short factual reason the prospect requested a live human transfer." } },
      required: ["reason"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "record_disposition",
    description: "Record the final outcome of a connected call when no appointment, callback, transfer, or opt-out tool has already been used.",
    parameters: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: ["connected", "not_interested", "wrong_number", "voicemail", "no_answer"] },
        summary: { type: "string", description: "Short factual call summary." },
        callback_at: { type: ["string", "null"], description: "Use null unless the outcome requires a callback." }
      },
      required: ["outcome", "summary", "callback_at"],
      additionalProperties: false
    }
  }
];

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
      audio: {
        input: {
          transcription: {
            model: process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-transcribe",
            language: "en",
            keywords: ["Sentinel Zero", "cybersecurity", "HIPAA", "IT", "compliance"]
          }
        }
      },
      tools,
      tool_choice: "auto",
      parallel_tool_calls: false,
      tracing: "auto"
    })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI Realtime accept failed (${response.status}): ${body.slice(0, 500)}`);
  }
  return { ok: true };
}

export async function referRealtimeCallToOwner(callId) {
  if (!aiConfigured()) throw new Error("OPENAI_API_KEY is not configured");
  if (!ownerTransferConfigured()) throw new Error("OWNER_TRANSFER_NUMBER is not configured");
  const target = String(process.env.OWNER_TRANSFER_NUMBER).replace(/[^+\d]/g, "");
  if (!/^\+\d{8,15}$/.test(target)) throw new Error("OWNER_TRANSFER_NUMBER must be in E.164 format");
  const response = await fetch(`${apiBase}/realtime/calls/${encodeURIComponent(callId)}/refer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ target_uri: `tel:${target}` })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI Realtime refer failed (${response.status}): ${body.slice(0, 500)}`);
  }
  return { ok: true, transferred: true };
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
