/**
 * Tenant ticket-type access matrix.
 *
 * Lazy-creates `tenant_ticket_types` on first call. Defaults to
 * "all 7 types enabled" for any tenant without explicit rows so existing
 * tenants don't lose access on rollout. Platform Admin can disable
 * specific types per tenant via /admin/tenants/[id]/ticket-types.
 */

import { prisma } from '@/lib/prisma';
import type { TenantTicketTypeAccess, TicketType } from '@/types/service-tickets';
import { TICKET_TYPES_ORDER } from '@/types/service-tickets';

let _ensured = false;

export async function ensureTicketTypeAccessTable(): Promise<void> {
  if (_ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tenant_ticket_types (
      tenant_id           TEXT         NOT NULL,
      ticket_type         TEXT         NOT NULL,
      enabled             BOOLEAN      NOT NULL DEFAULT TRUE,
      sla_override_hours  INTEGER,
      updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_by_user_id  TEXT,
      PRIMARY KEY (tenant_id, ticket_type)
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_tenant_ticket_types_tenant ON tenant_ticket_types (tenant_id)`,
  );
  _ensured = true;
}

/**
 * Returns the full access matrix for a tenant — one row per type, with
 * defaults filled in for any type the tenant hasn't explicitly configured.
 */
export async function getTenantAccessMatrix(tenantId: string): Promise<TenantTicketTypeAccess[]> {
  await ensureTicketTypeAccessTable();

  const rows = await prisma.$queryRawUnsafe<Array<{
    ticket_type: string;
    enabled: boolean;
    sla_override_hours: number | null;
    updated_at: string;
  }>>(
    `SELECT ticket_type, enabled, sla_override_hours, updated_at::text
     FROM tenant_ticket_types
     WHERE tenant_id = $1`,
    tenantId,
  ).catch(() => []);

  const byType = new Map(rows.map(r => [r.ticket_type, r]));

  return TICKET_TYPES_ORDER.map(t => {
    const row = byType.get(t);
    return {
      tenantId,
      ticketType: t,
      enabled: row?.enabled ?? true, // default ENABLED when not configured
      slaOverrideHours: row?.sla_override_hours ?? null,
      updatedAt: row?.updated_at,
    };
  });
}

/**
 * Returns just the types this tenant is allowed to use. Empty array
 * means no rows configured AND defaults treated as none — but per the
 * default-enabled convention, this never happens unless every type was
 * explicitly disabled.
 */
export async function getTenantEnabledTypes(tenantId: string): Promise<TicketType[]> {
  const matrix = await getTenantAccessMatrix(tenantId);
  return matrix.filter(r => r.enabled).map(r => r.ticketType);
}

/** Upsert one tenant/type access row. */
export async function setTenantTypeAccess(
  tenantId: string,
  ticketType: TicketType,
  enabled: boolean,
  slaOverrideHours: number | null,
  updatedByUserId: string | null,
): Promise<void> {
  await ensureTicketTypeAccessTable();
  await prisma.$executeRawUnsafe(
    `INSERT INTO tenant_ticket_types (tenant_id, ticket_type, enabled, sla_override_hours, updated_at, updated_by_user_id)
     VALUES ($1, $2, $3, $4, NOW(), $5)
     ON CONFLICT (tenant_id, ticket_type)
       DO UPDATE SET
         enabled = EXCLUDED.enabled,
         sla_override_hours = EXCLUDED.sla_override_hours,
         updated_at = NOW(),
         updated_by_user_id = EXCLUDED.updated_by_user_id`,
    tenantId, ticketType, enabled, slaOverrideHours, updatedByUserId,
  );
}

/** Bulk replace — used by the admin matrix Save action. */
export async function replaceTenantAccessMatrix(
  tenantId: string,
  rows: Array<{ ticketType: TicketType; enabled: boolean; slaOverrideHours: number | null }>,
  updatedByUserId: string | null,
): Promise<void> {
  await ensureTicketTypeAccessTable();
  await Promise.all(rows.map(r =>
    setTenantTypeAccess(tenantId, r.ticketType, r.enabled, r.slaOverrideHours, updatedByUserId),
  ));
}
