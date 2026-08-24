import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { publishBreakdownReported } from '@/lib/maintenance/publish-event';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
// ── Helpers ───────────────────────────────────────────────────────────────────

async function generateReportNo(): Promise<string> {
    const now    = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prefix = `BRK-${yyyymm}-`;
    const count  = await prisma.breakdownReport.count({
        where: { reportNo: { startsWith: prefix } },
    });
    return `${prefix}${String(count + 1).padStart(5, '0')}`;
}

// ── GET /api/maintenance/breakdown-reports ────────────────────────────────────
// Query params: tenantId?, vehicleId?, driverId?, status?, severity?

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const vehicleId = searchParams.get('vehicleId') ?? undefined;
        const driverId  = searchParams.get('driverId')  ?? undefined;
        const status    = searchParams.get('status')    ?? undefined;
        const severity  = searchParams.get('severity')  ?? undefined;

        const reports = await prisma.breakdownReport.findMany({
            where: {
                deletedAt: null,
                ...(vehicleId ? { vehicleId } : {}),
                ...(driverId  ? { driverId }  : {}),
                ...(status    ? { status }    : {}),
                ...(severity  ? { severity }  : {}),
            },
            include: {
                MaintenanceRequest: {
                    select: { id: true, status: true, workOrderNo: true },
                },
            },
            orderBy: { reportedAt: 'desc' },
        });

        return NextResponse.json(JSON.parse(JSON.stringify(reports)));
    } catch (error) {
        console.error('Failed to fetch breakdown reports:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: String(error) },
            { status: 500 },
        );
    }
}

// ── POST /api/maintenance/breakdown-reports ───────────────────────────────────
// Body: CreateBreakdownReportBody
// Side-effects:
//   • Generates BRK-YYYYMM-NNNNN report number
//   • Auto-creates a BREAKDOWN MaintenanceRequest (HIGH priority, fast-lane)
//   • Links BreakdownReport ↔ MaintenanceRequest bidirectionally
//   • Publishes maintenance.breakdown_reported event (fire-and-forget)

export async function POST(request: Request) {
    try {
        const body = await request.json();

        if (!body.vehicleId) {
            return NextResponse.json({ error: 'vehicleId is required' }, { status: 400 });
        }

        const tenantId = body.tenantId ?? '';
        const reportNo = await generateReportNo();

        // Step 1 — create breakdown report
        const report = await prisma.breakdownReport.create({
            data: {
                reportNo,
                tenantId,
                vehicleId:     body.vehicleId,
                driverId:      body.driverId      ?? null,
                breakdownType: body.breakdownType ?? 'OTHER',
                location:      body.location      ?? null,
                latitude:      body.latitude      ?? null,
                longitude:     body.longitude     ?? null,
                driverNotes:   body.driverNotes   ?? null,
                photoUrls:     body.photoUrls     ?? [],
                severity:      body.severity      ?? 'HIGH',
                status:        'REPORTED',
            },
        });

        // Step 2 — auto-create a fast-lane BREAKDOWN maintenance request
        const mr = await prisma.maintenanceRequest.create({
            data: {
                tenantId,
                vehicleId:        body.vehicleId,
                driverId:         body.driverId ?? null,
                maintenanceType:  'BREAKDOWN',
                priority:         'HIGH',
                status:           'Open',
                description:      `Breakdown (${body.breakdownType ?? 'OTHER'})${body.location ? ' at ' + body.location : ''}. Report: ${reportNo}`,
                requestDate:      new Date(),
                maintenanceJobs:  [],
                breakdownReportId: report.id,
            },
        });

        // Step 3 — link the MR back to the report
        const linked = await prisma.breakdownReport.update({
            where: { id: report.id },
            data:  { maintenanceRequestId: mr.id },
            include: {
                MaintenanceRequest: {
                    select: { id: true, status: true, workOrderNo: true },
                },
            },
        });

        // Publish event (fire-and-forget)
        publishBreakdownReported(linked.id, tenantId, {
            reportId:             linked.id,
            reportNo:             linked.reportNo,
            vehicleId:            linked.vehicleId ?? '',
            driverId:             linked.driverId,
            tenantId,
            breakdownType:        linked.breakdownType,
            severity:             linked.severity,
            location:             linked.location,
            reportedAt:           linked.reportedAt.toISOString(),
            maintenanceRequestId: linked.maintenanceRequestId,
        }).catch(err => console.warn('[maintenance] breakdown_reported publish failed:', err));

        return NextResponse.json(JSON.parse(JSON.stringify(linked)), { status: 201 });
    } catch (error) {
        console.error('Failed to create breakdown report:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: String(error) },
            { status: 500 },
        );
    }
}
