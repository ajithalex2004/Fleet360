-- Canonicalize TenantModule.module values.
--
-- Background:
--   Tenants may have enabled-modules stored with legacy snake_case module
--   identifiers ('rac', 'bus_ops', 'drivers', 'staff', 'ambulance',
--   'school_bus') that drifted from the canonical kebab-case registry in
--   src/lib/modules.ts. This migration moves legacy rows to canonical.
--
-- Two phases:
--
--   Phase 1 (dedup):
--     For each (tenant_id, legacy_module) row that has BOTH a legacy AND
--     canonical row for the same tenant, drop the legacy row. The canonical
--     row's isEnabled reflects the merged intent (canonical wins because
--     it's the form the admin UI now writes; legacy rows are stale).
--
--   Phase 2 (in-place update):
--     For each legacy row that does NOT have a canonical counterpart for
--     the same tenant, update module in place to preserve the row id and
--     the isEnabled flag. Downstream consumers resolve both forms via
--     `enabledSet()` (src/app/admin/tenants/page.tsx) and `resolveModuleKey()`
--     (src/lib/modules.ts).
--
-- Mapping (must match LEGACY_MODULE_ALIASES in src/lib/modules.ts):
--   rac        -> rental
--   bus_ops    -> bus-ops
--   staff      -> bus-ops
--   drivers    -> driver-mgmt
--   ambulance  -> incidents
--   school_bus -> school-bus
--
-- This migration is idempotent: re-running is a no-op once all legacy rows
-- are gone.

-- ── Phase 1: drop legacy rows that have a canonical counterpart per tenant ─

-- 'rac' vs 'rental'
DELETE FROM tenant_modules tm_legacy
USING tenant_modules tm_canon
WHERE tm_legacy.tenant_id = tm_canon.tenant_id
  AND tm_legacy.module = 'rac'
  AND tm_canon.module = 'rental';

-- 'bus_ops' vs 'bus-ops'
DELETE FROM tenant_modules tm_legacy
USING tenant_modules tm_canon
WHERE tm_legacy.tenant_id = tm_canon.tenant_id
  AND tm_legacy.module = 'bus_ops'
  AND tm_canon.module = 'bus-ops';

-- 'staff' vs 'bus-ops'
DELETE FROM tenant_modules tm_legacy
USING tenant_modules tm_canon
WHERE tm_legacy.tenant_id = tm_canon.tenant_id
  AND tm_legacy.module = 'staff'
  AND tm_canon.module = 'bus-ops';

-- 'drivers' vs 'driver-mgmt'
DELETE FROM tenant_modules tm_legacy
USING tenant_modules tm_canon
WHERE tm_legacy.tenant_id = tm_canon.tenant_id
  AND tm_legacy.module = 'drivers'
  AND tm_canon.module = 'driver-mgmt';

-- 'ambulance' vs 'incidents'
DELETE FROM tenant_modules tm_legacy
USING tenant_modules tm_canon
WHERE tm_legacy.tenant_id = tm_canon.tenant_id
  AND tm_legacy.module = 'ambulance'
  AND tm_canon.module = 'incidents';

-- 'school_bus' vs 'school-bus'
DELETE FROM tenant_modules tm_legacy
USING tenant_modules tm_canon
WHERE tm_legacy.tenant_id = tm_canon.tenant_id
  AND tm_legacy.module = 'school_bus'
  AND tm_canon.module = 'school-bus';

-- ── Phase 2: in-place update of remaining legacy rows ──────────────────────
-- (rows with no canonical counterpart per tenant — these are tenants
--  whose module subscriptions haven't been touched since pre-migration)

UPDATE tenant_modules SET module = 'rental'      WHERE module = 'rac';
UPDATE tenant_modules SET module = 'bus-ops'     WHERE module = 'bus_ops';
UPDATE tenant_modules SET module = 'bus-ops'     WHERE module = 'staff';
UPDATE tenant_modules SET module = 'driver-mgmt' WHERE module = 'drivers';
UPDATE tenant_modules SET module = 'incidents'   WHERE module = 'ambulance';
UPDATE tenant_modules SET module = 'school-bus'  WHERE module = 'school_bus';
