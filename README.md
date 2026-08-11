# CallFlow Command v1.0

A production-oriented employee call-dispatch platform.

## What this build does

- Employee email/password authentication through Supabase Auth.
- New employee accounts start inactive.
- Employee enters their own forwarding/mobile number.
- Phone ownership is verified with a Twilio Verify OTP.
- Owner/admin must separately approve the verified routing number.
- Owner/admin must activate the employee account.
- Employee can then switch **ON DUTY / OFF DUTY** from a phone.
- Customer calls enter one business number and hit the server-side router first.
- Router checks business hours and temporary closed override.
- Router selects only active + verified + approved + on-duty + non-busy employees.
- Atomic PostgreSQL selection prevents two calls from claiming the same employee at the same time.
- Routing modes: even rotation, fewest routed calls, longest idle.
- No-answer/busy/failed calls automatically retry the next eligible employee.
- Overflow can go to voicemail, an on-call number, or polite disconnect.
- Optional after-hours SMS.
- Call ledger, attempts, appointments, callback queue, voicemail metadata, and audit log.
- Owner and employee views are separated by server-enforced RLS, not merely hidden buttons.

## Call path

`Customer -> business phone number -> Twilio webhook -> voice-router Edge Function -> PostgreSQL routing decision -> verified employee phone -> call result -> call ledger`

The employee's personal number is never advertised to the customer. Customers call the business number. CallFlow decides who receives the call.

## Why GitHub Pages alone is not enough

GitHub Pages can host the interface, but it cannot receive carrier webhooks, safely keep telephony secrets, authenticate employees, or run an atomic database routing transaction. This build therefore uses:

- **GitHub Pages** — dashboard UI.
- **Supabase Auth/PostgreSQL/Edge Functions** — authentication, database, permissions, and routing backend.
- **Twilio Voice/Verify** — connection to the public telephone network and phone ownership verification.

The telephony layer is isolated to the Edge Functions so a different SIP/webhook carrier can be substituted later without redesigning the dashboard/database.

## Files

- `index.html` — complete mobile-first owner + employee UI (CSS and browser JS included in one file).
- `schema.sql` — database, RLS, audit, and atomic routing functions.
- `supabase/functions/voice-router/index.ts` — inbound call router and failover.
- `supabase/functions/admin-api/index.ts` — protected owner/admin operations and employee invites.
- `supabase/functions/employee-api/index.ts` — protected phone OTP verification.
- `supabase/config.toml` — function JWT settings.
- `DEPLOY-MOBILE-FIRST.txt` — exact setup order from a phone.
- `SECURITY-STANDARD.md` — controls included and go-live requirements.
- `TEST-CHECKLIST.md` — acceptance tests before using real customer calls.

## Required secrets

Set only in Supabase Edge Function secrets. Never put these in `index.html` or GitHub Pages:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN` — also used to validate Twilio webhook signatures.
- `TWILIO_VERIFY_SERVICE_SID`
- `TWILIO_MESSAGING_FROM` — optional, for after-hours SMS.
- `TWILIO_API_KEY_SID` — recommended for REST/Verify in production.
- `TWILIO_API_KEY_SECRET` — recommended for REST/Verify in production.
- `PUBLIC_VOICE_ROUTER_URL` — exact public URL of `voice-router`.
- `APP_ORIGIN` — your exact GitHub Pages origin, e.g. `https://datatranferservice-hue.github.io`.

Supabase supplies its own project URL, anon key, and service-role key to hosted functions.

## First owner bootstrap

1. Run `schema.sql` in Supabase SQL Editor.
2. Create the first auth account with your email/password using the dashboard or Supabase Auth.
3. Run once:

```sql
update public.profiles
set role='owner', is_active=true
where email='YOUR-REAL-LOGIN-EMAIL';
```

After that, the owner can invite employees from the dashboard.

## Production rule

Do not route real customer calls until every item in `TEST-CHECKLIST.md` passes.
