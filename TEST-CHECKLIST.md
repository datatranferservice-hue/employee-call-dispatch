# CallFlow Command — Go-Live Acceptance Tests

Do not use real customer traffic until these pass.

## Authentication / permissions
- [ ] Unknown user cannot view owner Employees, Hours, or Audit data.
- [ ] New employee account starts inactive.
- [ ] Employee cannot activate themselves.
- [ ] Employee cannot approve their own routing phone.
- [ ] Employee cannot change their role to owner/admin.
- [ ] Owner/admin can activate/deactivate an employee through the protected admin API.

## Phone verification
- [ ] Invalid phone format is rejected.
- [ ] Verification code reaches the employee's phone.
- [ ] Wrong verification code is rejected.
- [ ] Correct verification code marks the phone verified but NOT owner-approved.
- [ ] Changing the verified phone removes routing approval and turns duty off.

## Duty eligibility
- [ ] Inactive employee cannot go on duty.
- [ ] Unverified employee cannot go on duty.
- [ ] Verified but unapproved employee cannot go on duty.
- [ ] Active + verified + approved employee can go on/off duty.

## Call routing
- [ ] Fake/unsigned webhook request gets HTTP 403.
- [ ] During open hours, only eligible employees are selected.
- [ ] Busy employee is skipped.
- [ ] Two simultaneous calls do not claim the same employee.
- [ ] No-answer retries the next eligible employee.
- [ ] Busy retries the next eligible employee.
- [ ] Max attempts sends the caller to configured overflow.
- [ ] Completed call releases the employee from busy state.
- [ ] Call and each attempt appear in the ledger.

## Hours / after-hours
- [ ] Closed day never routes to normal employees.
- [ ] Temporary closed override works.
- [ ] Overnight hours (example 20:00-02:00) work correctly.
- [ ] Optional after-hours SMS is sent only when configured.
- [ ] Voicemail metadata is written after recording completes.
- [ ] Callback queue entry is created when configured.

## Owner reporting
- [ ] Owner sees employee duty state.
- [ ] Owner sees calls and appointments.
- [ ] Audit records key operational changes.
