# Sentinel Zero AI Outbound Caller

Production control-plane service for AI-assisted outbound business calling.

## What this service does

- Reads approved campaigns and queued leads from the Sentinel Zero Neon database.
- Enforces campaign status, calling windows, concurrency, retry limits, DNC suppression, and per-lead AI-call permission gates.
- Creates durable AI call sessions and links them to campaign leads.
- Supports `simulation` and `asterisk` transports.
- Provides authenticated owner/admin controls for status, campaign start/pause, dispatch, session completion, and appointment booking.
- Accepts correlated OpenAI Realtime SIP incoming-call events and supplies a Sentinel Zero voice-agent prompt.
- Supports Asterisk call-state callbacks for answered/completed calls.
- Updates leads, callbacks, appointments, and call attempts after a conversation.

## Hard safety gates

Live outbound calling is fail-closed. A real campaign cannot run unless all applicable gates pass:

1. Campaign compliance status is approved.
2. Service-level `ALLOW_LIVE_AI_CALLS=true` is explicitly set.
3. Lead is not marked do-not-call.
4. Lead has a phone number.
5. Lead contains the required `[AI_CALL_OK]` permission marker when `REQUIRE_LEAD_AI_PERMISSION_FLAG=true`.
6. The call is inside the campaign's configured local call window.
7. Asterisk/SIP transport is configured for live dialing.
8. The AI identifies itself as an AI voice assistant in the conversation instructions.

Do not disable these controls merely to increase call volume.

## Architecture

`Campaign -> Lead Queue -> Compliance Gate -> AI Call Session -> Asterisk/SIP -> OpenAI Realtime Voice -> Disposition -> Lead/Appointment/Call Attempt`

The human Call Command dashboard is separate. It may be used by staff, but this service is the autonomous campaign control plane.

## Current deployment

Render service: `sentinel-zero-ai-outbound`

Public health/control-plane base URL:

`https://sentinel-zero-ai-outbound.onrender.com`

Administrative endpoints require the server-side bearer token. Secrets must never be placed in browser code or committed to GitHub.

## Required external production dependencies

A real public telephone call still requires a lawful PSTN/SIP carrier or trunk. A cellphone can be the verified business caller identity and human handoff/test destination where the carrier permits it, but an ordinary cellphone alone is not a server-controlled AI audio trunk.

OpenAI Realtime voice also requires a server-side OpenAI API credential. Keep it in the hosting environment only.

## QA status

The simulation campaign has passed queue reservation and AI-session creation/completion using a fictional 555 destination. No external call was made during that test. The QA campaign is paused after verification.
