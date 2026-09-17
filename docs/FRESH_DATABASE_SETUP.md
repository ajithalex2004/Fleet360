# Fresh database setup — migration replay gaps

`npx prisma migrate deploy` against a genuinely empty database does **not**
run clean end-to-end without a sequence of manual `prisma migrate resolve`
steps below. A number of tracked migrations assume state (tables, columns,
schemas) that was only ever created by an untracked, pre-history ops script
on real environments — never captured as a tracked migration itself. On any
real environment (dev, staging, production) that state already exists, so
this is invisible there. On a truly fresh database it isn't, and
`migrate deploy` stops with a hard error.

This is tracked at the top level in
[issue #77](https://github.com/ajithalex2004/Fleet360/issues/77), which is
now **fully closed** — every gap found (both originally catalogued and three
discovered while verifying the catalogued ones end-to-end) has a corrective
migration. This doc exists because the exact commands needed live only in
migration-file comments, which CodeRabbit flagged (correctly, for the
original four) as not discoverable enough for someone actually trying to
bootstrap a fresh database.

None of the migrations below are edited — they're already applied on every
real environment, and editing an already-applied migration is unsafe (Prisma
tracks applied migrations by checksum; changing one desyncs any environment
that already ran it). The fix pattern throughout is: leave the broken
migration as-is, skip it with `prisma migrate resolve --applied`, and let a
later, additive migration in the chain close the actual gap — either by
recreating a genuinely untracked table/column with its exact live shape
(confirmed via `pg_dump` against production, never guessed), or by
re-running a migration's own logic with the ordering/existence guard it was
missing.

## Automated

`npm run db:migrate:fresh` (scripts/fresh-install-migrate.cjs) runs the exact
sequence below automatically — it parses this file's own code block at
runtime, so it can't drift out of sync with it, and stops with the real
error if it ever hits something not documented here. Prefer it over running
the steps by hand; the manual sequence below is kept for reference and for
diagnosing a stop the script doesn't recognize.

## Full resolve chain

Run `npx prisma migrate deploy`, resolve the migration it stops at, and
repeat. Every stop below is expected; each is closed by a later migration in
the same `migrate deploy` run once resolved.

```bash
npx prisma migrate deploy   # stops at 20260815140000
npx prisma migrate resolve --applied 20260815140000_tenant_001_leasing_rental_isolation

npx prisma migrate deploy   # stops at 20260816000000
npx prisma migrate resolve --applied 20260816000000_route_consolidation_phase2_schema

npx prisma migrate deploy   # stops at 20260818100000
npx prisma migrate resolve --applied 20260818100000_fleet_routing_foundation

npx prisma migrate deploy   # stops at 20260821000000
npx prisma migrate resolve --applied 20260821000000_vehicle_route_zone_tagging

npx prisma migrate deploy   # stops at 20260824000000
npx prisma migrate resolve --applied 20260824000000_add_tenant_constraints_and_indexes

npx prisma migrate deploy   # stops at 20260904000000
npx prisma migrate resolve --applied 20260904000000_add_tenant_id_to_lease_rental_children

npx prisma migrate deploy   # stops at 20260905000000
npx prisma migrate resolve --applied 20260905000000_adopt_route_optimisation_results

npx prisma migrate deploy   # stops at 20260909000000
npx prisma migrate resolve --applied 20260909000000_per_tenant_rental_agreement_numbers

npx prisma migrate deploy   # stops at 20260910000000
npx prisma migrate resolve --applied 20260910000000_remove_null_tenant_escape

npx prisma migrate deploy   # stops at 20260910000003
npx prisma migrate resolve --applied 20260910000003_login_attempts_platform_only

npx prisma migrate deploy   # stops at 20260910000004
npx prisma migrate resolve --applied 20260910000004_enable_rls_seven_tables

npx prisma migrate deploy   # stops at 20260910000005
npx prisma migrate resolve --applied 20260910000005_resolve_finance_payments_shadow

npx prisma migrate deploy   # stops at 20260910000006
npx prisma migrate resolve --applied 20260910000006_finance_schema_null_escape

npx prisma migrate deploy   # stops at 20260910000008
npx prisma migrate resolve --applied 20260910000008_fleet_operations_null_escape

npx prisma migrate deploy   # stops at 20260910000009
npx prisma migrate resolve --applied 20260910000009_backfill_bookings_hierarchy_tenant

npx prisma migrate deploy   # stops at 20260910000010
npx prisma migrate resolve --applied 20260910000010_grant_app_role_schema_access

npx prisma migrate deploy   # stops at 20260910000016
npx prisma migrate resolve --applied 20260910000016_finance_deposits_recurring_tables_and_rls

npx prisma migrate deploy   # stops at 20260910000024
npx prisma migrate resolve --applied 20260910000024_auth_security_tables_and_rls

npx prisma migrate deploy   # stops at 20260911120000
npx prisma migrate resolve --applied 20260911120000_lease_return_settlement_workflow

npx prisma migrate deploy   # stops at 20260914140000 (this one is itself a fix,
                             # from #78 — it has its own, separate fresh-replay gap)
npx prisma migrate resolve --applied 20260914140000_fresh_replay_rental_leasing_gap

npx prisma migrate deploy   # completes cleanly — every remaining migration,
                             # including all of this series' own fixes and the
                             # public-schema grant fix below, applies with no
                             # further resolves needed
```

Verified by an actual empty-database replay through this exact sequence,
start to finish, with no shortcuts — including a full drop-and-recreate
re-run after every fix in this series landed, not just validated piecemeal
as each individual gap was found.

One more thing a fresh database needs that isn't a `resolve` step: without
`20260915260000_fresh_replay_grant_app_role_public_schema` (the last
migration in the chain above), `fleet360_app` — the actual runtime role the
application connects as — has **zero privileges on public-schema tables**
on a fresh database. Every query would fail with `permission denied`, not
an RLS denial (RLS only evaluates after the base privilege check already
passed). This is already part of the resolve chain above (it's a normal,
additive migration, not a skip), called out here because it's the kind of
gap that's easy to miss when checking RLS in isolation — verified directly
with `has_table_privilege('fleet360_app', ...)` before and after, and with
an actual `SET ROLE fleet360_app` session proving both the base grant and
`audit_logs`' append-only policies (insert succeeds, update affects 0 rows,
cross-tenant select returns 0 rows) hold together correctly.

