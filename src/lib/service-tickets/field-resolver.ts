/**
 * Field resolver — Phase B+ binding layer for service ticket Form Fields.
 *
 * When a form field declares a `source` other than 'user-input', the server
 * is the source of truth for that value — whatever the client posts is
 * ignored and overwritten here. When the field declares a `bindTo` other
 * than 'customFields', the resolved value is hoisted out of the JSONB blob
 * and into the named top-level column on service_tickets.
 *
 * This is intentionally a small pure-ish module; the only side effect is a
 * couple of read queries to load the current user / selected vehicle /
 * selected maintenance type. The POST handler runs `applyBindings` once
 * before validation, then again before the INSERT to redirect bound
 * values into their column slots.
 */
import { prisma } from '@/lib/prisma';
import type { FormFieldDef, FieldSource, FieldBindTarget } from '@/types/service-tickets';

// ── Inputs ──────────────────────────────────────────────────────────────

/** Everything the resolver may consult. The handler hydrates whichever
 *  pieces it can; sources that need missing data resolve to null. */
export interface ResolverContext {
  tenantId:           string | null;
  userId:             string | null;

  // Hydrated lazily — populated only when at least one field's source
  // requires the data. Each resolver caches its single read.
  user?:              { id: string; email: string | null; firstName: string | null; lastName: string | null; department: string | null; role: string | null } | null;
  tenant?:            { id: string; name: string | null } | null;
  vehicle?:           { id: string; licensePlate: string | null; vehicleTypeName: string | null; lastOdometer: number | null } | null;
  maintenanceType?:   { id: string; code: string; name: string; defaultPriority: 'Low'|'Medium'|'High'; estimatedHours: number | null } | null;

  // IDs used to hydrate the above when needed.
  selectedVehicleId?:         string | null;
  selectedMaintenanceTypeId?: string | null;
}

/** Result of running bindings — the bag of values to write per target. */
export interface BindingResult {
  /** Stays in the customFields JSONB blob, keyed by FormFieldDef.key. */
  customFields: Record<string, unknown>;
  /** Top-level column overrides — keys match FieldBindTarget. The POST
   *  handler reads these as authoritative when present. */
  columnOverrides: Partial<Record<Exclude<FieldBindTarget, 'customFields'>, unknown>>;
  /** Errors raised during resolution (e.g. unknown source). Non-fatal —
   *  the handler logs them but proceeds. */
  warnings: string[];
}

// ── Hydration helpers ───────────────────────────────────────────────────

async function hydrateUser(ctx: ResolverContext): Promise<NonNullable<ResolverContext['user']> | null> {
  if (ctx.user !== undefined) return ctx.user;
  if (!ctx.userId) return (ctx.user = null);
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string; email: string | null;
    first_name: string | null; last_name: string | null;
    department: string | null; user_type: string | null;
  }>>(
    `SELECT id, email, first_name, last_name, department, user_type
       FROM "User" WHERE id = $1 LIMIT 1`,
    ctx.userId,
  ).catch(() => []);
  if (!rows[0]) return (ctx.user = null);
  // Best-effort role — UserTenant.role is the canonical source per tenant,
  // but for simple bindings the User.user_type is good enough.
  let role: string | null = rows[0].user_type;
  if (ctx.tenantId) {
    const r = await prisma.$queryRawUnsafe<Array<{ code: string }>>(
      `SELECT r.code FROM user_tenants ut
         JOIN roles r ON r.id = ut.role_id
        WHERE ut.user_id = $1 AND ut.tenant_id = $2 AND ut.is_active = TRUE
        LIMIT 1`,
      ctx.userId, ctx.tenantId,
    ).catch(() => []);
    if (r[0]?.code) role = r[0].code;
  }
  return (ctx.user = {
    id:         rows[0].id,
    email:      rows[0].email,
    firstName:  rows[0].first_name,
    lastName:   rows[0].last_name,
    department: rows[0].department,
    role,
  });
}

