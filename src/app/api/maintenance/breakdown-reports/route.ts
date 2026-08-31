export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { publishBreakdownReported } from '@/lib/maintenance/publish-event';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Next BRK- number for this tenant and month.
 *
 * Was an unscoped count of rows sharing the month prefix, which made the
 * sequence platform-wide and leaked other organisations' breakdown volume.
 * Now takes the tenant's own highest number for the month and adds one —
 * counting breaks as soon as a row is deleted, and
 * uniq_breakdown_reports_tenant_report_no rejects the resulting duplicate
 * rather than storing it.
 */
async function generateReportNo(tenantId: string): Promise<string> {
    const now    = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prefix = `BRK-${yyyymm}-`;
    const rows = await prisma.$queryRawUnsafe<Array<{ max: number | null }>>(
        `SELECT MAX(NULLIF(regexp_replace(report_no, '^' || $2, ''), '')::int) AS max
           FROM breakdown_reports
          WHERE tenant_id = $1 AND report_no LIKE $2 || '%'`,
        tenantId, prefix,
    );
    const max = rows[0]?.max ?? 0;
    return `${prefix}${String(max + 1).padStart(5, '0')}`;
}

// ── GET /api/maintenance/breakdown-reports ────────────────────────────────────
// Query params: tenantId?, vehicleId?, driverId?, status?, severity?

export async function GET(request: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const { searchParams } = new URL(request.url);
            const vehicleId = searchParams.get('vehicleId') ?? undefined;
            const driverId  = searchParams.get('driverId')  ?? undefined;
            const status    = searchParams.get('status')    ?? undefined;
            const severity  = searchParams.get('severity')  ?? undefined;

            const reports = await tx.breakdownReport.findMany({
                where: {
                    tenantId,
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
        } catch (e) {
            console.error('Failed to fetch breakdown reports:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
        }
  });
}


// ── POST /api/maintenance/breakdown-reports ───────────────────────────────────
// Body: CreateBreakdownReportBody
// Side-effects:
//   • Generates BRK-YYYYMM-NNNNN report number
//   • Auto-creates a BREAKDOWN MaintenanceRequest (HIGH priority, fast-lane)
//   • Links BreakdownReport ↔ MaintenanceRequest bidirectionally
//   • Publishes maintenance.breakdown_reported event (fire-and-forget)

export async function POST(request: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const bodyRaw = await request.json();
            const body = stripTenantOwnershipFields(bodyRaw);

            if (!body.vehicleId) {
                return NextResponse.json({ error: 'vehicleId is required' }, { status: 400 });
            }

            // The authenticated tenantId from authz above is used as-is. This
            // line previously read `const tenantId = body.tenantId ?? ''`,
            // shadowing it with a value from the request body — so a caller
            // could name any tenant and have the breakdown report, and the
            // MaintenanceRequest created alongside it, land in that
            // organisation. stripTenantOwnershipFields exists to prevent
            // exactly this and was not applied here.
            const reportNo = await generateReportNo(tenantId);

            // Step 1 — create breakdown report
            const report = await tx.breakdownReport.create({
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
            const mr = await tx.maintenanceRequest.create({
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
            const linked = await tx.breakdownReport.update({
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
            } catch (e) {
            console.error('Failed to create breakdown report:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
        }
  });
}