## What each resolve is standing in for

| Skipped migration | What it was supposed to do | What actually repairs it |
|---|---|---|
| `20260815140000_tenant_001_leasing_rental_isolation` | Create 5 rental tables, backfill `tenant_id` across the rental domain | `20260914140000` + `20260914150000` (#73/#74, #78) |
| `20260816000000_route_consolidation_phase2_schema` | Create `route_passengers` + 3 route-consolidation tables | `20260914150000` (#75, #78) |
| `20260818100000_fleet_routing_foundation` | Add columns to `route_passengers`/`bus_routes`/`tenants`, create 5 fleet-optimization tables | `20260914150000` (#75, #78) |
| `20260821000000_vehicle_route_zone_tagging` | Add `zone_id` + FK to `spatial.places` on `vehicles`/`bus_routes` | `20260915100000` (#76, #80) |
| `20260824000000_add_tenant_constraints_and_indexes` | Harden `customers`/`trip_passengers`/`WorkOrder` tenant constraints | `20260915110000` (#77) |
| `20260904000000_add_tenant_id_to_lease_rental_children` | tenant_id + RLS backfill on 11 lease/rental child tables | `20260915120000` (#77) |
| `20260905000000_adopt_route_optimisation_results` | `route_optimisation_results` table | `20260915130000` (#77) |
| `20260909000000_per_tenant_rental_agreement_numbers` | per-tenant agreement numbering | `20260915140000` (#77) |
| `20260910000000_remove_null_tenant_escape` | NULL-tenant RLS escape removal (44 tables) | `20260915150000` (#77) |
| `20260910000003_login_attempts_platform_only` | `auth_login_attempts` table | `20260915160000` (#77) |
| `20260910000004_enable_rls_seven_tables` | RLS on `trip_schedules` + 6 other tables | `20260915170000` (#77) |
| `20260910000006_finance_schema_null_escape` | finance-schema NULL-tenant escape removal (6 tables) | `20260915180000` (#77) |
| `20260910000008_fleet_operations_null_escape` | `fleet`/`operations` NULL-tenant escape removal | `20260915190000` (#77) |
| `20260910000009_backfill_bookings_hierarchy_tenant` | booking-hierarchy tenant backfill (needs `logistics_shipment_orders`, created 25 migrations later, **and** `bookings.tenant_id` itself, which no tracked migration ever adds) | `20260915200000` (#77) |
| `20260910000010_grant_app_role_schema_access` | `fleet360_app` grants on `finance`/`fleet`/`operations`/`spatial`/`workforce`/`ai` | `20260915210000` (#77) |
| `20260910000016_finance_deposits_recurring_tables_and_rls` | `finance_security_deposits` and related tables — broken on **every** environment, not just fresh replay (`CURRENT_DATE` in a `GENERATED ALWAYS ... STORED` column, which Postgres rejects outright) | `20260915220000` (#77) |
| `20260910000024_auth_security_tables_and_rls` | `password_reset_tokens`/`tenant_api_keys`/`tenant_invitations`/`audit_logs` — two of these are defined twice in tracked history with **incompatible column shapes**; a fresh replay gets the wrong one | `20260915230000` (#77) |
| `20260911120000_lease_return_settlement_workflow` | lease-return settlement workflow tables + `finance_security_deposits` refund-lifecycle columns | `20260915240000` (#77) |
| `20260914140000_fresh_replay_rental_leasing_gap` | #78's own fresh-replay fix — has a second, independent gap in its own tenant_id backfill (found only once the full chain was run end-to-end, past where #78's own testing had stopped) | `20260915250000` (#77) |

| *(not a skip — a pure addition, no original migration to resolve past)* | `fleet360_app` public-schema table/sequence/function grants — referenced but never actually captured by any tracked migration (`20260910000010`'s own comment says public "is fully granted... and has NOTHING on any other schema", describing a pre-existing state no migration creates) | `20260915260000` (#77) |

## Why this couldn't be closed as one pass

Each row above needed the same treatment: a real investigation (what does
production actually have, confirmed via `pg_dump` against a live copy — not
guessed from the migration's own SQL), a corrective migration, and
verification (safe no-op against live's actual shape, plus an actual
empty-database replay). Two of the eighteen resolve-chain rows here
(`20260910000009`, `20260914140000`) turned out to depend on state that
doesn't arrive until a *later* fix migration in this same series — the
guard added for each is documented in the corrective migration itself.
`20260910000024`'s fix additionally had to preserve `audit_logs`' real,
currently-functioning append-only policy set rather than reproduce the
original migration's literal (and, if actually followed, regression-causing)
policy-rebuild logic — see that migration's own comment for the full
reasoning. The public-schema grant gap wasn't caught by any of the RLS-
focused verification this series otherwise relied on — it took an actual
`SET ROLE fleet360_app` session against a fully-migrated fresh database to
surface it, which is why it was found last, after every catalogued #77 row
was already closed.

#77 also raised a larger option worth weighing separately: one early-dated
consolidated migration that closes all of this at once, instead of a
growing resolve chain appended at the end of history. Not decided.
