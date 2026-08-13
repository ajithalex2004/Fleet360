-- Canonicalize Permission.module values.
--
-- Background:
--   Permissions.module used to store snake_case module identifiers
--   ('rac', 'bus_ops', 'drivers', 'staff', 'ambulance', 'school_bus')
--   that drifted from the canonical kebab-case registry in
--   src/lib/modules.ts. This migration moves legacy rows to canonical.
--
-- Two phases:
--
--   Phase 1 (dedup):
--     For each (legacy_module, action, resource) triple that has BOTH a
--     legacy row AND a canonical row, drop the legacy row. The canonical
--     row is identical in content (the seed route's ON CONFLICT clause
--     keeps them in sync) and is the one referenced by role_permissions
--     after the post-PR re-seed. The legacy row is orphaned.
--
--   Phase 2 (in-place update):
--     For each legacy row that does NOT have a canonical counterpart,
--     update module in place to preserve the permission_id (in case
--     role_permissions still reference it via pre-migration permStrings).
--     `hasPermission()` in src/lib/permissions.ts is alias-aware, so users
--     with `rac:create:*` permStrings resolve to canonical automatically.
--
-- Mapping (must match LEGACY_MODULE_ALIASES in src/lib/modules.ts):
--   rac        -> rental
--   bus_ops    -> bus-ops
--   staff      -> bus-ops
--   drivers    -> driver-mgmt
--   ambulance  -> incidents
--   school_bus -> school-bus
--
-- This migration is idempotent: re-running it is a no-op once all legacy
-- rows are gone. Safe to run before OR after the re-seed.

-- ── Phase 1: drop legacy rows that have a canonical counterpart ────────────

-- 'rac' vs 'rental'
DELETE FROM permissions p_legacy
USING permissions p_canon
WHERE p_legacy.module = 'rac'
  AND p_canon.module = 'rental'
  AND p_legacy.action = p_canon.action
  AND COALESCE(p_legacy.resource, '*') = COALESCE(p_canon.resource, '*');

-- 'bus_ops' vs 'bus-ops'
DELETE FROM permissions p_legacy
USING permissions p_canon
WHERE p_legacy.module = 'bus_ops'
  AND p_canon.module = 'bus-ops'
  AND p_legacy.action = p_canon.action
  AND COALESCE(p_legacy.resource, '*') = COALESCE(p_canon.resource, '*');

-- 'staff' vs 'bus-ops'
DELETE FROM permissions p_legacy
USING permissions p_canon
WHERE p_legacy.module = 'staff'
  AND p_canon.module = 'bus-ops'
  AND p_legacy.action = p_canon.action
  AND COALESCE(p_legacy.resource, '*') = COALESCE(p_canon.resource, '*');

-- 'drivers' vs 'driver-mgmt'
DELETE FROM permissions p_legacy
USING permissions p_canon
WHERE p_legacy.module = 'drivers'
  AND p_canon.module = 'driver-mgmt'
  AND p_legacy.action = p_canon.action
  AND COALESCE(p_legacy.resource, '*') = COALESCE(p_canon.resource, '*');

-- 'ambulance' vs 'incidents'
DELETE FROM permissions p_legacy
USING permissions p_canon
WHERE p_legacy.module = 'ambulance'
  AND p_canon.module = 'incidents'
  AND p_legacy.action = p_canon.action
  AND COALESCE(p_legacy.resource, '*') = COALESCE(p_canon.resource, '*');

-- 'school_bus' vs 'school-bus'
DELETE FROM permissions p_legacy
USING permissions p_canon
WHERE p_legacy.module = 'school_bus'
  AND p_canon.module = 'school-bus'
  AND p_legacy.action = p_canon.action
  AND COALESCE(p_legacy.resource, '*') = COALESCE(p_canon.resource, '*');

-- ── Phase 2: in-place update of remaining legacy rows ──────────────────────
-- (rows with no canonical counterpart — typically fresh DBs that haven't
--  been re-seeded yet, or rows for combinations not in ALL_PERMISSIONS)

UPDATE permissions SET module = 'rental'      WHERE module = 'rac';
UPDATE permissions SET module = 'bus-ops'     WHERE module = 'bus_ops';
UPDATE permissions SET module = 'bus-ops'     WHERE module = 'staff';
UPDATE permissions SET module = 'driver-mgmt' WHERE module = 'drivers';
UPDATE permissions SET module = 'incidents'   WHERE module = 'ambulance';
UPDATE permissions SET module = 'school-bus'  WHERE module = 'school_bus';
