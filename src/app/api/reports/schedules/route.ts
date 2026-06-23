import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  attachTenantToEntity,
  ensureOperationalTenantColumn,
  recordOperationalChange,
  requireOperationalContext,
  tenantScopedIds,
} from '@/lib/cross-module-governance';

export async function GET(req: NextRequest) {
  try {
    const ctx = requireOperationalContext(req, 'reports', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;
    await ensureOperationalTenantColumn('report_schedules');
    const ids = await tenantScopedIds('report_schedules', ctx.tenantId);
    if (ids.length === 0) return NextResponse.json([]);

    const reportSchedules = await prisma.reportSchedule.findMany({
      where: { id: { in: ids } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(reportSchedules);
  } catch (error) {
    console.error('Error fetching report schedules:', error);
    return NextResponse.json({ error: 'Failed to fetch report schedules' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireOperationalContext(req, 'reports', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    await ensureOperationalTenantColumn('report_schedules');
    const body = await req.json();
    const data = { ...body };
    delete data.tenantId;
    delete data.deletedAt;
    const reportSchedule = await prisma.reportSchedule.create({ data });
    await attachTenantToEntity('report_schedules', reportSchedule.id, ctx.tenantId);
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'ReportSchedule',
      entityId: reportSchedule.id,
      action: 'CREATE',
      after: reportSchedule,
      summary: `Created report schedule ${reportSchedule.reportName}`,
    });
    return NextResponse.json(reportSchedule, { status: 201 });
  } catch (error) {
    console.error('Error creating report schedule:', error);
    return NextResponse.json({ error: 'Failed to create report schedule' }, { status: 500 });
  }
}
