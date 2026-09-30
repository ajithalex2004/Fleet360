export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { parseMonths, periodStart, summariseMaintenance } from '@/lib/maintenance/analytics';

// GET /api/maintenance/analytics?months=3|6|12 (default 6)
// Cost, type mix, top jobs and downtime from the tenant's maintenance
// requests over the last N months, plus the requests still open.

const MAX_ROWS = 20_000;

export async function GET(request: NextRequest) {
    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

    const months = parseMonths(request.nextUrl.searchParams.get('months'));
    const now = new Date();
    const from = periodStart(now, months);

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const rows = await tx.maintenanceRequest.findMany({
                where: {
                    tenantId,
                    deletedAt: null,
                    // Finished in the period, or not finished yet (open, or
                    // requested in the period).
                    OR: [{ completionDate: { gte: from } }, { completionDate: null }],
                },
                select: {
                    vehicleId: true, maintenanceType: true, status: true,
                    requestDate: true, completionDate: true, createdAt: true,
                    actualCost: true, maintenanceJobs: true,
                },
                orderBy: { createdAt: 'desc' },
                take: MAX_ROWS,
            });

            const summary = summariseMaintenance(
                rows.map(r => ({ ...r, actualCost: r.actualCost == null ? null : Number(r.actualCost) })),
                now,
                months,
            );
            return NextResponse.json({ ...summary, truncated: rows.length === MAX_ROWS });
        } catch (e) {
            console.error('Failed to build maintenance analytics:', e);
            return NextResponse.json({ error: 'Could not load maintenance analytics' }, { status: 500 });
        }
  });
}
