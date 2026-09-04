export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

const DAY_MS = 24 * 60 * 60 * 1000;

// Early lifecycle stages read as "scheduled" (work not yet underway), closing
// stages read as "completed"; everything in between (in progress, awaiting
// invoice/estimate action) reads as "pending" for the status badge.
const COMPLETED_STATUSES = new Set(['Closed', 'Invoice Submitted', 'Completed', 'Maintenance Completed', 'Ready For Service']);
const SCHEDULED_STATUSES = new Set(['Requested', 'Submitted', 'Accepted', 'Under Estimation', 'Pending Estimation Approval']);

function toBadgeStatus(status: string | null): 'completed' | 'pending' | 'scheduled' {
  if (!status) return 'pending';
  if (COMPLETED_STATUSES.has(status)) return 'completed';
  if (SCHEDULED_STATUSES.has(status)) return 'scheduled';
  return 'pending';
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const rangeEnd = sp.get('to') ? new Date(sp.get('to')!) : new Date();
      const rangeStart = sp.get('from') ? new Date(sp.get('from')!) : new Date(rangeEnd.getTime() - 90 * DAY_MS);

      const requests = await tx.maintenanceRequest.findMany({
        where: {
          tenantId,
          deletedAt: null,
          OR: [
            { completionDate: { gte: rangeStart, lte: rangeEnd } },
            { completionDate: null, requestDate: { gte: rangeStart, lte: rangeEnd } },
          ],
        },
        include: { Vehicle: { select: { make: true, model: true, licensePlate: true } } },
        orderBy: { requestDate: 'desc' },
        take: 500,
      });

      const costs = requests.map(r => {
        const vehicleLabel = r.Vehicle
          ? [r.Vehicle.make, r.Vehicle.model].filter(Boolean).join(' ') + (r.Vehicle.licensePlate ? ` (${r.Vehicle.licensePlate})` : '')
          : 'Unassigned Vehicle';

        return {
          id: r.id,
          vehicleId: r.vehicleId,
          vehicle: vehicleLabel || 'Unassigned Vehicle',
          date: (r.completionDate ?? r.requestDate ?? new Date()).toISOString(),
          category: r.maintenanceType || 'General',
          cost: Number(r.actualCost ?? r.estimatedCost ?? 0),
          description: r.description || '',
          status: toBadgeStatus(r.status),
        };
      });

      const totalCost = costs.reduce((sum, c) => sum + c.cost, 0);
      const vehiclesWithCost = new Set(costs.filter(c => c.vehicleId).map(c => c.vehicleId));
      const averagePerVehicle = vehiclesWithCost.size > 0 ? totalCost / vehiclesWithCost.size : 0;

      // Keyed by vehicleId (not the display label) so two vehicles that
      // happen to share a make/model with no recorded plate don't collide.
      const costByVehicleId = new Map<string, { label: string; cost: number }>();
      for (const c of costs) {
        if (!c.vehicleId) continue;
        const entry = costByVehicleId.get(c.vehicleId) ?? { label: c.vehicle, cost: 0 };
        entry.cost += c.cost;
        costByVehicleId.set(c.vehicleId, entry);
      }
      let highestCostVehicle = 'N/A';
      let highestCost = -1;
      for (const { label, cost } of costByVehicleId.values()) {
        if (cost > highestCost) { highestCost = cost; highestCostVehicle = label; }
      }

      const costByCategoryMap = new Map<string, number>();
      for (const c of costs) {
        costByCategoryMap.set(c.category, (costByCategoryMap.get(c.category) ?? 0) + c.cost);
      }
      const costByCategory = Array.from(costByCategoryMap.entries())
        .map(([category, cost]) => ({ category, cost }))
        .sort((a, b) => b.cost - a.cost);

      return NextResponse.json({
        summary: { totalCost, averagePerVehicle, highestCostVehicle, costByCategory },
        costs: costs.map(({ vehicleId, ...rest }) => rest),
      });
    } catch (e) {
      console.error('Failed to build maintenance cost report:', e);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  });
}
