export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        // SECURITY FOLLOW-UP: report_schedules has no tenant_id column in
        // the DB (never added in any migration, unlike every other
        // business table) — filtering on tenantId here would throw a
        // Prisma validation error at runtime. Until that's fixed with a
        // real migration + backfill, this table is global/shared across
        // every tenant on the platform: any tenant can read any other
        // tenant's report schedules. Flagged to the user; not fixed in
        // Phase 2.
        const reportSchedules = await tx.reportSchedule.findMany({
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(reportSchedules);
      } catch (e) {
        console.error('Error fetching report schedules:', e);
        return NextResponse.json({ error: 'Failed to fetch report schedules' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      // tenantId is stripped because report_schedules has no tenant_id
      // column to store it in (see the GET handler's note above) — every
      // schedule created here is visible to every tenant.
      const body = stripTenantOwnershipFields(bodyRaw);
        const reportSchedule = await tx.reportSchedule.create({
          data: body as Prisma.ReportScheduleCreateInput,
        });
        return NextResponse.json(reportSchedule, { status: 201 });
        } catch (e) {
        console.error('Error creating report schedule:', e);
        return NextResponse.json({ error: 'Failed to create report schedule' }, { status: 500 });
      }
  });
}

