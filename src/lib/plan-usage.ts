/**
 * Plan usage counters — current consumption per tenant.
 *
 * All counts are best-effort; the queries swallow errors and return 0 so a
 * missing table never breaks the admin UI. Counts use the tenant_id column
 * added by tenant_isolation.sql.
 */

import { prisma } from '@/lib/prisma';

export interface PlanUsage {
  users:               number;
  vehicles:            number;
  bookingsThisMonth:   number;
}

/**
 * Returns the current usage snapshot for a tenant. Cheap enough to call
 * on every admin/billing page load.
 */
export async function getUsage(tenantId: string): Promise<PlanUsage> {
  const [users, vehicles, bookings] = await Promise.all([
    countActiveUsers(tenantId),
    countVehicles(tenantId),
    countBookingsThisMonth(tenantId),
  ]);
  return {
    users,
    vehicles,
    bookingsThisMonth: bookings,
  };
}

async function countActiveUsers(tenantId: string): Promise<number> {
  return prisma.userTenant.count({
    where: { tenantId, isActive: true },
  }).catch(() => 0);
}

async function countVehicles(tenantId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
    `SELECT COUNT(*)::bigint AS c FROM vehicles WHERE tenant_id::text = $1`,
    tenantId,
  ).catch(() => []);
  return rows[0] ? Number(rows[0].c) : 0;
}

async function countBookingsThisMonth(tenantId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
    `SELECT COUNT(*)::bigint AS c
     FROM bookings
     WHERE tenant_id::text = $1
       AND created_at >= date_trunc('month', NOW())`,
    tenantId,
  ).catch(() => []);
  return rows[0] ? Number(rows[0].c) : 0;
}
