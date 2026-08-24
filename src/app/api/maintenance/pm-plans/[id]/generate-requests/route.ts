import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { calculateDue, type VehicleSnapshot } from '@/lib/pm/due-calculator';
import { PMItemStatus, PMTriggerType, type PMTrigger, type MaintenancePlan } from '@/types/maintenance';
import { MaintenanceStatus, MaintenanceType } from '@/types/maintenance';
import { publishPMScheduleTriggered } from '@/lib/maintenance/publish-event';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
/**
 * POST /api/maintenance/pm-plans/[id]/generate-requests
 *
 * Scans all schedule items for this plan and creates a MaintenanceRequest
 * for each item that is DUE or OVERDUE and doesn't already have a pending
 * generated request.
 */
export async function POST(
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
            const plan = await tx.maintenancePlan.findUnique({
                where: { id: params.id },
                include: { triggers: true, scheduleItems: true },
            });

            if (!plan) {
                return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
            }

            const vehicleIds = plan.scheduleItems.map(i => i.vehicleId);
            const vehicles = vehicleIds.length > 0
                ? await tx.vehicle.findMany({
                    where: { id: { in: vehicleIds } },
                    select: { id: true, currentMileage: true, odometerReading: true },
                })
                : [];

            const vehicleMap = new Map<string, VehicleSnapshot>(
                vehicles.map(v => [
                    v.id,
                    { id: v.id, currentOdometerKm: Number(v.currentMileage ?? v.odometerReading ?? 0) },
                ]),
            );

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

            const created: string[] = [];
            const skipped: string[] = [];

            for (const item of plan.scheduleItems) {
                // Skip if already has a generated request
                if (item.generatedRequestId) {
                    skipped.push(item.vehicleId);
                    continue;
                }
                // Skip if already COMPLETED or SNOOZED
                if (item.status === PMItemStatus.COMPLETED || item.status === PMItemStatus.SNOOZED) {
                    skipped.push(item.vehicleId);
                    continue;
                }

                const vehicle = vehicleMap.get(item.vehicleId) ?? {
                    id: item.vehicleId, currentOdometerKm: 0,
                };
                const typedItem = {
                    id:                item.id,
                    tenantId:          item.tenantId,
                    planId:            item.planId,
                    vehicleId:         item.vehicleId,
                    lastServiceDate:   item.lastServiceDate?.toISOString(),
                    lastOdometerKm:    item.lastOdometerKm ?? undefined,
                    nextDueDateCalc:   item.nextDueDateCalc?.toISOString(),
                    nextDueOdometerKm: item.nextDueOdometerKm ?? undefined,
                    status:            item.status as PMItemStatus,
                };

                const calc = calculateDue(typedItem, typedPlan, vehicle);
                if (
                    calc.effectiveStatus !== PMItemStatus.DUE &&
                    calc.effectiveStatus !== PMItemStatus.OVERDUE
                ) {
                    skipped.push(item.vehicleId);
                    continue;
                }

                // Create the maintenance request
                const mr = await tx.maintenanceRequest.create({
                    data: {
                        tenantId:        plan.tenantId,
                        vehicleId:       item.vehicleId,
                        description:     `[PM] ${plan.name}` + (plan.description ? ` — ${plan.description}` : ''),
                        status:          MaintenanceStatus.REQUESTED,
                        maintenanceType: MaintenanceType.PREVENTIVE,
                        priority:        calc.effectiveStatus === PMItemStatus.OVERDUE ? 'HIGH' : 'MEDIUM',
                        requestDate:     new Date(),
                        odometer:        vehicle.currentOdometerKm
                            ? BigInt(vehicle.currentOdometerKm)
                            : null,
                    },
                });

                // Back-link the schedule item
                await tx.pMScheduleItem.update({
                    where: { id: item.id },
                    data:  { generatedRequestId: mr.id },
                });

                created.push(mr.id);
            }

            // Publish PMScheduleTriggered if any requests were created (fire-and-forget)
            if (created.length > 0) {
                const vehiclesTriggered = [...new Set(
                    plan.scheduleItems
                        .filter(i => created.includes(i.generatedRequestId ?? ''))
                        .map(i => i.vehicleId),
                )];
                publishPMScheduleTriggered(plan.id, plan.tenantId, {
                    planId:       plan.id,
                    planName:     plan.name,
                    tenantId:     plan.tenantId,
                    vehicleIds:   vehiclesTriggered,
                    requestIds:   created,
                    triggeredAt:  new Date().toISOString(),
                }).catch(err => console.warn('[maintenance] pm_schedule_triggered publish failed:', err));
            }

            return NextResponse.json({
                created: created.length,
                skipped: skipped.length,
                requestIds: created,
            });
            } catch (e) {
            console.error('Failed to generate maintenance requests:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
        }
  });
}

