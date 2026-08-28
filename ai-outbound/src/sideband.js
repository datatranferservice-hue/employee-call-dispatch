import WebSocket from "ws";
import { query } from "./db.js";
import { bookAppointment, finishSession } from "./engine.js";
import { referRealtimeCallToOwner } from "./openai.js";

const active = new Map();
const processedToolCalls = new Set();
const ignoredEventTypes = new Set([
  "response.output_audio.delta",
  "response.audio.delta",
  "input_audio_buffer.speech_started",
  "input_audio_buffer.speech_stopped"
]);

function realtimeWsUrl(callId) {
  const base = process.env.OPENAI_REALTIME_WS_BASE || "wss://api.openai.com/v1/realtime";
  const url = new URL(base);
  url.searchParams.set("call_id", callId);
  return url.toString();
}

async function logEvent(sessionId, event) {
  if (!event?.type || ignoredEventTypes.has(event.type)) return;
  const payload = { ...event };
  for (const key of Object.keys(payload)) {
    if (key.includes("audio") && typeof payload[key] === "string" && payload[key].length > 2048) {
      payload[key] = `[omitted ${payload[key].length} chars]`;
    }
  }
  await query(`INSERT INTO ai_events(session_id,event_type,payload) VALUES($1,$2,$3)`, [sessionId, event.type, payload]);
}

async function logTurn(sessionId, speaker, text, metadata = {}) {
  const clean = String(text || "").trim();
  if (!clean) return;
  await query(`INSERT INTO ai_turns(session_id,speaker,text,metadata) VALUES($1,$2,$3,$4)`, [sessionId, speaker, clean, metadata]);
}

function send(ws, event) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
}

async function toolAlreadyProcessed(sessionId, toolCallId) {
  if (processedToolCalls.has(toolCallId)) return true;
  const result = await query(`SELECT 1 FROM ai_events WHERE session_id=$1 AND event_type='tool.executed' AND payload->>'call_id'=$2 LIMIT 1`, [sessionId, toolCallId]);
  return result.rowCount > 0;
}

async function executeTool(sessionId, callId, event) {
  const toolCallId = String(event.call_id || "");
  if (!toolCallId || await toolAlreadyProcessed(sessionId, toolCallId)) return { duplicate: true };
  let args = {};
  try { args = JSON.parse(event.arguments || "{}"); }
  catch { throw new Error(`Invalid arguments for ${event.name}`); }

  let result;
  if (event.name === "mark_do_not_call") {
    result = await finishSession(sessionId, {
      outcome: "do_not_call",
      summary: args.reason || "Prospect requested no further calls"
    });
  } else if (event.name === "request_callback") {
    if (!args.callback_at) throw new Error("callback_at is required");
    result = await finishSession(sessionId, {
      outcome: "callback",
      callbackAt: args.callback_at,
      summary: args.notes || "Prospect requested callback"
    });
  } else if (event.name === "book_discovery") {
    if (!args.scheduled_at) throw new Error("scheduled_at is required");
    result = await bookAppointment(sessionId, args.scheduled_at, args.notes || "Booked by AI outbound caller");
  } else if (event.name === "transfer_to_owner") {
    await referRealtimeCallToOwner(callId);
    result = await finishSession(sessionId, {
      outcome: "connected",
      summary: `Transferred to configured human owner/closer. ${args.reason || "Prospect requested human transfer."}`
    });
  } else if (event.name === "record_disposition") {
    result = await finishSession(sessionId, {
      outcome: args.outcome,
      callbackAt: args.callback_at || null,
      summary: args.summary || null
    });
  } else {
    throw new Error(`Unknown tool: ${event.name}`);
  }

  processedToolCalls.add(toolCallId);
  await query(`INSERT INTO ai_events(session_id,event_type,payload) VALUES($1,'tool.executed',$2)`, [sessionId, {
    call_id: toolCallId,
    name: event.name,
    arguments: args,
    result: { ok: true }
  }]);
  return result;
}

export function attachRealtimeSideband({ callId, sessionId }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  if (active.has(callId)) return active.get(callId);

  const ws = new WebSocket(realtimeWsUrl(callId), {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
  });
  const handle = { callId, sessionId, ws, connected: false };
  active.set(callId, handle);

  ws.on("open", async () => {
    handle.connected = true;
    try {
      await query(`INSERT INTO ai_events(session_id,event_type,payload) VALUES($1,'sideband.connected',$2)`, [sessionId, { call_id: callId }]);
    } catch (error) { console.error("sideband open log", error.message); }
  });

  ws.on("message", async raw => {
    let event;
    try { event = JSON.parse(raw.toString()); }
    catch { return; }
    try {
      await logEvent(sessionId, event);
      if (event.type === "conversation.item.input_audio_transcription.completed") {
        await logTurn(sessionId, "lead", event.transcript, { item_id: event.item_id });
      } else if (event.type === "response.output_audio_transcript.done") {
        await logTurn(sessionId, "agent", event.transcript, { response_id: event.response_id, item_id: event.item_id });
      } else if (event.type === "response.function_call_arguments.done") {
        try {
          const result = await executeTool(sessionId, callId, event);
          send(ws, {
            type: "conversation.item.create",
            item: { type: "function_call_output", call_id: event.call_id, output: JSON.stringify({ ok: true, result }) }
          });
          if (event.name !== "transfer_to_owner") send(ws, { type: "response.create" });
        } catch (error) {
          await query(`INSERT INTO ai_events(session_id,event_type,payload) VALUES($1,'tool.failed',$2)`, [sessionId, {
            call_id: event.call_id,
            name: event.name,
            error: error.message.slice(0, 500)
          }]);
          send(ws, {
            type: "conversation.item.create",
            item: { type: "function_call_output", call_id: event.call_id, output: JSON.stringify({ ok: false, error: "Action could not be completed. Ask the prospect for another option or end politely." }) }
          });
          send(ws, { type: "response.create" });
        }
      }
    } catch (error) {
      console.error("sideband message", error.message);
    }
  });

  ws.on("error", error => console.error("realtime sideband error", error.message));
  ws.on("close", async (code, reason) => {
    active.delete(callId);
    try {
      await query(`INSERT INTO ai_events(session_id,event_type,payload) VALUES($1,'sideband.closed',$2)`, [sessionId, {
        call_id: callId,
        code,
        reason: String(reason || "").slice(0, 200)
      }]);
      if (handle.connected) {
        const state = await query(`SELECT status,disposition FROM ai_call_sessions WHERE id=$1`, [sessionId]);
        if (state.rows[0]?.status === "active" && !state.rows[0]?.disposition) {
          await finishSession(sessionId, {
            outcome: "connected",
            summary: "Connected AI conversation ended without a more specific disposition."
          });
        }
      }
    } catch (error) { console.error("sideband close log", error.message); }
  });

  return handle;
}

export function sidebandStatus() {
  return { active: active.size, calls: [...active.values()].map(v => ({ callId: v.callId, sessionId: v.sessionId, connected: v.connected })) };
}
