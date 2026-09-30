export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { buildPmSchedule } from '@/lib/pm/schedule';

// GET /api/maintenance/pm-schedule
// Every active PM plan against every vehicle it covers: overdue, due soon,
// upcoming, or no service on record (see src/lib/pm/schedule.ts).

export async function GET(request: NextRequest) {
    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const plans = await tx.maintenancePlan.findMany({
                where: { tenantId, deletedAt: null, isActive: true },
                include: { triggers: true },
                orderBy: { name: 'asc' },
            });
            if (plans.length === 0) return NextResponse.json({ plans: 0, entries: [] });

            const [vehicles, requests, items] = await Promise.all([
                tx.vehicle.findMany({
                    where: { tenantId, deletedAt: null, isActive: true },
                    select: { id: true, licensePlate: true, make: true, model: true, type: true, currentMileage: true, odometerReading: true },
                }),
                // Only requests carrying a plan's name as a job can be a
                // service under that plan.
                tx.maintenanceRequest.findMany({
                    where: { tenantId, deletedAt: null, maintenanceJobs: { hasSome: plans.map(p => p.name.trim()) } },
                    select: { id: true, vehicleId: true, maintenanceJobs: true, completionDate: true, requestDate: true, createdAt: true, odometer: true, status: true },
                }),
                tx.pMScheduleItem.findMany({
                    where: { tenantId, planId: { in: plans.map(p => p.id) } },
                    select: { planId: true, vehicleId: true, lastServiceDate: true, lastOdometerKm: true, nextDueDateCalc: true, nextDueOdometerKm: true, status: true },
                }),
            ]);

            const entries = buildPmSchedule({
                plans,
                vehicles: vehicles.map(v => ({
                    ...v,
                    odometerKm: v.odometerReading != null ? Number(v.odometerReading) : v.currentMileage != null ? Number(v.currentMileage) : null,
                })),
                requests: requests.map(r => ({ ...r, odometer: r.odometer == null ? null : Number(r.odometer) })),
                items,
            });
            return NextResponse.json({ plans: plans.length, entries });
        } catch (e) {
            console.error('Failed to build PM schedule:', e);
            return NextResponse.json({ error: 'Could not load the PM schedule' }, { status: 500 });
        }
  });
}
