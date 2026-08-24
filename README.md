# CallFlow Command v2.1

Production-oriented employee call dispatch and workforce operations platform.

## Implemented

- PostgreSQL-backed organizations, users, sessions, employees, shifts, calls, appointments, settings and audit events.
- Secure password hashing with Node.js scrypt.
- Secure HttpOnly cookie sessions with tokens stored only as SHA-256 hashes.
- Owner/admin/employee role enforcement on the server.
- Employee creation, activation controls, forwarding-number approval flags and duty shifts.
- Atomic inbound call assignment using PostgreSQL row locks.
- Routing modes: round robin, fewest calls and longest idle.
- Arizona-aware business hours, temporary closure and after-hours handling.
- Call-status cleanup so employees are released after completed/failed calls.
- Signed generic telephony webhook interface.
- Health check, security headers, restricted CORS and JSON limits.
- Render Blueprint and GitHub Actions validation.
- Neon PostgreSQL production database.

## Architecture

`Customer telephone provider -> /api/webhooks/telephony/inbound -> PostgreSQL routing decision -> approved on-duty employee`

The server returns the selected employee destination to a connected telephone provider. Provider credentials and webhook secrets must remain deployment secrets.

## Required production configuration

- `APP_BASE_URL`
- `DATABASE_URL`
- `DATABASE_SSL=true`
- `ALLOWED_ORIGINS`
- `TELEPHONY_WEBHOOK_SECRET`
- `NODE_ENV=production`

## Commands

```bash
npm install
npm run check
npm test
npm run migrate
npm run create-owner -- "Cezar Morris" "OWNER_EMAIL" "A-STRONG-PRIVATE-PASSWORD" "Employee Call Dispatch"
npm start
```

Never commit the real database URL, passwords or provider credentials.

## Important telephone limitation

The routing backend is provider-neutral and operational after deployment, but ordinary web hosting cannot connect calls to the public telephone network by itself. A telephone carrier, SIP trunk or programmable voice provider must send signed webhooks and act on the returned routing destination. No repository should claim that real calls or SMS are live until that provider is connected and the acceptance checklist passes.

## Acceptance gate

Do not route customer calls until:

1. The GitHub workflow, syntax checks, tests and dependency audit pass.
2. `/api/health` reports the database connected.
3. The owner account is created.
4. Test employees are verified and approved.
5. The provider webhook signature is validated.
6. Round robin, failure, overflow and after-hours tests pass.
7. Recovery and database backup access are documented.
