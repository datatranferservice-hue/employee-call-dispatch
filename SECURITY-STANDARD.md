# CallFlow Command — Security / Production Standard

## Controls already built

1. **Server-enforced role separation** — owner/admin privileges are checked in the backend and RLS, not only hidden in the UI.
2. **Least-privilege profile editing** — employees can edit only safe self-service fields; they cannot approve their own phone, change their role, activate themselves, or mark themselves busy/free.
3. **Verified routing number** — possession of an employee phone is verified by OTP before owner approval.
4. **Two-step eligibility** — a phone must be both verified and owner-approved; the employee account must also be active and on duty.
5. **Signed telephony webhook** — inbound Twilio requests are rejected unless the Twilio signature validates against the exact public webhook URL.
6. **Secrets stay server-side** — telephony credentials and Supabase service-role credentials never belong in GitHub Pages.
7. **Atomic assignment** — PostgreSQL `FOR UPDATE SKIP LOCKED` claims one employee per routing decision and marks them busy in the same transaction.
8. **Privileged routing RPC locked down** — browser roles cannot directly call claim/release routing functions.
9. **Audit trail** — phone verification, phone approval, duty changes, employee admin changes, invites, and incoming calls are recorded.
10. **OTP resend control** — repeated phone-code requests are throttled to at least 60 seconds per employee.
11. **CORS allow-list support** — admin/employee Edge APIs can be restricted to the exact application origin with `APP_ORIGIN`.
12. **RLS data privacy** — a normal employee sees their own profile and calls assigned to them; owner/admin sees the organization view.
13. **Failover routing** — no-answer/busy/failed attempts release the employee and continue to another eligible employee.
14. **No live-call recording by default** — this build records voicemail only, reducing unnecessary privacy exposure.

## Required before real customer traffic

- Require HTTPS everywhere.
- Set `APP_ORIGIN` to the production dashboard origin.
- Turn on MFA for owner/admin accounts in the identity layer if available.
- Use a Twilio API key/secret for REST calls; retain the Auth Token only where Twilio signature validation requires it.
- Confirm database backups / point-in-time recovery appropriate for the business.
- Decide voicemail retention and access policy.
- Configure carrier fraud controls, geographic permissions, and spend limits.
- Run every test in `TEST-CHECKLIST.md`.
- Do not enable live-call recording without reviewing applicable consent/privacy laws for every jurisdiction involved.
