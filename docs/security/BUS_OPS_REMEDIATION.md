# Bus Ops enterprise remediation — implementation and release checklist

Base: `fe2a0891524d999859c75bb5458cfc592dcaa06d`. This change is a draft implementation, not a production deployment or a claim that all 28 audit findings are closed.

## Implemented controls

Every current human Bus Ops route invokes an authoritative service guard. It verifies the signed session, current tenant and user status, database revocation records, effective membership permissions and the enabled module assignment. An unavailable authority denies access with 503. Exact route/method capabilities replace broad HTTP heuristics within `/api/bus-ops/`; unknown actions deny access. Bus Ops middleware enforcement cannot be disabled by `AUTHZ_MODE`. Other modules and the separate route-optimizer API retain their existing policies.

Credential rotation requires a dedicated capability and session-bound step-up. Ordinary gateway responses use a credential-free DTO. Device writes and reads resolve the parent within the tenant; the device migration backfills tenant ownership, forces RLS and checks parent ownership with database triggers.

Departure requires all ten checklist items, the latest passing inspection, the current assigned vehicle and driver, and evidence no older than 24 hours. Failed or reassigned inspections block departure. Arbitrary header overrides are refused. Schedule PATCH accepts business fields only; status, identifiers, counters and deletion metadata cannot bypass commands. Assignment validation is mandatory. Assignment transactions use tenant RLS and reuse an existing transaction instead of nesting one.

Passenger self-service binds the targeted employee to the account or an explicit dispatcher grant. Check-in resolves passenger membership in the tenant/trip, validates stop and time, serializes with departure and applies BOARD/ALIGHT transitions through the attendance state machine. Trip depart/complete/cancel atomically await their outbox write and required audit. Departure alerts run after commit. Operational schedule reads bypass both server and browser caches.

Signed gateway event/scan timestamps must be within five minutes. A tenant/device/body-hash receipt rejects identical replay for ten minutes, after which the original timestamp is stale. Empty heartbeat requests change no attendance and are exempt. Gateway ingestion denies inactive tenants and disabled Bus Ops assignments; scheduled trip resolution has a 24-hour lower bound. Shared-secret retirement, signed explicit trip binding and key-version rotation remain open.

## Finding status

“Implemented” below means code exists; migration, runtime and concurrency acceptance still require staging. “Partial” and “open” are not closed audit findings.

| Finding | Status | Delivered / remaining |
|---|---|---|
| F01 | Implemented; migration pending | Parent checks, tenant columns, RLS, parent consistency triggers. Exercise real database isolation and backfill before release. |
| F02 | Implemented | Credential-free reads; separate stepped-up rotation, no-store secret response, required audit. |
| F03 | Implemented | Header override denied. Any emergency override needs a separate approval workflow. |
| F04 | Implemented with bounded freshness | Complete latest inspection bound to current vehicle/driver. Tenant service-day semantics remain F28. |
| F05 | Implemented | Strict PATCH allowlist and scheduled-state assignment gate. |
| F06 | Implemented for human Bus Ops routes | Employee/account binding or explicit passenger edit delegation. Provision correct custom self-service grants and verify employee links. |
| F07 | Implemented for human check-in | Trip/passenger/employee/stop/time checks and state-machine transitions. Database relational invariants remain F22. |
| F08 | Partial | Freshness and signed-body replay receipts. Retire shared key, add firmware key versions and signed intended trip. |
| F09 | Implemented for Bus Ops human APIs | Mandatory middleware and authoritative service enforcement. Platform-wide enforcement rollout is separate. |
| F10 | Implemented for current Bus Ops route registry | 107 explicit route templates, method/resource coverage test; separate API aliases require a follow-up review. |
| F11 | Partial | Finite/ranged coordinates, tenant-owned vehicle, matching assigned trip, bounded ping times. Driver/device identity binding, monotonic projection and trusted labels remain. |
| F12 | Partial | Human and gateway status gates. Scheduled service jobs still require dedicated service policy. |
| F13 | Implemented | Sequential replacement in the existing transaction; canonical module validation. |
| F14 | Partial | Enabled assignment is required at the human/gateway service boundary. Purchased entitlement and plan reconciliation need a common platform entitlement authority. |
| F15 | Implemented for Bus Ops administrative guards | Effective database custom-role grants; no built-in role reconstruction. |
| F16 | Open | Resumable multi-schema/store offboarding, retention/legal hold and verification. Do not use the current generic hard-delete flow as enterprise offboarding. |
| F17 | Partial | Human Bus Ops checks database revocations and fails closed. Other platform/session paths still need outage-safe revocation. |
| F18 | Open | Dedicated service principal, tenant scope, nonce/key version, key rotation, job run audit and retry/dead-letter policy. Existing sweeps have not been rewritten. |
| F19 | Partial | Waitlist joins lock the trip before checking status/duplicates. Promotion serialization, active-membership uniqueness and real parallel tests remain. |
| F20 | Partial | Required audit/outbox on critical trip commands, inspection and rotation. Extend atomic audit and durable notification intents to all sensitive commands. |
| F21 | Open | Atomic/idempotent recharge batches, immutable policy/usage snapshot, decimal finance validation. Permission registry separates recharge from routine operations. |
| F22 | Partial | Device parent consistency added. Composite trip/staff relationships, active-membership uniqueness and append-only attendance remain. |
| F23 | Implemented | Assignment safety cannot be disabled with a process flag. |
| F24 | Partial | New blocking security/typecheck workflow; repaired lockfile for clean installs. Configure branch protection to require it and run real migration/concurrency gates. Existing production build workflow already blocks build failures. |
| F25 | Partial | Bounded departure/active-trip windows. Gateway resolution still needs signed intended-trip/event-time binding. |
| F26 | Partial | Require real target, bind subject and reject unsupported future-date changes. Structured stop IDs and approved effective-date workflow remain. |
| F27 | Implemented | Dispatch schedules use private no-store reads. |
| F28 | Open | Tenant IANA timezone, service-day policy and DST/overnight coverage. |

