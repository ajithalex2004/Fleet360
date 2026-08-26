import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { calculateDue, sortByUrgency, type VehicleSnapshot } from '@/lib/pm/due-calculator';
import { PMItemStatus, type PMTrigger, type MaintenancePlan, PMTriggerType } from '@/types/maintenance';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(
    _request: NextRequest,
    props: { params: Promise<{ id: string }> },
) {
    const params = await props.params;

    const authz = requireAuthorizedTenant({ headers: _request.headers, nextUrl: _request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            // Scoped: the plan was previously fetched by id alone, so any
            // plan id returned another organisation's schedule and vehicles.
            const plan = await tx.maintenancePlan.findFirst({
                where: { id: params.id, tenantId },
                include: { triggers: true, scheduleItems: true },
            });

            if (!plan) {
                return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
            }

            // Load current vehicle odometer readings for all tracked vehicles
            const vehicleIds = plan.scheduleItems.map(i => i.vehicleId);
            const vehicles = vehicleIds.length > 0
                ? await tx.vehicle.findMany({
                    where: { tenantId, id: { in: vehicleIds } },
                    select: { id: true, currentMileage: true, odometerReading: true, make: true, model: true, licensePlate: true },
                })
                : [];

            const vehicleMap = new Map<string, VehicleSnapshot>(
                vehicles.map(v => [
                    v.id,
                    { id: v.id, currentOdometerKm: Number(v.currentMileage ?? v.odometerReading ?? 0) },
                ]),
            );

            // Build typed plan for the calculator
            const typedPlan: MaintenancePlan = {
                id:               plan.id,
                tenantId:         plan.tenantId,
                name:             plan.name,
                description:      plan.description ?? undefined,
                maintenanceType:  plan.maintenanceType as MaintenancePlan['maintenanceType'],
                applicability:    (plan.applicability as unknown as MaintenancePlan['applicability']) ?? { allVehicles: true },
                gracePeriodDays:  plan.gracePeriodDays ?? undefined,
                earlyWindowDays:  plan.earlyWindowDays ?? undefined,
                earlyWindowKm:    plan.earlyWindowKm   ?? undefined,
                isActive:         plan.isActive,
                notifyDaysBefore: plan.notifyDaysBefore ?? undefined,
                triggers: plan.triggers.map(t => ({
                    id:            t.id,
                    planId:        t.planId,
                    triggerType:   t.triggerType as PMTriggerType,
                    intervalValue: t.intervalValue,
                    intervalUnit:  t.intervalUnit as PMTrigger['intervalUnit'],
                })),
            };

            const results = plan.scheduleItems.map(item => {
                const vehicle = vehicleMap.get(item.vehicleId) ?? {
                    id: item.vehicleId,
                    currentOdometerKm: 0,
                };
                const typedItem = {
                    id:                 item.id,
                    tenantId:           item.tenantId,
                    planId:             item.planId,
                    vehicleId:          item.vehicleId,
                    lastServiceDate:    item.lastServiceDate?.toISOString(),
                    lastOdometerKm:     item.lastOdometerKm ?? undefined,
                    nextDueDateCalc:    item.nextDueDateCalc?.toISOString(),
                    nextDueOdometerKm:  item.nextDueOdometerKm ?? undefined,
                    status:             item.status as PMItemStatus,
                    generatedRequestId: item.generatedRequestId ?? undefined,
                };
                return calculateDue(typedItem, typedPlan, vehicle);
            });

            const sorted = sortByUrgency(results);

            // Attach vehicle metadata to each result
            const vehicleMeta = new Map(vehicles.map(v => [v.id, v]));
            const enriched = sorted.map(r => ({
                ...r,
                vehicle: vehicleMeta.get(r.item.vehicleId) ?? null,
            }));

            return NextResponse.json(JSON.parse(JSON.stringify(enriched)));
        } catch (e) {
            console.error('Failed to compute due items:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
        }
  });
}

