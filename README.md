# CallFlow Command v0.2

Standalone operations platform.

## Owner/Admin controls
- Business hours by day
- Temporary closed override
- Time zone
- After-hours SMS message
- Callback queue behavior
- On-call forwarding number
- Routing strategy: round-robin / fewest calls / longest idle
- Ring duration and max attempts
- Overflow rules
- Employee duty status
- Call and appointment metrics
- Audit log

## Production standard
Frontend is a prototype. Production authority belongs server-side behind Auth/RBAC, PostgreSQL, signed telephony webhooks, audit logging, rate limits, encrypted secrets, backups, and atomic call assignment.
