/**
 * GET /api/shipper-portal/stats
 *
 * Lightweight counts for the dashboard cards. Tenant + customer scoped
 * via requireShipperPortal. Falls back to zeros gracefully when the
 * logistics shipment table isn't present yet (fresh-install tenants).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireShipperPortal } from '@/lib/shipper-portal/auth';

export const runtime = 'nodejs';

interface StatsRow { c: bigint }

async function safeCount(sql: string, ...args: unknown[]): Promise<number> {
  try {
    const rows = await prisma.$queryRawUnsafe<StatsRow[]>(sql, ...args);
    return Number(rows[0]?.c ?? 0);
  } catch {
    return 0;
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireShipperPortal(req);
  if (auth instanceof NextResponse) return auth;

  // Active = not delivered/closed/cancelled. Done = delivered or closed.
  // Counts last 30 days for "this month" card.
  const [total, active, delivered, thisMonth] = await Promise.all([
    safeCount(
      `SELECT COUNT(*)::bigint AS c FROM logistics_shipment_orders
        WHERE tenant_id = $1 AND cargo_owner_customer_id = $2 AND deleted_at IS NULL`,
      auth.tenantId, auth.customerId,
    ),
    safeCount(
      `SELECT COUNT(*)::bigint AS c FROM logistics_shipment_orders
        WHERE tenant_id = $1 AND cargo_owner_customer_id = $2 AND deleted_at IS NULL
          AND status NOT IN ('DELIVERED','POD_SUBMITTED','CLOSED','CANCELLED','REJECTED')`,
      auth.tenantId, auth.customerId,
    ),
    safeCount(
      `SELECT COUNT(*)::bigint AS c FROM logistics_shipment_orders
        WHERE tenant_id = $1 AND cargo_owner_customer_id = $2 AND deleted_at IS NULL
          AND status IN ('DELIVERED','POD_SUBMITTED','CLOSED')`,
      auth.tenantId, auth.customerId,
    ),
    safeCount(
      `SELECT COUNT(*)::bigint AS c FROM logistics_shipment_orders
        WHERE tenant_id = $1 AND cargo_owner_customer_id = $2 AND deleted_at IS NULL
          AND created_at >= NOW() - INTERVAL '30 days'`,
      auth.tenantId, auth.customerId,
    ),
  ]);

  return NextResponse.json(
    { total, active, delivered, last30Days: thisMonth },
    { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } },
  );
}
