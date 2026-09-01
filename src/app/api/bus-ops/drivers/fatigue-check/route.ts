export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import {
  evaluateDriverFatigue,
  type FatigueCheckParams,
  type FatigueEvaluationResult,
} from '@/lib/bus-ops/driver-fatigue-guard';

export const runtime = 'nodejs';

/**
 * GET /api/bus-ops/drivers/fatigue-check
 *
 * Query params:
 *   ?driverId=... (optional: check specific driver)
 *   ?targetDepartureTime=... (optional: check against specific time, defaults to now)
 *
 * Returns fatigue evaluations, rest hours, and compliance status for all scheduled drivers.
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const driverId = sp.get('driverId');
      const targetTimeStr = sp.get('targetDepartureTime') ?? new Date().toISOString();
      const targetTime = new Date(targetTimeStr);

      // Fetch drivers
      const drivers = await tx.driver.findMany({
        where: {
          tenantId,
          deletedAt: null,
          ...(driverId ? { id: driverId } : {}),
        },
        select: {
          id: true,
          fullName: true,
          phone: true,
          status: true,
        },
        orderBy: { fullName: 'asc' },
      });

      // Fetch trip history across past 7 days for these drivers
      const sevenDaysAgo = new Date(targetTime.getTime() - 7 * 24 * 60 * 60 * 1000);
      const trips = await tx.tripSchedule.findMany({
        where: {
          tenantId,
          deletedAt: null,
          driverId: { in: drivers.map((d) => d.id) },
          departureTime: { gte: sevenDaysAgo },
        },
        select: {
          id: true,
          tripNumber: true,
          driverId: true,
          departureTime: true,
          arrivalTime: true,
          status: true,
          Route: { select: { name: true } },
        },
        orderBy: { departureTime: 'desc' },
      });

      // Group trips by driverId
      const tripsByDriver = new Map<string, typeof trips>();
      for (const t of trips) {
        if (!t.driverId) continue;
        const list = tripsByDriver.get(t.driverId) ?? [];
        list.push(t);
        tripsByDriver.set(t.driverId, list);
      }

      const evaluations: FatigueEvaluationResult[] = drivers.map((drv) => {
        const rawTrips = tripsByDriver.get(drv.id) ?? [];
        const recentTrips = rawTrips.map((t) => ({
          id: t.id,
          tripNumber: t.tripNumber ?? t.id.slice(0, 8),
          routeName: t.Route?.name,
          departureTime: t.departureTime,
          arrivalTime: t.arrivalTime,
          status: t.status ?? 'COMPLETED',
          durationMinutes: 60,
        }));

        return evaluateDriverFatigue({
          driverId: drv.id,
          driverName: drv.fullName,
          targetDepartureTime: targetTime,
          targetDurationMinutes: 60,
          recentTrips,
        });
      });

      const summary = {
        totalDrivers: evaluations.length,
        compliantCount: evaluations.filter((e) => e.isCompliant).length,
        warningCount: evaluations.filter((e) => e.severity === 'WARN').length,
        blockedCount: evaluations.filter((e) => e.severity === 'BLOCK').length,
        evaluations,
      };

      return NextResponse.json(summary);
    } catch (err) {
      console.error('GET /api/bus-ops/drivers/fatigue-check error:', err);
      return NextResponse.json(
        { error: 'Failed to evaluate driver fatigue' },
        { status: 500 }
      );
    }
  });
}

/**
 * POST /api/bus-ops/drivers/fatigue-check
 *
 * Evaluates custom parameters for pre-assignment validation.
 */
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const rawBody = await req.json();
      const body = stripTenantOwnershipFields(rawBody);
      const { driverId, targetDepartureTime, targetDurationMinutes = 60 } = body;

      if (!driverId || !targetDepartureTime) {
        return NextResponse.json(
          { error: 'driverId and targetDepartureTime are required' },
          { status: 400 }
        );
      }

      const driver = await tx.driver.findFirst({
        where: { id: driverId, tenantId, deletedAt: null },
        select: { id: true, fullName: true },
      });

      if (!driver) {
        return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
      }

      const targetTime = new Date(targetDepartureTime);
      const sevenDaysAgo = new Date(targetTime.getTime() - 7 * 24 * 60 * 60 * 1000);

      const trips = await tx.tripSchedule.findMany({
        where: {
          tenantId,
          deletedAt: null,
          driverId: driver.id,
          departureTime: { gte: sevenDaysAgo },
        },
        select: {
          id: true,
          tripNumber: true,
          departureTime: true,
          arrivalTime: true,
          status: true,
          Route: { select: { name: true } },
        },
        orderBy: { departureTime: 'desc' },
      });

      const recentTrips = trips.map((t) => ({
        id: t.id,
        tripNumber: t.tripNumber ?? t.id.slice(0, 8),
        routeName: t.Route?.name,
        departureTime: t.departureTime,
        arrivalTime: t.arrivalTime,
        status: t.status ?? 'COMPLETED',
        durationMinutes: 60,
      }));

      const evaluation = evaluateDriverFatigue({
        driverId: driver.id,
        driverName: driver.fullName,
        targetDepartureTime: targetTime,
        targetDurationMinutes,
        recentTrips,
      });

      return NextResponse.json(evaluation);
    } catch (err) {
      console.error('POST /api/bus-ops/drivers/fatigue-check error:', err);
      return NextResponse.json(
        { error: 'Failed to evaluate driver fatigue check' },
        { status: 500 }
      );
    }
  });
}
