-- leasing_handovers.handover_no was declared globally UNIQUE
-- (20260910000017_incidents_leasing_tables_and_rls), but the numbering
-- scheme that generates it (src/app/api/leasing/handover/route.ts POST)
-- is per-tenant: `SELECT COUNT(*) + 1 ... WHERE tenant_id = $1 AND
-- handover_no LIKE 'LHO-<yyyymm>-%'`. Any two tenants' Nth handover in the
-- same month deterministically compute the same handover_no (e.g. both
-- tenants' first handover this month both land on LHO-202609-0001) and
-- collide on the global constraint -- not a rare timing race, a near-
-- certain one once more than one tenant is active in the same month.
--
-- Replace the global uniqueness with what was actually intended: unique
-- per (tenant_id, handover_no). NULL tenant_id rows (pre-multitenancy
-- backfill only, see the ALTER/UPDATE right after the original CREATE
-- TABLE) keep Postgres's standard NULLS-DISTINCT behavior in a unique
-- index, same as every other nullable tenant_id column in this schema.
ALTER TABLE leasing_handovers DROP CONSTRAINT IF EXISTS leasing_handovers_handover_no_key;

CREATE UNIQUE INDEX IF NOT EXISTS leasing_handovers_tenant_handover_no_key
  ON leasing_handovers (tenant_id, handover_no);
