# SSAG Revenue Integration — Employee Call Dispatch

## Purpose
Use Employee Call Dispatch as the human-call and appointment-setting execution layer for SSAG revenue routes without rebuilding a separate calling workflow for every division.

## Revenue routes to connect

### Sentinel Zero
- load qualified cybersecurity prospects into the shared CRM
- dispatch calls to on-duty employees
- track call disposition, appointment count, check-in/out, and follow-up tasks
- route booked cybersecurity discovery calls to the closer

### Legal LeadGen
- feed eligible law-firm prospects from the Legal LeadGen module
- exclude suppressed/opt-out/DNC records before dispatch
- record dispositions consistently
- book qualified discovery appointments
- send no-answer and follow-up records back to the CRM queue

### Hospitality OS
- use the dispatch team for hotel/motel/property outreach
- book demos for Hospitality OS
- track which vertical, property type, source, and offer produced each appointment
- cross-sell automation, mobile security, and managed services after qualification

### Mobile Security / Sentinel Mobile
- target organizations with employee mobile-device exposure
- qualify device count, current controls, decision maker, and managed-service interest
- book security assessment calls

### SSAG Turnkey / Licensing
- use dispatch as the outbound channel for operator-license prospects
- track package interest, qualification, and follow-up

## Shared data contract
Every prospect should carry:
- tenant / division
- campaign
- business name
- contact name
- phone
- source
- status
- disposition
- next action
- next contact time
- appointment time
- assigned employee
- notes

## Operating rule
No lead should end a call without a recorded disposition and next action. No qualified lead should exist outside the CRM. No appointment should be counted unless it is attached to a prospect and campaign.

## Metrics for the owner dashboard
- employees currently on duty
- calls attempted
- live conversations
- qualified opportunities
- appointments booked
- show rate
- close rate
- setup revenue
- new MRR
- revenue by division
- revenue by caller
- revenue by campaign/source

## Cross-sell rule
Each closed client should automatically create a review task for other applicable SSAG services. The goal is not one sale per customer; the goal is one entry service followed by the highest-value relevant combination of platform, automation, advisory, security, growth, and licensing services.

## Architecture principle
Employee Call Dispatch remains an execution module. SSAG Master Platform remains the system of record. Telephony should be provider-neutral so carriers or AI voice systems can be changed without rebuilding CRM, reporting, or workflow logic.
