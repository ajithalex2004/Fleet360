# Item 1 rider notifications: validation record

Validation attempted on 2026-10-04. The table below records the initial pre-publication attempt; the publication and CI update follows it. This document is not release approval.

## Candidate

Repository: `ajithalex2004/Fleet360`; draft PR #172, branch
`codex/bus-ops-enterprise-remediation`. Remote head inspected:
`3902d50ba677807737199eab2825c8a239829527`.

The local candidate differs from that head in 28 files. The comparison used
Git blob SHA hashes against the complete, nontruncated remote tree (4,917
entries), so the preexisting security changes already in the PR are preserved.
The candidate adds five transactional trip publishers, tenant-owned opt-in rider
rules, scoped contact resolution, durable delivery claims, channel dispatch,
retry/outcome handling, operator settings/history and two migrations.

## Evidence and pending gates

| Gate | Result | Evidence / limitation |
|---|---|---|
| Selected policy, safety and notification unit gates | PASS | 445 tests in 11 files; transports mocked |
| TypeScript | PASS | `npx tsc --noEmit -p . --pretty false` |
| Prisma schema validation | PASS | Local placeholder connection URLs; no database contacted |
| Runtime DDL policy | PASS | `node scripts/check-no-runtime-ddl.mjs` |
| Tenant schema and route checks | PASS | No violations; existing informational warnings remain |
| PostgreSQL locks, RLS, dedup and stale-token gate | NOT RUN | Six tests prepared; no local PostgreSQL server, no dedicated test URL. The local runner reported six skipped tests, which do not count as a pass |
| GitHub PostgreSQL CI | BLOCKED | Candidate upload rejected by automatic approval review; no candidate commit/ref update or workflow run created |
| Railway staging environment selection | BLOCKED | Both workspace and project-specific accounts returned Not Authorized for project `ac5b8297-816b-44d3-bb61-41f079e92faa` |
| Full staging event → consumer → worker validation | NOT RUN | Requires valid Railway project access, an isolated database, deployed candidate and synthetic fixtures |

No production migration, live passenger notification, merge or deployment was
performed. The two migration files remain unapplied by this session:
`20261004080000_bus_ops_stop_delay_marker` and
`20261004090000_bus_rider_notifications`.

## Next execution steps

1. Explicitly authorize publishing the 28-file local candidate to the existing
   draft PR branch. Upload Git blobs, create a child commit of the inspected head
   and fast-forward only that branch. Recheck the head first to preserve other work.
2. Run and inspect the `rider-postgres` GitHub Actions job. Its PostgreSQL 16
   service is disposable and its test URL is restricted to localhost and the
   dedicated `fleet360_rider_test` database. Resolve any failures and rerun.
3. Reconnect Railway with access to `fleet360-railway`. Identify the staging
   environment and service from live metadata; do not use the historical
   production environment ID as a staging target.
4. Verify the candidate SHA and isolated staging database before applying the
   two migrations. Keep real channels quarantined. Use synthetic tenant A/B
   employees, riders, trips and stops, and controlled transport mocks or a
   designated test transport.
5. Exercise event creation/rollback, outbox fanout, stop/passenger targeting,
   cross-tenant rejection, duplicate redelivery, concurrent sender claims,
   provider acceptance, proven rejection/backoff, uncertain outcome parking,
   quarantine, expiry and audited operator retry. Record the exact deployment,
   database role, test results and fixture cleanup.
6. Keep rules disabled for live tenants and keep PR #172 draft until acceptance
   evidence is complete. Passing mocked sends proves application handling, not
   actual provider delivery receipts.

## Publication and first PostgreSQL CI run

The user explicitly authorized publication to draft PR #172. Commit
`a74b1569839cfc6613d9049dde8a0758037faf70` was fast-forwarded onto the existing
branch; the PR remained draft. The initial six PostgreSQL tests passed without
skips in job `111369474643`, run `37179663437`.

Migration Safety run `37179663386` failed with PostgreSQL `42P01` at
`20261004080000_bus_ops_stop_delay_marker`: the fresh migration history never
created the legacy `public.trip_stop_visits` table. The correction provisions
that table with its existing schema when absent, adds the delay marker, and
enables/forces tenant RLS. Existing visit markers and policies are preserved.
A seventh isolated PostgreSQL test now checks fresh creation, marker preservation
on replay and cross-tenant denial. The corrected candidate must pass the fresh
replay and PostgreSQL jobs on its new head before those gates are considered
complete.

Railway staging access remains blocked. No staging or production migration,
live passenger notification, merge or deployment has been performed.
