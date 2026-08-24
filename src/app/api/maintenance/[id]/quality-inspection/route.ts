import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import {
  publishInspectionPassed,
  publishInspectionFailed,
} from '@/lib/maintenance/publish-event';

// GET /api/maintenance/[id]/quality-inspection
// Returns the latest (or all) quality inspection records for a request.
export async function GET(
    _request: Request,
    { params }: { params: { id: string } },
) {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

    try {
        const { id } = params;

        const inspections = await prisma.qualityInspection.findMany({
            where: { requestId: id },
            orderBy: { createdAt: 'desc' },
        });

        return NextResponse.json(JSON.parse(JSON.stringify(inspections)));
    } catch (error) {
        console.error('Failed to fetch quality inspections:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: String(error) },
            { status: 500 },
        );
    }
}

// POST /api/maintenance/[id]/quality-inspection
// Creates (or replaces) a quality inspection for the request.
// Body: { inspectorId?, inspectorName?, checklist, notes?, overallResult }
//   overallResult: 'PASS' | 'FAIL' | 'PENDING'
//
// Side-effect: advances MaintenanceRequest.status:
//   PASS  → READY_FOR_SERVICE
//   FAIL  → INSPECTION_FAILED
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
        const { id } = params;
        const body = await request.json();

        const overallResult: string = body.overallResult ?? 'PENDING';

        const inspection = await prisma.qualityInspection.create({
            data: {
                tenantId:      body.tenantId      ?? '',
                requestId:     id,
                inspectorId:   body.inspectorId   ?? null,
                inspectorName: body.inspectorName ?? null,
                overallResult,
                notes:         body.notes         ?? null,
                inspectedAt:   overallResult !== 'PENDING' ? new Date() : null,
                checklist:     body.checklist ?? [],
            },
        });

        // Advance request status based on result + publish inspection event
        if (overallResult === 'PASS' || overallResult === 'FAIL') {
            const nextStatus = overallResult === 'PASS'
                ? 'READY_FOR_SERVICE'
                : 'INSPECTION_FAILED';

            const mr = await prisma.maintenanceRequest.update({
                where: { id },
                data:  { status: nextStatus },
            });

            const tenantId = (mr as any).tenantId as string | null;
            if (tenantId) {
                const inspectedAt = (inspection as any).inspectedAt
                    ? new Date((inspection as any).inspectedAt).toISOString()
                    : new Date().toISOString();

                const qcPayload = {
                    requestId:     id,
                    vehicleId:     (mr as any).vehicleId   ?? '',
                    tenantId,
                    requestNumber: (mr as any).workOrderNo ?? null,
                    garageId:      (mr as any).garageId    ?? null,
                    garageName:    null,
                    occurredAt:    inspectedAt,
                };
                if (overallResult === 'PASS') {
                    publishInspectionPassed(id, tenantId, qcPayload)
                        .catch(err => console.warn('[maintenance] inspection_passed publish failed:', err));
                } else {
                    publishInspectionFailed(id, tenantId, qcPayload)
                        .catch(err => console.warn('[maintenance] inspection_failed publish failed:', err));
                }
            }
        }

        return NextResponse.json(
            JSON.parse(JSON.stringify(inspection)),
            { status: 201 },
        );
    } catch (error) {
        console.error('Failed to create quality inspection:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: String(error) },
            { status: 500 },
        );
    }
}
