/**
 * Tenant-configurable departments for ticket triage and forwarding.
 *
 * Resolution: start from the six built-in TICKET_DEPARTMENTS, apply the
 * tenant's `service_departments` rows on top (same key = rename / hide),
 * then append the tenant's own departments. Triage can be renamed but never
 * hidden, because every new ticket lands there.
 *
 * Reads degrade to the built-ins if the table is missing (migration not yet
 * applied), so existing tenants see no change until they configure something.
 */

import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import {
  TICKET_DEPARTMENTS, TRIAGE_DEPARTMENT,
  type TicketDepartmentDef, type DepartmentTone,
} from '@/types/service-tickets';

export const DEPARTMENT_TONES: DepartmentTone[] = ['slate', 'amber', 'rose', 'emerald', 'blue', 'violet', 'cyan', 'gold'];
export const DEPARTMENT_KEY_RE = /^[A-Z][A-Z0-9_]{1,47}$/;

export interface ResolvedDepartment extends TicketDepartmentDef {
  isActive: boolean;
  sortOrder: number;
}

interface Row {
  key: string; label: string; short_label: string; description: string;
  tone: string; sort_order: number; is_active: boolean;
}

function toneOf(v: string): DepartmentTone {
  return (DEPARTMENT_TONES as string[]).includes(v) ? (v as DepartmentTone) : 'slate';
}

/** Pure merge of built-ins and tenant rows — exported for tests. */
export function mergeDepartments(rows: Row[]): ResolvedDepartment[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const builtIns: ResolvedDepartment[] = TICKET_DEPARTMENTS.map((d, i) => {
    const r = byKey.get(d.key);
    return {
      key: d.key,
      label: r?.label || d.label,
      shortLabel: r?.short_label || d.shortLabel,
      description: r?.description ?? d.description,
      tone: r ? toneOf(r.tone) : d.tone,
      isSystem: true,
      isActive: d.key === TRIAGE_DEPARTMENT ? true : (r?.is_active ?? true),
      sortOrder: r?.sort_order ?? (i + 1) * 10,
    };
  });
  const systemKeys = new Set<string>(TICKET_DEPARTMENTS.map((d) => d.key));
  const custom: ResolvedDepartment[] = rows
    .filter((r) => !systemKeys.has(r.key))
    .map((r) => ({
      key: r.key,
      label: r.label,
      shortLabel: r.short_label || r.label,
      description: r.description ?? '',
      tone: toneOf(r.tone),
      isSystem: false,
      isActive: r.is_active,
      sortOrder: r.sort_order ?? 100,
    }));
  // Triage always first; the rest by sort order then label.
  const [triage, ...rest] = [...builtIns, ...custom].sort((a, b) =>
    a.key === TRIAGE_DEPARTMENT ? -1 : b.key === TRIAGE_DEPARTMENT ? 1
      : a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  return [triage, ...rest];
}

type RawQuery = { $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T> };

const SELECT_SQL = `SELECT key, label, short_label, description, tone, sort_order, is_active
                      FROM service_departments WHERE tenant_id = $1`;

/**
 * Resolved departments for a tenant. Inactive ones are left out unless asked
 * for. Pass `tx` when already inside a tenant-scoped transaction.
 */
export async function listDepartments(
  tenantId: string,
  opts: { includeInactive?: boolean; tx?: RawQuery } = {},
): Promise<ResolvedDepartment[]> {
  const read = (q: RawQuery) => q.$queryRawUnsafe<Row[]>(SELECT_SQL, tenantId);
  const rows = await (opts.tx ? read(opts.tx) : withTenantRls(prisma, tenantId, (tx) => read(tx)))
    .catch(() => [] as Row[]);
  const all = mergeDepartments(rows);
  return opts.includeInactive ? all : all.filter((d) => d.isActive);
}

/** True when `key` is an active department for the tenant. */
export async function isActiveDepartment(tenantId: string, key: string): Promise<boolean> {
  const list = await listDepartments(tenantId);
  return list.some((d) => d.key === key);
}

export interface DepartmentInput {
  key: string;
  label: string;
  shortLabel?: string;
  description?: string;
  tone?: string;
  sortOrder?: number;
  isActive?: boolean;
}

/** Validate admin input. Returns an error message or null. */
export function validateDepartmentInput(d: DepartmentInput): string | null {
  if (!DEPARTMENT_KEY_RE.test(d.key)) return 'Key must be 2–48 characters: capital letters, digits and underscores, starting with a letter.';
  if (!d.label?.trim()) return 'Label is required.';
  if (d.label.trim().length > 80) return 'Label must be 80 characters or fewer.';
  if (d.key === TRIAGE_DEPARTMENT && d.isActive === false) return 'Operations Triage cannot be hidden — new tickets land there.';
  return null;
}

/** Insert or update one department row for the tenant (admin / template use). */
export async function upsertDepartment(tenantId: string, d: DepartmentInput): Promise<void> {
  await withTenantRls(prisma, tenantId, (tx) =>
    tx.$executeRawUnsafe(
      `INSERT INTO service_departments
         (tenant_id, key, label, short_label, description, tone, sort_order, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (tenant_id, key) DO UPDATE SET
         label = EXCLUDED.label, short_label = EXCLUDED.short_label,
         description = EXCLUDED.description, tone = EXCLUDED.tone,
         sort_order = EXCLUDED.sort_order, is_active = EXCLUDED.is_active,
         updated_at = NOW()`,
      tenantId, d.key, d.label.trim(), (d.shortLabel || d.label).trim(),
      d.description?.trim() ?? '', toneOf(d.tone ?? 'slate'),
      Number.isFinite(d.sortOrder) ? Number(d.sortOrder) : 100,
      d.isActive ?? true,
    ),
  );
}

/** Insert a department only if the tenant has no row with that key yet. */
export async function insertDepartmentIfAbsent(tenantId: string, d: DepartmentInput): Promise<void> {
  await withTenantRls(prisma, tenantId, (tx) =>
    tx.$executeRawUnsafe(
      `INSERT INTO service_departments
         (tenant_id, key, label, short_label, description, tone, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      tenantId, d.key, d.label, d.shortLabel || d.label, d.description ?? '',
      toneOf(d.tone ?? 'slate'), Number.isFinite(d.sortOrder) ? Number(d.sortOrder) : 100,
    ),
  );
}
