# SSAG Revenue Integration — Employee Call Dispatch

## Status and scope

This is a **proposed operating plan**, not a report of a completed SSAG/CRM integration. The mappings below are checked against the repository's current `main` schema, API specification, and README. “Not implemented” means no supporting model or API is present in this repository; it does not make a claim about separate SSAG systems.

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

## Current implementation mapping

| Plan capability | Evidence in current repository | Status |
|---|---|---|
| Tenant separation | Records are scoped by `organization_id`; no division field is defined. | Partial: organization scope exists; SSAG division mapping does not. |
| Lead, campaign, source, status, disposition, next action, follow-up | No lead/campaign model or outbound CRM API is listed in `schema.sql` or `API_SPEC.md`. Calls have a JSON metadata field, but no shared, validated lead contract. | Not implemented. |
| Employee dispatch | Shift/duty and call-routing support exist for inbound calls. | Inbound routing implemented; outbound lead dispatch is not shown. |
| Appointment linkage | Appointments can be stored and listed, but have no lead or campaign foreign key. | Partial: appointment records exist; the plan's lead/campaign linkage is not implemented. |
| Suppression / opt-out / DNC gate | No suppression fields, list, or dispatch check is specified in the schema/API. | Not implemented in this repository. |
| Owner metrics | Calls, shifts, and appointments provide some source data. No explicit qualified-opportunity, show, close, setup-revenue, MRR, division, or campaign attribution model is defined. | Partial; several listed metrics cannot be produced from the documented contract. |
| Automatic cross-sell review task | No client/service relationship or review-task model/API is specified. | Not implemented. |
| Provider-neutral telephony | README documents a generic signed inbound webhook contract and says a carrier/SIP/voice provider must connect it to the phone network. | Inbound interface is provider-neutral; no connected provider or outbound integration is evidenced here. |

The current API contract documents inbound call/SMS webhooks and admin call/appointment reads. It does not document outbound campaign ingestion, CRM synchronization, disposition submission, or cross-sell task creation. The repository also does not establish that the SSAG division systems named above expose compatible interfaces.

## Operating rule
No lead should end a call without a recorded disposition and next action. No qualified lead should exist outside the CRM. No appointment should be counted unless it is attached to a prospect and campaign.

These are target operating controls. The current repository does not enforce them because it has no lead/disposition workflow or appointment-to-lead/campaign relationship.

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

The listed revenue and outcome metrics require a connected sales/CRM source and agreed attribution rules before they can be treated as live dashboard measures.

## Cross-sell rule
Each closed client should automatically create a review task for other applicable SSAG services. The goal is not one sale per customer; the goal is one entry service followed by the highest-value relevant combination of platform, automation, advisory, security, growth, and licensing services.

This is a proposed workflow; automatic task creation is not implemented in the current dispatch repository.

## Architecture principle
Employee Call Dispatch remains an execution module. SSAG Master Platform remains the system of record. Telephony should be provider-neutral so carriers or AI voice systems can be changed without rebuilding CRM, reporting, or workflow logic.

The repository documents only the dispatch-side inbound webhook boundary. The SSAG system-of-record interface and outbound provider contract remain to be defined.
