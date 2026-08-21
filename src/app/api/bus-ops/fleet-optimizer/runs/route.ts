/**
 * GET /api/bus-ops/fleet-optimizer/runs
 *
 * Paginated list of runs for the tenant, newest first. Powers the run
 * history table in B5.
 *
 * Query params (optional):
 *   limit:  default 20, max 100
 *   status: filter by any RunStatus
 *   date:   filter by targetDate ('YYYY-MM-DD')
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const ALLOWED_STATUS = new Set([
  'PENDING', 'VALIDATING', 'SOLVING', 'SUCCESS',
  'INFEASIBLE', 'FAILED', 'CANCELLED', 'PUBLISHED',
]);

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const statusFilter = sp.get('status');
  const dateFilter   = sp.get('date');
  const limitRaw     = sp.get('limit');
  const limit        = clampInt(limitRaw, 20, 1, 100);
  if (statusFilter && !ALLOWED_STATUS.has(statusFilter)) {
    return NextResponse.json({ error: `status must be one of ${[...ALLOWED_STATUS].join('|')}` }, { status: 400 });
  }

  const where: Record<string, unknown> = { tenantId };
  if (statusFilter) where.status = statusFilter;
  if (dateFilter) {
    const d = new Date(dateFilter);
    if (isNaN(d.getTime())) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    where.targetDate = d;
  }

  const rows = await prisma.fleetOptimizationRun.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, createdAt: true, updatedAt: true, createdBy: true,
      status: true, statusReason: true, targetDate: true,
      metrics: true, publishedAt: true,
    },
  });
  return NextResponse.json({ items: rows });
}

function clampInt(raw: string | null, def: number, min: number, max: number): number {
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
