/**
 * GET /api/bus-ops/driver-performance?month=YYYY-MM
 *
 * Per-driver performance scoreboard for a given month. Joins the latest
 * DriverPerformance row with the Driver record so we can show name +
 * licence type. Returns sorted by score desc with insufficient-signal
 * drivers at the bottom.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { gradeFromScore } from '@/lib/bus-driver-scoring';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const monthArg = req.nextUrl.searchParams.get('month');
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  if (monthArg && /^\d{4}-\d{2}$/.test(monthArg)) {
    year = parseInt(monthArg.slice(0, 4), 10);
    month = parseInt(monthArg.slice(5, 7), 10);
  }

  const perf = await prisma.driverPerformance.findMany({
    where: { periodYear: year, periodMonth: month },
  });
  const driverIds = perf.map(p => p.driverId);
  const drivers = driverIds.length > 0
    ? await prisma.driver.findMany({
        where: { id: { in: driverIds } },
        select: {
          id: true, name: true, firstName: true, lastName: true,
          contactNumber: true, licenseNumber: true, licenseType: true, status: true,
        },
      })
    : [];
  const driverMap = new Map(drivers.map(d => [d.id, d]));

  const rows = perf.map(p => {
    const d = driverMap.get(p.driverId);
    return {
      driverId: p.driverId,
      name: d?.name ?? [d?.firstName, d?.lastName].filter(Boolean).join(' ') ?? null,
      licenseNumber: d?.licenseNumber ?? null,
      licenseType: d?.licenseType ?? null,
      status: d?.status ?? null,
      score: p.score,
      grade: gradeFromScore(p.score),
      onTimePct: p.onTimePct,
      incidentCount: p.incidentCount,
      fuelEfficiency: p.fuelEfficiency,
      totalTrips: p.totalTrips,
      totalKm: p.totalKm,
    };
  });

  rows.sort((a, b) => {
    if (a.score == null && b.score == null) return 0;
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    return b.score - a.score;
  });

  return NextResponse.json({ period: { year, month }, drivers: rows });
}
