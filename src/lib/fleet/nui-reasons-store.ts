/**
 * src/lib/fleet/nui-reasons-store.ts
 *
 * Tenant-scoped access to fleet_nui_reasons, shared by /api/fleet/nui-reasons
 * and /api/admin/nui-reasons. Reason codes are per tenant (migration
 * 20261105090000_fleet_nui_reasons_per_tenant): every query names the tenant
 * explicitly, on top of the table's RLS policy, and tenant_id never leaves
 * the server.
 */

import type { TxClient } from '@/lib/rls';
import { DEFAULT_NUI_REASONS } from './nui-reasons';

type Row = Record<string, unknown>;

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

/** A reason as returned to callers: camelCase, without tenant_id. */
export function toNuiReason(row: Row): Row {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tenant_id, ...rest } = row;
  return Object.fromEntries(Object.entries(rest).map(([k, v]) => [toCamel(k), v]));
}

/** Postgres unique violation (23505), as Prisma reports it for raw queries. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string }; message?: string } | null;
  return e?.meta?.code === '23505' || e?.code === '23505' || /\b23505\b|duplicate key/.test(e?.message ?? '');
}

/** Gives a tenant the default reason codes the first time it has none. */
export async function seedDefaultsIfEmpty(tx: TxClient, tenantId: string): Promise<void> {
  const existing = await tx.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(*)::int AS count FROM fleet_nui_reasons WHERE tenant_id = $1`,
    tenantId,
  );
  if (Number(existing[0]?.count ?? 0) > 0) return;
  for (const item of DEFAULT_NUI_REASONS) {
    // ON CONFLICT: two first requests at once (uq_fnr_tenant_code).
    await tx.$executeRawUnsafe(
      `INSERT INTO fleet_nui_reasons (
        id, tenant_id, code, name, reason_type, description, impact_level, is_billable, is_active, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()
      ) ON CONFLICT DO NOTHING`,
      tenantId,
      item.code,
      item.name,
      item.reasonType,
      item.description,
      item.impactLevel,
      item.isBillable,
      item.isActive,
    );
  }
}

export interface NuiReasonFilters {
  activeOnly: boolean;
  /** A reason type; matches that type and reasons of type ALL. */
  type?: string;
  impact?: string;
  search?: string;
}

export async function listNuiReasons(tx: TxClient, tenantId: string, filters: NuiReasonFilters): Promise<Row[]> {
  const params: unknown[] = [tenantId];
  const conditions = ['tenant_id = $1'];
  if (filters.activeOnly) conditions.push('is_active = TRUE');
  if (filters.type) {
    params.push(filters.type);
    conditions.push(`(reason_type = $${params.length} OR reason_type = 'ALL')`);
  }
  if (filters.impact) {
    params.push(filters.impact);
    conditions.push(`impact_level = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`(code ILIKE $${params.length} OR name ILIKE $${params.length} OR description ILIKE $${params.length})`);
  }
  const rows = await tx.$queryRawUnsafe<Row[]>(
    `SELECT * FROM fleet_nui_reasons WHERE ${conditions.join(' AND ')} ORDER BY reason_type ASC, code ASC`,
    ...params,
  );
  return rows.map(toNuiReason);
}

export async function getNuiReason(tx: TxClient, tenantId: string, id: string): Promise<Row | null> {
  const rows = await tx.$queryRawUnsafe<Row[]>(
    `SELECT * FROM fleet_nui_reasons WHERE id::text = $1 AND tenant_id = $2`,
    id,
    tenantId,
  );
  return rows[0] ? toNuiReason(rows[0]) : null;
}

export interface NuiReasonInput {
  code: string;
  name: string;
  reasonType: string;
  description?: string | null;
  impactLevel?: string | null;
  isBillable?: boolean;
  isActive?: boolean;
  notes?: string | null;
}

export type NuiReasonWrite = { ok: true; reason: Row } | { ok: false; conflict: string } | { ok: false; notFound: true };

const trimOrNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Creates a reason for the tenant; a code it already has is a conflict. */
export async function createNuiReason(tx: TxClient, tenantId: string, input: NuiReasonInput): Promise<NuiReasonWrite> {
  const code = String(input.code).trim().toUpperCase();
  const dup = await tx.$queryRawUnsafe<Row[]>(
    `SELECT id FROM fleet_nui_reasons WHERE tenant_id = $1 AND UPPER(code) = $2`,
    tenantId,
    code,
  );
  if (dup.length) return { ok: false, conflict: code };
  try {
    const rows = await tx.$queryRawUnsafe<Row[]>(
      `INSERT INTO fleet_nui_reasons (
        id, tenant_id, code, name, reason_type, description, impact_level, is_billable, is_active, notes, created_at, updated_at
      ) VALUES (
        $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()
      ) RETURNING *`,
      crypto.randomUUID(),
      tenantId,
      code,
      String(input.name).trim(),
      String(input.reasonType).trim().toUpperCase(),
      trimOrNull(input.description),
      trimOrNull(input.impactLevel) ?? 'MEDIUM',
      Boolean(input.isBillable),
      input.isActive !== false,
      trimOrNull(input.notes),
    );
    return { ok: true, reason: toNuiReason(rows[0]) };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, conflict: code };
    throw err;
  }
}

const UPDATABLE: Record<string, string> = {
  code: 'code',
  name: 'name',
  reasonType: 'reason_type',
  description: 'description',
  impactLevel: 'impact_level',
  isBillable: 'is_billable',
  isActive: 'is_active',
  notes: 'notes',
};

/**
 * Updates the tenant's reason `id` with the fields present in `body`.
 * `allowCodeChange: false` ignores `code` (the admin screen keeps codes fixed).
 */
export async function updateNuiReason(
  tx: TxClient,
  tenantId: string,
  id: string,
  body: Record<string, unknown>,
  opts: { allowCodeChange: boolean },
): Promise<NuiReasonWrite> {
  if (opts.allowCodeChange && typeof body.code === 'string') {
    const code = body.code.trim().toUpperCase();
    const dup = await tx.$queryRawUnsafe<Row[]>(
      `SELECT id FROM fleet_nui_reasons WHERE tenant_id = $1 AND UPPER(code) = $2 AND id::text <> $3`,
      tenantId,
      code,
      id,
    );
    if (dup.length) return { ok: false, conflict: code };
  }
  const sets = ['updated_at = NOW()'];
  const vals: unknown[] = [];
  for (const [key, col] of Object.entries(UPDATABLE)) {
    if (!(key in body) || (key === 'code' && !opts.allowCodeChange)) continue;
    let value: unknown = body[key] ?? null;
    if (key === 'isBillable' || key === 'isActive') value = Boolean(body[key]);
    else if (key === 'code' && typeof value === 'string') value = value.trim().toUpperCase();
    vals.push(value);
    sets.push(`${col} = $${vals.length}${key === 'isBillable' || key === 'isActive' ? '::boolean' : ''}`);
  }
  vals.push(id, tenantId);
  try {
    const rows = await tx.$queryRawUnsafe<Row[]>(
      `UPDATE fleet_nui_reasons SET ${sets.join(', ')}
        WHERE id::text = $${vals.length - 1} AND tenant_id = $${vals.length}
        RETURNING *`,
      ...vals,
    );
    return rows[0] ? { ok: true, reason: toNuiReason(rows[0]) } : { ok: false, notFound: true };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, conflict: String(body.code ?? '').trim().toUpperCase() };
    throw err;
  }
}

/** Deletes the tenant's reason `id`; false when the tenant has no such reason. */
export async function deleteNuiReason(tx: TxClient, tenantId: string, id: string): Promise<boolean> {
  const deleted = await tx.$executeRawUnsafe(
    `DELETE FROM fleet_nui_reasons WHERE id::text = $1 AND tenant_id = $2`,
    id,
    tenantId,
  );
  return Number(deleted) > 0;
}