async function hydrateTenant(ctx: ResolverContext): Promise<NonNullable<ResolverContext['tenant']> | null> {
  if (ctx.tenant !== undefined) return ctx.tenant;
  if (!ctx.tenantId) return (ctx.tenant = null);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string | null }>>(
    `SELECT id, name FROM tenants WHERE id = $1 LIMIT 1`,
    ctx.tenantId,
  ).catch(() => []);
  return (ctx.tenant = rows[0] ? { id: rows[0].id, name: rows[0].name } : null);
}

async function hydrateVehicle(ctx: ResolverContext): Promise<NonNullable<ResolverContext['vehicle']> | null> {
  if (ctx.vehicle !== undefined) return ctx.vehicle;
  if (!ctx.selectedVehicleId) return (ctx.vehicle = null);
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string; license_plate: string | null;
    vehicle_type_name: string | null;
    odometer_reading: bigint | null;
    current_mileage:  bigint | null;
  }>>(
    `SELECT v.id::text                AS id,
            v.license_plate           AS license_plate,
            vt.name                   AS vehicle_type_name,
            v.odometer_reading::bigint AS odometer_reading,
            v.current_mileage::bigint  AS current_mileage
      FROM vehicles v
      LEFT JOIN vehicle_types vt ON vt.id::text = v.vehicle_type_id
      WHERE v.id::text = $1
        AND ($2::text = '' OR v.tenant_id::text = $2)
        AND v.deleted_at IS NULL
      LIMIT 1`,
    ctx.selectedVehicleId, ctx.tenantId ?? '',
  ).catch(() => []);
  if (!rows[0]) return (ctx.vehicle = null);
  return (ctx.vehicle = {
    id:              rows[0].id,
    licensePlate:    rows[0].license_plate,
    vehicleTypeName: rows[0].vehicle_type_name,
    lastOdometer:    rows[0].odometer_reading != null ? Number(rows[0].odometer_reading)
                   : rows[0].current_mileage  != null ? Number(rows[0].current_mileage)
                   : null,
  });
}

async function hydrateMaintenanceType(ctx: ResolverContext): Promise<NonNullable<ResolverContext['maintenanceType']> | null> {
  if (ctx.maintenanceType !== undefined) return ctx.maintenanceType;
  if (!ctx.selectedMaintenanceTypeId || !ctx.tenantId) return (ctx.maintenanceType = null);
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string; code: string; name: string;
    default_priority: 'Low'|'Medium'|'High';
    estimated_hours: number | null;
  }>>(
    `SELECT id::text AS id, code, name, default_priority, estimated_hours
       FROM maintenance_types
      WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL
      LIMIT 1`,
    ctx.selectedMaintenanceTypeId, ctx.tenantId,
  ).catch(() => []);
  if (!rows[0]) return (ctx.maintenanceType = null);
  return (ctx.maintenanceType = {
    id:               rows[0].id,
    code:             rows[0].code,
    name:             rows[0].name,
    defaultPriority:  rows[0].default_priority,
    estimatedHours:   rows[0].estimated_hours,
  });
}

// ── Source resolution ───────────────────────────────────────────────────

