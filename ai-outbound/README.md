# Sentinel Zero AI Outbound Caller

Autonomous outbound business-calling control plane for Sentinel Zero.

## Current capability

The service now provides the durable pipeline behind an AI cold-calling operation:

`Campaign -> Lead Queue -> Compliance/DNC/Time Gate -> AI Session -> PSTN/SIP -> OpenAI Realtime Voice -> Transcript/Actions -> CRM/Appointment/Follow-up`

Implemented components:

- Neon-backed campaigns, leads, retries, rate limits, AI sessions, events, transcript turns, call attempts, appointments, and DNC suppression.
- Fail-closed campaign start and dispatch controls.
- Simulation and Asterisk transports.
- Asterisk ARI originate adapter for the public telephone leg.
- OpenAI Realtime SIP call acceptance and server-side sideband control.
- AI disclosure in the voice-agent instructions.
- Live prospect and AI transcript persistence.
- Controlled AI tools for DNC, callback, discovery appointment, final disposition, and human transfer.
- Human transfer destination is server-controlled through `OWNER_TRANSFER_NUMBER`; the model cannot choose an arbitrary phone number.
- Signed OpenAI webhook verification when `OPENAI_WEBHOOK_SECRET` is configured, with a temporary bootstrap token fallback.
- Idempotent call completion so a later close event cannot overwrite a DNC or booked appointment.
- Retry handling for no-answer/voicemail calls.
- Stale-dial cleanup for calls that never reach the AI leg.
- Concurrency, hourly-volume and minimum-spacing controls.
- Owner/admin status and session APIs.

## Live activation status

The application layer is complete enough for production acceptance testing. Remaining activation work is external infrastructure/configuration:

1. Connect one real telephone-network leg to Asterisk (recommended: SIP/PSTN trunk; alternate: tested Bluetooth cellphone via `chan_mobile`).
2. Configure the OpenAI project SIP route, API credential, and signed webhook secret.
3. Configure Asterisk ARI credentials/restricted connectivity from the Render service.
4. Configure `OWNER_TRANSFER_NUMBER` for live human handoff.
5. Run one approved end-to-end test call and verify transcript, disposition, DNC, callback, appointment, and transfer behavior.
6. Only after those tests pass, set `ALLOW_LIVE_AI_CALLS=true`.

## Hard safety gates

A real campaign cannot run unless the service and campaign gates pass. In particular:

1. Campaign compliance status is approved.
2. `ALLOW_LIVE_AI_CALLS=true` is explicitly set on the service.
3. Lead is not marked do-not-call.
4. Lead has a phone number.
5. Lead contains `[AI_CALL_OK]` while `REQUIRE_LEAD_AI_PERMISSION_FLAG=true`.
6. Local campaign call window is open.
7. Asterisk/SIP transport is configured.
8. OpenAI Realtime voice is configured.
9. The AI identifies itself as an AI voice assistant.

Do not remove these controls merely to increase call volume.

## Cellphone use

A cellphone can be used as the verified business caller identity where the carrier permits it, as an approved test destination, and as the live human handoff destination. It does not itself replace the SIP/PSTN trunk required to carry server-controlled AI audio unless it is deliberately configured as the cellular trunk through a compatible Asterisk `chan_mobile` Bluetooth host.

## Telephone bridge

See `asterisk/README.md` and the example Asterisk configuration files. The intended live path is:

`Render -> Asterisk ARI -> PSTN/SIP carrier -> prospect answers -> Asterisk dialplan -> OpenAI Realtime project SIP -> signed OpenAI webhook -> sideband AI control`

## Deployment

Render service: `sentinel-zero-ai-outbound`

Base URL: `https://sentinel-zero-ai-outbound.onrender.com`

Secrets remain server-side. Do not commit carrier credentials, OpenAI keys, ARI passwords, database credentials, project IDs, or real phone numbers.

## QA

The simulation QA campaign successfully exercised campaign dispatch, queue reservation and AI-session completion with a fictional 555 destination. It explicitly recorded that no external telephone call was placed, and the campaign was paused after the test.

A real external AI call is **not** considered live until the carrier/Asterisk/OpenAI production acceptance gate passes end-to-end.
