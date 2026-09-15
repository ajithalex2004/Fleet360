# Fresh database setup — migration replay gaps

`npx prisma migrate deploy` against a genuinely empty database does **not**
currently run clean end-to-end. A number of tracked migrations assume state
(tables, columns, schemas) that was only ever created by an untracked,
pre-history ops script on real environments — never captured as a tracked
migration itself. On any real environment (dev, staging, production) that
state already exists, so this is invisible there. On a truly fresh database
it isn't, and `migrate deploy` stops with a hard error.

This is tracked at the top level in
[issue #77](https://github.com/ajithalex2004/Fleet360/issues/77). This doc
exists because the exact commands needed live only in migration-file
comments today, which CodeRabbit flagged (correctly) as not discoverable
enough for someone actually trying to bootstrap a fresh database.

None of the migrations below are edited — they're already applied on every
real environment, and editing an already-applied migration is unsafe (Prisma
tracks applied migrations by checksum; changing one desyncs any environment
that already ran it). The fix pattern throughout is: leave the broken
migration as-is, skip it with `prisma migrate resolve --applied`, and let a
later, additive migration in the chain close the actual gap.

## Safe to skip — a real fix lands later in the chain

Run these four in order, interleaved with `npx prisma migrate deploy`
(deploy will stop at each one; resolve it, then deploy again):

```bash
npx prisma migrate deploy   # stops at 20260815140000
npx prisma migrate resolve --applied 20260815140000_tenant_001_leasing_rental_isolation

npx prisma migrate deploy   # stops at 20260816000000
npx prisma migrate resolve --applied 20260816000000_route_consolidation_phase2_schema

npx prisma migrate deploy   # stops at 20260821000000
npx prisma migrate resolve --applied 20260821000000_vehicle_route_zone_tagging

npx prisma migrate deploy   # stops at 20260914140000 (the original #74 bug —
                             # its own fix, 20260914150000, lands right after)
npx prisma migrate resolve --applied 20260914140000_fresh_replay_rental_leasing_gap

npx prisma migrate deploy   # completes the rest of the safe chain
```

| Skipped migration | What it was supposed to do | What actually repairs it |
|---|---|---|
| `20260815140000_tenant_001_leasing_rental_isolation` | Create 5 rental tables, backfill `tenant_id` across the rental domain | `20260914140000` + `20260914150000` (#73/#74, #78) |
| `20260816000000_route_consolidation_phase2_schema` | Create `route_passengers` + 3 route-consolidation tables | `20260914150000` (#75, #78) |
| `20260818100000_fleet_routing_foundation` | Add columns to `route_passengers`/`bus_routes`/`tenants`, create 5 fleet-optimization tables | `20260914150000` (#75, #78) |
| `20260821000000_vehicle_route_zone_tagging` | Add `zone_id` + FK to `spatial.places` on `vehicles`/`bus_routes` | `20260915100000` (#76, #80) |
| `20260914140000_fresh_replay_rental_leasing_gap` | The #74 migration itself — its own backfill assumed a column only `20260815140000` would have added | `20260914150000` (#78) |

After the last resolve above, `migrate deploy` reaches the end of the
**safe** portion of history with a fully correct schema for everything
these five cover — verified by an actual empty-database replay through this
exact sequence (see #78 and #80 for the verification detail).

## Not yet fixed — resolving here loses real functionality

Continuing past the safe chain, `migrate deploy` hits more failures with no
corrective migration written yet. `prisma migrate resolve --applied` will
get you *past* each one and to a running database, but the table/column/
schema that migration was supposed to create will simply be **missing** —
there is nothing later in history that repairs it. Don't rely on any
feature touching these until the corresponding row in #77 is closed:

| Migration | Missing after resolve | Tracked in |
|---|---|---|
| `20260824000000_add_tenant_constraints_and_indexes` | `work_orders` table | #77 |
| `20260904000000_add_tenant_id_to_lease_rental_children` | tenant_id backfill on lease/rental children | #77 |
| `20260905000000_adopt_route_optimisation_results` | `route_optimisation_results` table | #77 |
| `20260909000000_per_tenant_rental_agreement_numbers` | per-tenant agreement numbering | #77 |
| `20260910000000_remove_null_tenant_escape` | NULL-tenant RLS escape removal (44 tables) | #77 |
| `20260910000003_login_attempts_platform_only` | `auth_login_attempts` table | #77 |
| `20260910000004_enable_rls_seven_tables` | RLS on `trip_schedules` + 25 other tables | #77 |
| `20260910000006_finance_schema_null_escape` | finance-schema NULL-tenant escape removal | #77 |
| `20260910000008_fleet_operations_null_escape` | `fleet`/`operations` NULL-tenant escape removal | #77 |
| `20260910000009_backfill_bookings_hierarchy_tenant` | booking-hierarchy tenant backfill (needs `logistics_shipment_orders`, created 25 migrations later — an ordering bug, not just a missing table) | #77 |
| `20260910000010_grant_app_role_schema_access` | `fleet360_app` grants on the `fleet` schema | #77 |
| `20260910000016_finance_deposits_recurring_tables_and_rls` | `finance_security_deposits` and related tables — this one is broken on **every** environment, not just fresh replay (uses `CURRENT_DATE` in a `GENERATED ALWAYS ... STORED` column, which Postgres rejects outright) | #77 |
| `20260910000024_auth_security_tables_and_rls` | `password_reset_tokens`/`tenant_api_keys`/`tenant_invitations`/`audit_logs` — two of these are defined twice in tracked history with **incompatible column shapes**; a fresh replay gets the wrong one | #77 |
| `20260911120000_lease_return_settlement_workflow` | lease-return settlement workflow tables | #77 |

If you just need a running app for local development and don't touch
route-consolidation, fleet routing, work orders, or the specific rental/
lease-return flows above, resolving through all of these to reach a running
database is possible today — just don't trust data or RLS on the tables
listed until #77 is worked through.

## Why this can't be a single automated bootstrap script yet

Each remaining row in #77 needs the same treatment the four fixed ones got:
a real investigation (what does production actually have, confirmed via
`pg_dump` against a live copy — not guessed from the migration's own SQL),
a corrective migration, and three-way verification (no-op against live, a
simulated gap, and an actual empty-database replay). That's real,
per-item work, not something to batch through quickly. #77 also raises a
larger option worth weighing separately: one early-dated consolidated
migration that closes all of this at once, instead of continuing to append
late fixes with a growing resolve chain. Not decided; see #77.
