# Asterisk Bridge for Sentinel Zero AI Outbound

This directory contains deployment templates for the telephone-network boundary of the Sentinel Zero AI outbound caller.

## Two network-leg options

### Option A — SIP/PSTN carrier

Use `ASTERISK_CHANNEL_TEMPLATE=PJSIP/{phone}@carrier` and configure the carrier sections in `pjsip.conf`.

### Option B — the owner's cellphone as the cellular trunk

Asterisk officially supports Bluetooth cellphones through `chan_mobile`. With a compatible phone paired to a Linux/Asterisk machine with Bluetooth, Asterisk can dial through the mobile line using `Mobile/<device>/<number>`.

For the supplied template:

`ASTERISK_CHANNEL_TEMPLATE=Mobile/owner_cell/{phone}`

and configure `chan_mobile.conf` from `chan_mobile.conf.example`.

This path can use the cellphone's cellular service for the public telephone leg instead of a separate SIP carrier, but it still requires a physical Linux/Asterisk host within Bluetooth range of the phone, a compatible Bluetooth Hands-Free Profile implementation, and use that complies with the mobile carrier's service terms and applicable calling rules. Phone compatibility must be tested; Asterisk documents that different phones implement Bluetooth HFP differently.

## Call path

1. The Render control plane selects an eligible campaign lead and creates a durable `ai_call_sessions` record.
2. Render calls Asterisk ARI to originate the prospect leg through either the SIP carrier or the Bluetooth cellphone.
3. Asterisk sends the answered prospect into the `ssag-ai-outbound` dialplan context.
4. Only after answer, Asterisk dials the OpenAI Realtime project SIP URI:
   `sip:<OPENAI_PROJECT_ID>@sip.api.openai.com;transport=tls`.
5. The Asterisk pre-dial handler adds `X-SSAG-Session-ID` to the OpenAI SIP leg.
6. OpenAI emits `realtime.call.incoming` to the Render webhook.
7. Render verifies the OpenAI webhook, looks up the exact database session, accepts the Realtime call, and opens a sideband WebSocket.
8. Prospect and AI transcripts, actions, DNC requests, callbacks, appointments, and dispositions are stored in Neon.
9. If the prospect explicitly wants a human now and `OWNER_TRANSFER_NUMBER` is configured, the AI may transfer the active call to that server-controlled cellphone/human destination.

## Files

- `pjsip.conf.example` — SIP carrier and OpenAI TLS endpoint template.
- `chan_mobile.conf.example` — Bluetooth cellphone/GSM trunk template.
- `extensions.conf.example` — answered-call bridge to OpenAI with durable session correlation.
- `ari.conf.example` — ARI application account template.
- `http.conf.example` — secure/private ARI binding template.

## Deployment boundary

Do not put carrier credentials, Bluetooth device addresses, ARI passwords, OpenAI credentials, project IDs, or real phone numbers in GitHub. Substitute them only on the Asterisk host or secure hosting environment.

Asterisk must run on infrastructure that can handle the chosen phone-network leg and the SIP/RTP media connection to OpenAI. Keep ARI private or behind a secured tunnel/reverse proxy; do not expose it unauthenticated to the public internet.

## Production acceptance gate

Do not set `ALLOW_LIVE_AI_CALLS=true` until all applicable items pass:

- One outbound network leg is working: SIP/PSTN carrier **or** a tested compatible Bluetooth cellphone.
- Caller identity is correct and authorized for the selected network leg.
- Asterisk ARI is reachable only through an authenticated/restricted path.
- Asterisk can place a controlled call to an approved test destination.
- OpenAI project SIP route and signed webhook are configured.
- OpenAI Realtime voice credential/billing is active.
- The test conversation records transcript turns and a final disposition in Neon.
- DNC suppression, retry logic, hourly limits and calling-window tests pass.
- The live campaign has documented compliance approval and only approved leads are queued.

The system is intentionally fail-closed before those conditions are met.