export async function resolveFieldSource(
  source: FieldSource,
  ctx: ResolverContext,
): Promise<unknown | null> {
  switch (source) {
    case 'user-input':
      // Caller should never reach here for 'user-input' — return null
      // sentinel so the loop knows to keep the user-supplied value.
      return null;

    case 'currentUser.id':         return ctx.userId ?? null;
    case 'currentUser.email':      return (await hydrateUser(ctx))?.email ?? null;
    case 'currentUser.name': {
      const u = await hydrateUser(ctx);
      if (!u) return null;
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
      return name || u.email || null;
    }
    case 'currentUser.department': return (await hydrateUser(ctx))?.department ?? null;
    case 'currentUser.role':       return (await hydrateUser(ctx))?.role ?? null;

    case 'currentDate':            return new Date().toISOString().slice(0, 10);
    case 'currentTimestamp':       return new Date().toISOString();

    case 'tenant.id':              return ctx.tenantId ?? null;
    case 'tenant.name':            return (await hydrateTenant(ctx))?.name ?? null;

    case 'vehicle.id':             return (await hydrateVehicle(ctx))?.id ?? null;
    case 'vehicle.licensePlate':   return (await hydrateVehicle(ctx))?.licensePlate ?? null;
    case 'vehicle.type':           return (await hydrateVehicle(ctx))?.vehicleTypeName ?? null;
    case 'vehicle.lastOdometer':   return (await hydrateVehicle(ctx))?.lastOdometer ?? null;

    case 'maintenanceType.code':              return (await hydrateMaintenanceType(ctx))?.code ?? null;
    case 'maintenanceType.name':              return (await hydrateMaintenanceType(ctx))?.name ?? null;
    case 'maintenanceType.defaultPriority':   return (await hydrateMaintenanceType(ctx))?.defaultPriority ?? null;
    case 'maintenanceType.estimatedHours':    return (await hydrateMaintenanceType(ctx))?.estimatedHours ?? null;

    default: {
      // Exhaustiveness check — TypeScript flags an unhandled case here.
      const _exhaustive: never = source;
      void _exhaustive;
      return null;
    }
  }
}

// ── Apply bindings ──────────────────────────────────────────────────────

/**
 * Walks the configured form-field schema and produces a BindingResult.
 *
 * Algorithm:
 *   1. For each field f with source !== 'user-input', resolve f.source
 *      via the context and overwrite incoming.customFields[f.key].
 *   2. Then for each field f with bindTo !== 'customFields', move the
 *      resolved/user-supplied value out of customFields and into
 *      columnOverrides[bindTo] (so the INSERT uses it for the actual
 *      column, not the JSONB blob).
 *
 * Idempotent — calling twice yields the same result.
 */
export async function applyBindings(
  formFields: FormFieldDef[],
  incoming: Record<string, unknown>,
  ctx: ResolverContext,
): Promise<BindingResult> {
  const customFields: Record<string, unknown> = { ...incoming };
  const columnOverrides: BindingResult['columnOverrides'] = {};
  const warnings: string[] = [];

  // Pass 1 — resolve sources.
  for (const f of formFields) {
    const source = f.source ?? 'user-input';
    if (source === 'user-input') continue;
    try {
      const resolved = await resolveFieldSource(source, ctx);
      // null sentinel → leave whatever's in customFields (e.g. a vehicle
      // hasn't been picked yet so vehicle.* sources can't resolve).
      if (resolved !== null) {
        customFields[f.key] = resolved;
      }
    } catch (e) {
      warnings.push(`Field "${f.key}" source "${source}" failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  // Pass 2 — redirect bindings out of customFields.
  // module.<key> bindings stay in customFields — the value is read back
  // by the downstream auto-create bridge (e.g. MAINTENANCE ticket →
  // MaintenanceRequest), not written to a service_tickets column. The
  // bindTo metadata is consulted at bridge time to know where it goes.
  for (const f of formFields) {
    const target = f.bindTo ?? 'customFields';
    if (target === 'customFields' || target.startsWith('module.')) continue;
    const value = customFields[f.key];
    if (value !== undefined) {
      // Cast is safe — we've excluded both 'customFields' and 'module.*',
      // leaving only the typed top-level column targets.
      columnOverrides[target as Exclude<typeof target, 'customFields' | `module.${string}`>] = value;
      // Remove from JSONB so the same value isn't stored in two places.
      delete customFields[f.key];
    }
  }

  return { customFields, columnOverrides, warnings };
}

/**
 * Convenience used by the client: which fields should be auto-populated
 * vs left for the user? The form uses this to decide whether to disable an
 * input and pre-fill its value.
 */
export function isAutoSourced(field: FormFieldDef): boolean {
  return !!field.source && field.source !== 'user-input';
}
