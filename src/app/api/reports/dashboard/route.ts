export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

      // ReportSchedule has no tenant_id column in the schema — it's a
      // platform-global table, not per-tenant. Read it as-is rather than
      // filtering by a field that doesn't exist.
      const [schedules, vehicleCount, maintenanceCount, rentalInvoiceCount, leaseInvoiceCount] = await Promise.all([
        tx.reportSchedule.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
        tx.vehicle.count({ where: { tenantId, deletedAt: null } }),
        tx.maintenanceRequest.count({ where: { tenantId, deletedAt: null } }),
        tx.rentalInvoice.count({ where: { tenantId } }),
        tx.leaseInvoice.count({ where: { tenantId } }),
      ]);

      const scheduledReports = schedules.map(s => ({
        id: s.id,
        name: s.reportName,
        frequency: s.frequency,
        lastRun: s.lastRunAt ? s.lastRunAt.toISOString() : null,
        nextRun: s.nextRunAt ? s.nextRunAt.toISOString() : null,
      }));

      const generatedThisMonth = schedules.filter(s => s.lastRunAt && s.lastRunAt >= monthStart).length;
      const scheduledActive = schedules.filter(s => s.isActive !== false).length;

      return NextResponse.json({
        scheduledReports,
        stats: {
          generated: generatedThisMonth,
          analyzed: vehicleCount + maintenanceCount + rentalInvoiceCount + leaseInvoiceCount,
          scheduled: scheduledActive,
        },
      });
    } catch (e) {
      console.error('Failed to build reports dashboard:', e);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  });
}
