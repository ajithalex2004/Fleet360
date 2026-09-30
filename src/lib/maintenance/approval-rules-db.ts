/**
 * Database side of maintenance approval rules: load a tenant's active rules
 * and the role codes a user holds in it. Call inside withTenantRls.
 */
import type { Prisma } from '@prisma/client';
import type { ApprovalRuleRow } from '@/lib/maintenance/approval-rules';

type Tx = Prisma.TransactionClient;

export function toRuleRow(r: {
  id: string; name: string; minCost: Prisma.Decimal | number; maxCost: Prisma.Decimal | number | null;
  requiredRoles: string[]; autoApprove: boolean; isActive: boolean;
}): ApprovalRuleRow {
  return {
    id: r.id, name: r.name, minCost: Number(r.minCost), maxCost: r.maxCost == null ? null : Number(r.maxCost),
    requiredRoles: r.requiredRoles, autoApprove: r.autoApprove, isActive: r.isActive,
  };
}

/**
 * The tenant's active rules. Before the maintenance_approval_rules migration
 * has run the table is missing: treat that as "no rules" so approvals work
 * as they did, rather than failing every estimate.
 */
export async function loadApprovalRules(tx: Tx, tenantId: string): Promise<ApprovalRuleRow[]> {
  try {
    const rows = await tx.maintenanceApprovalRule.findMany({ where: { tenantId, deletedAt: null, isActive: true } });
    return rows.map(toRuleRow);
  } catch (e) {
    if (isMissingTable(e)) {
      console.warn('[approval-rules] maintenance_approval_rules is missing; run migration 20261020090000_maintenance_approval_rules');
      return [];
    }
    throw e;
  }
}

/** Prisma's "table does not exist" (P2021) or Postgres undefined_table (42P01). */
export const isMissingTable = (e: unknown) => {
  const err = e as { code?: string; meta?: { code?: string }; message?: string };
  return err?.code === 'P2021' || err?.meta?.code === '42P01' || /does not exist in the current database|42P01/.test(err?.message ?? '');
};

/** The session's role plus every role the user holds in the tenant. */
export async function callerRoleCodes(tx: Tx, tenantId: string, userId: string | null, sessionRole: string | null): Promise<string[]> {
  const codes = new Set<string>(sessionRole ? [sessionRole] : []);
  if (userId) {
    const rows = await tx.userTenant.findMany({
      where: { tenantId, userId, isActive: { not: false } },
      select: { role: { select: { code: true } } },
    }).catch(() => []);
    for (const r of rows) if (r.role?.code) codes.add(r.role.code);
  }
  return [...codes];
}

/** Who may change a tenant's approval rules. */
export const canManageApprovalRules = (role: string | null) => role === 'TENANT_ADMIN' || role === 'SUPER_ADMIN';