## Validation

- TypeScript project check passes on the available Node 24 runtime; CI targets the project's Node 22 engine.
- Final CI security selection: 414 passing tests across nine files.
- Bus Ops regression selection: 411 passing tests across 15 files. The trip-completed consumer suite logs that its live server/database path is unavailable, so this count is not proof of database integration.
- Global authorization matrix: 37 passing tests after regenerating its documentation and preserving the separate route-optimizer policy.
- New tests cover exact route capabilities, malformed safety evidence, custom role grants, suspension/module denial, revocations, authority outage, step-up, parent isolation, signed-body replay and stale timestamps.
- Clean-install dry run succeeds after adding missing optional resolver/WASM entries to package-lock.json. No package versions were deliberately upgraded.
- Live PostgreSQL migration, FORCE RLS under the application role, race/rollback fault injection, end-to-end UI and production build were not executed here. They are release blockers, not implied passes.

## Release sequence and acceptance

1. Use a production-shaped isolated database. Back up and inventory device parents; resolve orphan/cross-tenant rows before applying migrations. Migrations intentionally abort on orphan ownership rather than inventing a default tenant. These migration directory names precede some existing future-dated repository migrations; test deployment order/drift against the actual migration history. Check table ownership, application grants and FORCE RLS behavior.
2. Apply both new migrations, regenerate Prisma and verify database-backed session revocation availability. Do not deploy the new client before its required columns/tables exist. Exercise tenant A/B device GET/PUT/DELETE as the application database role: foreign parents and crafted tenant/parent SQL must fail without mutation.
3. Refresh signed sessions after the permission catalogue changes; older versioned bitsets are invalid. Confirm tenant overrides/custom roles contain exact grants. Self-service needs `view/create:self-service`, with account employee linkage; operators targeting others additionally need `edit:passengers`. Rotation needs `admin:device-credentials`; recharge needs `admin:finance-recharge`. Do not blanket-grant these capabilities.
4. Verify suspended tenants, disabled modules, inactive memberships and revoked users immediately lose access, including valid gateway signatures. Simulate database authority outage and expect 503 without business writes. Hardware must provide synchronized signed event/scan timestamps within five minutes; buffered older events now fail rather than silently attach to current trips.
5. Fault-inject audit and outbox writes on depart/complete/cancel: state/log/passenger changes must roll back. Send two concurrent departure requests: one starts and one conflicts, with one trip log/outbox event. Run pretrip failure/reassignment and check-in/depart races. Verify dispatcher/employee flows, normal alerts and BOARD/ALIGHT idempotence end to end.
6. Run the complete blocking build and security gates on Node 22. Require their statuses in branch protection. Keep this PR draft until migration and browser acceptance evidence is attached.
7. Continue the open service identity, finance, data-model, offboarding and timezone work in separate changes with their own deployment tests. No credentials were rotated, no migration was run, and main was not merged or deployed by this work.
