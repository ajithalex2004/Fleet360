#!/usr/bin/env node
/**
 * One-shot operator script — backfill normalized vehicle_groups (Region
 * → Department → Unit) AND fuel_types from the legacy denormalized
 * string columns on vehicles. Never auto-runs; intended for production
 * deployments where the legacy columns have meaningful data.
 *
 *   node scripts/backfill-vehicle-groups.mjs --dry-run
 *   node scripts/backfill-vehicle-groups.mjs --apply
 *   node scripts/backfill-vehicle-groups.mjs --apply --tenant=<id>
 *
 * What it does (idempotent — safe to re-run):
 *
 *   1. For every tenant with vehicles whose legacy strings are set:
 *      a) Collect distinct (hierarchyId, hierarchyName, branchId,
 *         branchName) tuples.
 *      b) For each non-empty hierarchy* tuple, ensure a REGION
 *         exists with code=hierarchyId (or hierarchyName-derived if id
 *         absent) under that tenant.
 *      c) For each non-empty branch* tuple, ensure a DEPARTMENT exists
 *         under the matching region.
 *      d) Ensure a "Default" UNIT exists under each department —
 *         vehicles attach at unit level, so we need at least one even
 *         when the legacy data only goes two levels deep.
 *      e) Set vehicle.vehicleGroupId on each affected vehicle.
 *   2. For every distinct fuel_type string across the tenant:
 *      a) Ensure a fuel_types row exists with code = uppercased
 *         legacy string.
 *      b) Set vehicle.fuelTypeId.
 *
 * Idempotency: every "ensure" step uses upsert-like logic
 * (findFirst → create if missing). Re-running won't duplicate rows.
 *
 * Default behaviour is --dry-run — prints the would-do counts but
 * doesn't mutate anything. --apply commits.
 */
import { PrismaClient } from '@prisma/client';

const args = new Set(process.argv.slice(2));
const tenantArg = process.argv.slice(2).find(a => a.startsWith('--tenant='));
const ONLY_TENANT = tenantArg ? tenantArg.slice('--tenant='.length) : null;
const APPLY = args.has('--apply');

if (!APPLY && !args.has('--dry-run')) {
  console.error('Usage: node scripts/backfill-vehicle-groups.mjs --dry-run|--apply [--tenant=<id>]');
  process.exit(1);
}

const p = new PrismaClient();
const stats = {
  regionsCreated: 0,
  departmentsCreated: 0,
  unitsCreated: 0,
  fuelTypesCreated: 0,
  vehiclesGroupAssigned: 0,
  vehiclesFuelAssigned: 0,
  vehiclesSkipped: 0,
};

