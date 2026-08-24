import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { publishRecoveryDispatched } from '@/lib/maintenance/publish-event';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
// POST /api/maintenance/breakdown-reports/[id]/dispatch-recovery
// Body: { recoveryVehicleId?, recoveryDriverId?, estimatedArrivalAt?, recoveryNotes? }

export async function POST(
    request: Request,
    { params }: { params: { id: string } },
) {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

    try {
        const { id }  = params;
        const body    = await request.json();
        const now     = new Date();

        const existing = await prisma.breakdownReport.findUnique({
            where: { id },
        });

        if (!existing || existing.deletedAt) {
            return NextResponse.json({ error: 'Breakdown report not found' }, { status: 404 });
        }

        if (existing.status !== 'REPORTED') {
            return NextResponse.json(
                { error: `Cannot dispatch recovery from status: ${existing.status}` },
                { status: 422 },
            );
        }

        const updated = await prisma.breakdownReport.update({
            where: { id },
            data: {
                status:              'RECOVERY_DISPATCHED',
                recoveryVehicleId:   body.recoveryVehicleId   ?? null,
                recoveryDriverId:    body.recoveryDriverId    ?? null,
                recoveryNotes:       body.recoveryNotes       ?? null,
                recoveryDispatchedAt: now,
                estimatedArrivalAt:  body.estimatedArrivalAt
                    ? new Date(body.estimatedArrivalAt)
                    : null,
            },
            include: {
                MaintenanceRequest: {
                    select: { id: true, status: true, workOrderNo: true },
                },
            },
        });

        // Publish event (fire-and-forget)
        publishRecoveryDispatched(id, updated.tenantId, {
            reportId:           id,
            vehicleId:          updated.vehicleId ?? '',
            tenantId:           updated.tenantId,
            recoveryVehicleId:  updated.recoveryVehicleId,
            recoveryDriverId:   updated.recoveryDriverId,
            estimatedArrivalAt: updated.estimatedArrivalAt?.toISOString() ?? null,
            dispatchedAt:       now.toISOString(),
        }).catch(err => console.warn('[maintenance] recovery_dispatched publish failed:', err));

        return NextResponse.json(JSON.parse(JSON.stringify(updated)));
    } catch (error) {
        console.error('Failed to dispatch recovery:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: String(error) },
            { status: 500 },
        );
    }
}
