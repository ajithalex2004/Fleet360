export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { GARAGE_PERIOD_MONTHS, scoreGarages } from '@/lib/maintenance/garage-performance';

// GET /api/maintenance/garage-performance
// A scorecard per garage from the last 12 months of the tenant's
// maintenance requests assigned to it (see src/lib/maintenance/garage-performance.ts).

export async function GET(request: NextRequest) {
    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;
    const since = new Date();
    since.setMonth(since.getMonth() - GARAGE_PERIOD_MONTHS);

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const rows = await tx.maintenanceRequest.findMany({
                where: {
                    tenantId, deletedAt: null, garageId: { not: null },
                    OR: [{ requestDate: { gte: since } }, { requestDate: null, createdAt: { gte: since } }],
                },
                select: {
                    garageId: true, requestDate: true, createdAt: true, completionDate: true, expectedEndDate: true,
                    estimatedCost: true, actualCost: true,
                    Garage: { select: { name: true } },
                    histories: { where: { deletedAt: null }, select: { status: true, date: true } },
                    qualityInspections: { select: { overallResult: true, inspectedAt: true, createdAt: true } },
                },
                take: 20_000,
            });
            const garages = scoreGarages(rows.map(r => ({
                garageId: r.garageId!,
                garageName: r.Garage?.name ?? null,
                requestDate: r.requestDate,
                createdAt: r.createdAt,
                completionDate: r.completionDate,
                expectedEndDate: r.expectedEndDate,
                estimatedCost: r.estimatedCost == null ? null : Number(r.estimatedCost),
                actualCost: r.actualCost == null ? null : Number(r.actualCost),
                histories: r.histories,
                inspections: r.qualityInspections,
            })));
            return NextResponse.json({ months: GARAGE_PERIOD_MONTHS, garages });
        } catch (e) {
            console.error('Failed to build garage performance:', e);
            return NextResponse.json({ error: 'Could not load garage performance' }, { status: 500 });
        }
  });
}