const slug = (s) => (s || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Cache within a single tenant pass so we don't hit the DB N times
// for the same region/dept/fuel.
function makeTenantCache() {
  return { regions: new Map(), departments: new Map(), units: new Map(), fuels: new Map() };
}

async function ensureRegion(tenantId, code, name, cache) {
  if (cache.regions.has(code)) return cache.regions.get(code);
  let row = await p.vehicleGroup.findFirst({
    where: { tenantId, level: 'REGION', code, deletedAt: null },
  });
  if (!row) {
    if (APPLY) {
      row = await p.vehicleGroup.create({
        data: { tenantId, level: 'REGION', code, name: name || code },
      });
    } else {
      row = { id: `<would-create-region:${code}>`, code, name: name || code };
    }
    stats.regionsCreated++;
  }
  cache.regions.set(code, row);
  return row;
}

async function ensureDepartment(tenantId, parent, code, name, cache) {
  const key = `${parent.id}|${code}`;
  if (cache.departments.has(key)) return cache.departments.get(key);
  let row = APPLY
    ? await p.vehicleGroup.findFirst({
        where: { tenantId, level: 'DEPARTMENT', code, parentId: parent.id, deletedAt: null },
      })
    : null;
  if (!row) {
    if (APPLY) {
      row = await p.vehicleGroup.create({
        data: { tenantId, level: 'DEPARTMENT', parentId: parent.id, code, name: name || code },
      });
    } else {
      row = { id: `<would-create-dept:${code}-under-${parent.code}>`, code, name: name || code };
    }
    stats.departmentsCreated++;
  }
  cache.departments.set(key, row);
  return row;
}

async function ensureDefaultUnit(tenantId, parent, cache) {
  const key = parent.id;
  if (cache.units.has(key)) return cache.units.get(key);
  // Code "DEFAULT" under each department — vehicles need to attach at
  // unit level, so we synthesize one when the legacy data only went
  // two levels deep.
  const code = 'DEFAULT';
  let row = APPLY
    ? await p.vehicleGroup.findFirst({
        where: { tenantId, level: 'UNIT', code, parentId: parent.id, deletedAt: null },
      })
    : null;
  if (!row) {
    if (APPLY) {
      row = await p.vehicleGroup.create({
        data: { tenantId, level: 'UNIT', parentId: parent.id, code, name: `${parent.name} — Default` },
      });
    } else {
      row = { id: `<would-create-unit:DEFAULT-under-${parent.code}>` };
    }
    stats.unitsCreated++;
  }
  cache.units.set(key, row);
  return row;
}

async function ensureFuelType(tenantId, legacyString, cache) {
  const code = slug(legacyString);
  if (!code) return null;
  if (cache.fuels.has(code)) return cache.fuels.get(code);
  let row = await p.fuelType.findFirst({
    where: { tenantId, code, deletedAt: null },
  });
  if (!row) {
    if (APPLY) {
      row = await p.fuelType.create({
        data: { tenantId, code, name: legacyString.trim() },
      });
    } else {
      row = { id: `<would-create-fuel:${code}>`, code };
    }
    stats.fuelTypesCreated++;
  }
  cache.fuels.set(code, row);
  return row;
}

async function backfillTenant(tenant) {
  console.log(`\n── tenant ${tenant.id.slice(0, 8)} (${tenant.code || tenant.name}) ──`);
  const cache = makeTenantCache();

  // Fetch every vehicle in this tenant that has any legacy field set.
  const vehicles = await p.vehicle.findMany({
    where: {
      tenantId: tenant.id,
      OR: [
        { hierarchyId: { not: null } },
        { hierarchyName: { not: null } },
        { branchId: { not: null } },
        { branchName: { not: null } },
        { fuelType: { not: null } },
      ],
    },
  });

  console.log(`  ${vehicles.length} vehicle(s) with legacy fields set`);

  for (const v of vehicles) {
    const hierarchyKey = (v.hierarchyId || v.hierarchyName || '').trim();
    const branchKey = (v.branchId || v.branchName || '').trim();

    let assignedUnitId = null;
    if (hierarchyKey) {
      const region = await ensureRegion(
        tenant.id,
        slug(v.hierarchyId || v.hierarchyName),
        v.hierarchyName || v.hierarchyId,
        cache,
      );
      let department = null;
      if (branchKey) {
        department = await ensureDepartment(
          tenant.id,
          region,
          slug(v.branchId || v.branchName),
          v.branchName || v.branchId,
          cache,
        );
      }
      const unit = department
        ? await ensureDefaultUnit(tenant.id, department, cache)
        : null;
      assignedUnitId = unit?.id ?? null;
    }

    const fuelRow = v.fuelType
      ? await ensureFuelType(tenant.id, v.fuelType, cache)
      : null;

    if (!assignedUnitId && !fuelRow) {
      stats.vehiclesSkipped++;
      continue;
    }

    if (APPLY) {
      await p.vehicle.update({
        where: { id: v.id },
        data: {
          vehicleGroupId: assignedUnitId ?? v.vehicleGroupId,
          fuelTypeId: fuelRow?.id ?? v.fuelTypeId,
        },
      });
    }
    if (assignedUnitId) stats.vehiclesGroupAssigned++;
    if (fuelRow) stats.vehiclesFuelAssigned++;
  }
}

async function main() {
  const tenants = await p.tenant.findMany({
    where: ONLY_TENANT
      ? { id: ONLY_TENANT }
      : { isActive: true },
  });
  console.log(`backfilling across ${tenants.length} tenant(s) — ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  for (const t of tenants) {
    await backfillTenant(t);
  }
  console.log('\n── summary ──');
  console.log(stats);
  if (!APPLY) {
    console.log('\n(dry-run — no changes committed. Re-run with --apply to commit.)');
  }
  await p.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
