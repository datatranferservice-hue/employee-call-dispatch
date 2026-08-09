# Production API / Routing Contract

## Auth
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/mfa/verify

## Employee
POST /api/me/shift/start
POST /api/me/shift/end
POST /api/me/status/busy
POST /api/me/status/available

## Admin
GET/POST/PATCH /api/admin/employees
GET/PUT /api/admin/business-hours
GET/PUT /api/admin/settings
GET /api/admin/calls
GET /api/admin/appointments
GET /api/admin/audit

## Telephony
POST /api/webhooks/telephony/inbound
POST /api/webhooks/telephony/call-status
POST /api/webhooks/telephony/inbound-sms
POST /api/webhooks/telephony/sms-status

## Required server logic
1. Validate provider webhook signature.
2. Resolve organization from called number.
3. Resolve current time in organization time zone.
4. Check temporary closed override and business-hours table.
5. Closed: execute configured after-hours SMS/voicemail/callback/on-call flow.
6. Open: select only employees with open shifts and eligible status.
7. Apply round-robin, fewest-calls, or longest-idle strategy.
8. Ring for configured duration; record each attempt.
9. Apply max attempts and overflow rule.
10. Store immutable audit event.

## Production standards
Server-side RBAC, MFA for admins, HTTPS, Argon2id/bcrypt passwords, signed webhooks, atomic routing assignment, idempotency, rate limiting, structured logs, encrypted secrets, database backups, health checks, and tenant isolation.
