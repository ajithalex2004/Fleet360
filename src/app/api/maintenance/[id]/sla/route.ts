/**
 * GET /api/maintenance/[id]/sla
 * Returns a computed SLASnapshot for one MaintenanceRequest.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { computeSLASnapshot } from '@/lib/maintenance/sla-engine';
import type { MaintenanceRequest, MaintenanceStatus } from '@/types/maintenance';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(
    _req: NextRequest,
    props: { params: Promise<{ id: string }> },
) {
    const params = await props.params;

    const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const mr = await tx.maintenanceRequest.findUnique({
            where: { id: params.id },
        });
        if (!mr) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        // Build a MaintenanceRequest-shaped object from the Prisma row.
        // statusTimeline is stored as JSON text in the DB (workLog column pattern).
        // We reconstruct it from the StatusHistory records if available; otherwise
        // fall back to an empty object.
        const histories = await tx.statusHistory.findMany({
            where: { maintenanceRequestId: params.id },
            orderBy: { createdAt: 'asc' },
        });

        const statusTimeline: Partial<Record<MaintenanceStatus, string>> = {};
        for (const h of histories) {
            if (h.status && h.createdAt) {
                statusTimeline[h.status as MaintenanceStatus] = h.createdAt.toISOString();
            }
        }

        const mrShaped: MaintenanceRequest = {
            id:              mr.id,
            vehicleId:       mr.vehicleId ?? '',
            driverId:        mr.driverId ?? '',
            requestDate:     mr.requestDate?.toISOString() ?? mr.createdAt?.toISOString() ?? new Date().toISOString(),
            description:     mr.description ?? '',
            status:          (mr.status ?? 'Requested') as MaintenanceRequest['status'],
            priority:        mr.priority as MaintenanceRequest['priority'],
            maintenanceType: mr.maintenanceType as MaintenanceRequest['maintenanceType'],
            completionDate:  mr.completionDate?.toISOString(),
            statusTimeline,
            comments:        [],
        };

        const snapshot = computeSLASnapshot(mrShaped);

        return NextResponse.json(
            JSON.parse(JSON.stringify(snapshot)),
        );
  });
}

