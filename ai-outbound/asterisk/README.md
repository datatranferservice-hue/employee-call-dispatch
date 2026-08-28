# Asterisk Bridge for Sentinel Zero AI Outbound

This directory contains deployment templates for the telephone-network boundary of the Sentinel Zero AI outbound caller.

## Call path

1. The Render control plane selects an eligible campaign lead and creates a durable `ai_call_sessions` record.
2. Render calls Asterisk ARI to originate the prospect leg through the configured PSTN/SIP carrier.
3. Asterisk sends the answered prospect into the `ssag-ai-outbound` dialplan context.
4. Only after answer, Asterisk dials the OpenAI Realtime project SIP URI:
   `sip:<OPENAI_PROJECT_ID>@sip.api.openai.com;transport=tls`.
5. The Asterisk pre-dial handler adds `X-SSAG-Session-ID` to the OpenAI SIP leg.
6. OpenAI emits `realtime.call.incoming` to the Render webhook.
7. Render validates the webhook, looks up the exact database session, accepts the Realtime call, and opens a sideband WebSocket.
8. Prospect and AI transcripts, actions, DNC requests, callbacks, appointments, and dispositions are stored in Neon.
9. If the prospect explicitly wants a human now and `OWNER_TRANSFER_NUMBER` is configured, the AI may transfer the active call to that server-controlled cellphone/human destination.

## Why the cellphone is not the trunk

A cellphone can be the verified caller-ID identity, callback number, test destination, and human handoff destination when the chosen carrier permits those uses. The ordinary cellular line does not expose the server-controlled SIP/audio interface that an autonomous voice agent needs, so public outbound calls still require a PSTN/SIP carrier or trunk.

## Files

- `pjsip.conf.example` — carrier and OpenAI PJSIP endpoint/transport template.
- `extensions.conf.example` — answered-call bridge to OpenAI with session correlation header.
- `ari.conf.example` — ARI application account template.
- `http.conf.example` — secure/private ARI binding template.

## Deployment boundary

Do not put carrier credentials, ARI passwords, OpenAI credentials, project IDs, or real phone numbers in GitHub. Substitute them only on the Asterisk host or secure hosting environment.

Asterisk must run on infrastructure that can handle SIP signaling and RTP media and that can reach both the selected carrier and OpenAI. Keep ARI private or behind a secured tunnel/reverse proxy; do not expose it unauthenticated to the public internet.

## Production acceptance gate

Do not set the Render service to `ALLOW_LIVE_AI_CALLS=true` until all of the following are complete:

- SIP carrier/trunk is active and permitted for the intended calling use.
- Caller-ID identity has been verified with the carrier.
- Asterisk ARI is reachable only through an authenticated/restricted path.
- Asterisk can place a controlled call to an approved test destination.
- OpenAI project SIP route and signed webhook are configured.
- OpenAI Realtime voice credential/billing is active.
- The test conversation records transcript turns and a final disposition in Neon.
- DNC suppression and calling-window tests pass.
- The live campaign has a documented compliance approval and only approved leads are queued.

The system is intentionally fail-closed before those conditions are met.
