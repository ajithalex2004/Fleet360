export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

const DAY_MS = 24 * 60 * 60 * 1000;

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
      const rangeStart = sp.get('from') ? new Date(sp.get('from')!) : new Date(rangeEnd.getTime() - 30 * DAY_MS);
      const totalDays = Math.max(1, Math.round((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS));

      const vehicles = await tx.vehicle.findMany({
        where: { tenantId, deletedAt: null },
        select: {
          id: true, make: true, model: true, licensePlate: true,
          status: true, currentMileage: true, odometerReading: true,
        },
        orderBy: { licensePlate: 'asc' },
        take: 500,
      });
      const vehicleIds = vehicles.map(v => v.id);

      // Rental revenue attributable to each vehicle in the selected window.
      const agreements = vehicleIds.length
        ? await tx.rentalAgreement.findMany({
            where: { tenantId, vehicleId: { in: vehicleIds } },
            select: { id: true, vehicleId: true },
          })
        : [];
      const agreementVehicle = new Map(agreements.map(a => [a.id, a.vehicleId]));
      const agreementIds = agreements.map(a => a.id);

      const invoices = agreementIds.length
        ? await tx.rentalInvoice.findMany({
            where: {
              tenantId,
              agreementId: { in: agreementIds },
              invoiceDate: { gte: rangeStart, lte: rangeEnd },
              status: { notIn: ['VOID', 'DRAFT'] },
            },
            select: { agreementId: true, totalAmount: true },
          })
        : [];
      const revenueByVehicle = new Map<string, number>();
      for (const inv of invoices) {
        const vId = agreementVehicle.get(inv.agreementId);
        if (!vId) continue;
        revenueByVehicle.set(vId, (revenueByVehicle.get(vId) ?? 0) + Number(inv.totalAmount));
      }

      // Maintenance days: how many days in the window each vehicle had an
      // open maintenance request overlapping the range. There's no daily
      // telemetry/status-history table, so active-vs-idle below is inferred
      // from the vehicle's current `status` rather than a real day-by-day log.
      const maintenanceRequests = vehicleIds.length
        ? await tx.maintenanceRequest.findMany({
            where: {
              tenantId,
              deletedAt: null,
              vehicleId: { in: vehicleIds },
              requestDate: { lte: rangeEnd },
              OR: [{ completionDate: null }, { completionDate: { gte: rangeStart } }],
            },
            select: { vehicleId: true, requestDate: true, completionDate: true },
          })
        : [];
      const maintenanceDaysByVehicle = new Map<string, number>();
      for (const mr of maintenanceRequests) {
        if (!mr.vehicleId || !mr.requestDate) continue;
        const overlapStart = Math.max(rangeStart.getTime(), mr.requestDate.getTime());
        const overlapEnd = Math.min(rangeEnd.getTime(), (mr.completionDate ?? rangeEnd).getTime());
        const days = Math.max(0, Math.round((overlapEnd - overlapStart) / DAY_MS));
        maintenanceDaysByVehicle.set(mr.vehicleId, (maintenanceDaysByVehicle.get(mr.vehicleId) ?? 0) + days);
      }

      const rows = vehicles.map(v => {
        const maintenanceDays = Math.min(totalDays, maintenanceDaysByVehicle.get(v.id) ?? 0);
        const remaining = totalDays - maintenanceDays;
        const isActive = v.status === 'RENTED';
        const activeDays = isActive ? remaining : 0;
        const idleDays = remaining - activeDays;
        const utilizationPercent = totalDays > 0 ? (activeDays / totalDays) * 100 : 0;
        const totalKM = Number(v.currentMileage ?? v.odometerReading ?? 0);
        const revenue = revenueByVehicle.get(v.id) ?? 0;

        return {
          id: v.id,
          vehicle: [v.make, v.model].filter(Boolean).join(' ') || 'Unknown Vehicle',
          plate: v.licensePlate ?? '—',
          makeModel: [v.make, v.model].filter(Boolean).join(' ') || '—',
          activeDays,
          idleDays,
          maintenanceDays,
          utilizationPercent,
          totalKM,
          revenue,
        };
      });

      const averageUtilization = rows.length
        ? rows.reduce((sum, r) => sum + r.utilizationPercent, 0) / rows.length
        : 0;
      const best = rows.reduce((a, b) => (b.utilizationPercent > (a?.utilizationPercent ?? -1) ? b : a), rows[0]);
      const worst = rows.reduce((a, b) => (b.utilizationPercent < (a?.utilizationPercent ?? Infinity) ? b : a), rows[0]);
      const totalKMDriven = rows.reduce((sum, r) => sum + r.totalKM, 0);

      return NextResponse.json({
        summary: {
          averageUtilization,
          bestPerformingVehicle: best ? `${best.vehicle} (${best.plate})` : 'N/A',
          worstPerformingVehicle: worst ? `${worst.vehicle} (${worst.plate})` : 'N/A',
          totalKMDriven,
        },
        vehicles: rows,
      });
    } catch (e) {
      console.error('Failed to build fleet utilization report:', e);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  });
}
