/**
 * GET /api/leasing/mileage-overages/summary
 *
 * Aggregate view for the analytics dashboard: counts and totals of mileage
 * overages bucketed by status, plus a top-5 list of contracts with the
 * largest unbilled overage exposure.
 *
 * Query: ?since=ISO (default = first day of current year)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const sinceParam = req.nextUrl.searchParams.get('since');
  const since = sinceParam
    ? new Date(sinceParam)
    : new Date(new Date().getFullYear(), 0, 1);

  const overages = await prisma.leaseMileageOverage.findMany({
    where: { createdAt: { gte: since } },
    include: { contract: { select: { contractNumber: true, lesseeId: true } } },
  });

  const byStatus = overages.reduce<Record<string, { count: number; totalAmount: number; totalKm: number }>>(
    (acc, o) => {
      const k = o.status ?? 'PENDING';
      if (!acc[k]) acc[k] = { count: 0, totalAmount: 0, totalKm: 0 };
      acc[k].count += 1;
      acc[k].totalAmount += Number(o.overageAmount);
      acc[k].totalKm += o.overageKm;
      return acc;
    },
    {},
  );

  const unbilled = overages.filter(o => o.status === 'PENDING');
  const unbilledTotal = unbilled.reduce((s, o) => s + Number(o.overageAmount), 0);

  // Top 5 contracts by unbilled overage exposure.
  const byContract = new Map<string, { contractId: string; contractNumber: string | null; total: number; km: number }>();
  for (const o of unbilled) {
    const existing = byContract.get(o.contractId) ?? {
      contractId: o.contractId,
      contractNumber: o.contract?.contractNumber ?? null,
      total: 0,
      km: 0,
    };
    existing.total += Number(o.overageAmount);
    existing.km += o.overageKm;
    byContract.set(o.contractId, existing);
  }
  const topUnbilled = [...byContract.values()].sort((a, b) => b.total - a.total).slice(0, 5);

  return NextResponse.json({
    since: since.toISOString(),
    totalOverages: overages.length,
    byStatus,
    unbilledTotal,
    unbilledCount: unbilled.length,
    topUnbilled,
  });
}
