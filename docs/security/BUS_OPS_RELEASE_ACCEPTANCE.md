# Item 5 — Bus Ops release acceptance

Draft PR #172 contains Items 1–4. This record separates code and isolated CI evidence from acceptance on the signed-in staging deployment. Passing CI does not authorize production migration, passenger delivery, or merge.

## Automated gates

| Area | Blocking evidence | Remaining acceptance |
| --- | --- | --- |
| Policy and roles | Exact route/method matrix, authoritative guard, current membership/module/revocation checks, TypeScript | Refresh versioned sessions; inspect actual tenant custom roles and employee links; outage denial against staged authority |
| Tenant and database | Tenant RLS and Safety workflows; fresh migration replay; dedicated rider, disruption, and consolidation evidence PostgreSQL jobs | Check deployed migrations/grants/FORCE RLS under the staging application role and foreign-tenant request denial |
| Rider events | Isolated delivery claims, idempotency, retry/uncertain state; notification opt-in | Synthetic trip event → consumer → worker with quarantined email/SMS/WhatsApp; prove disabled rules and failure behavior |
| Disruption response | PostgreSQL unique open response, locks, rollback, audit evidence and browser flows | Signed-in dispatcher replacement on isolated trip with capacity/inspection evidence and concurrent request/rollback checks |
| Passenger journey | ETA/occupancy unit and browser cases, stale GPS fallback | Real staging telemetry on the assigned vehicle, boarding/stop events, stale/old-vehicle GPS, tenant privacy |
| Consolidation and cost | Read-only historical query under non-bypass RLS, attendance aggregates and complete-log accounting | Representative customer period and operations-approved baseline; reconcile manifests, vehicle duty, stop timing and cost rates; no realized-saving claim without a pre/post study |

## Staging procedure

1. Verify the Railway project and exact staging environment, deployment SHA, database identity and application role. Confirm it is isolated from production before migrations or fixture writes.
2. Apply the candidate migrations to the isolated database, regenerate Prisma, and verify grants and FORCE RLS as the application role. Abort on unknown/orphan ownership. Capture rollback path and migration history.
3. Use two synthetic tenants, synthetic contacts, disabled external transports and controlled GPS. Check positive and denied paths, rollback, concurrent commands, notification idempotency and worker uncertainty. Do not send to actual passengers.
4. Run the signed-in dispatcher and passenger journeys in light/dark and mobile/desktop. Inspect UI and persisted rows after each state change. Verify no cross-tenant identity or roster disclosure.
5. Reconcile the Item 4 evidence tool against an approved customer dataset or anonymized tenant export. Record sample size, missing logs and assumptions. Keep sensitive records outside the PR; attach only redacted aggregate evidence.

Staging access and approved customer data are unavailable in this workspace, so these checks are **not run**. PR #172 stays draft. The automated workflow result should be linked here after the Item 5 commit completes.
