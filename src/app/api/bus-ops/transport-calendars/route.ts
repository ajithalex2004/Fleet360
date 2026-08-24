/**
 * /api/bus-ops/transport-calendars — MVP CRUD for tenant exception-day
 * calendars. GET lists active calendars (with entries); POST creates a
 * calendar; POST /[id]/entries adds an entry.
 *
 * Consumed by the schedule-template generator to skip HOLIDAY dates.
 */
import { NextRequest, NextResponse } from 'next/server';
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
        const rows = await tx.transportCalendar.findMany({
          where: { tenantId, deletedAt: null },
          include: { entries: { orderBy: { entryDate: 'asc' } } },
          orderBy: [{ isActive: 'desc' }, { effectiveFrom: 'desc' }],
        });
        return NextResponse.json(rows);
      } catch (e) {
        console.error('[transport-calendars.GET]', e);
        return NextResponse.json({ error: 'Failed to fetch calendars' }, { status: 500 });
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

      const createdBy = req.headers.get('x-user-id') ?? null;
      try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        if (!body?.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });
        const row = await tx.transportCalendar.create({
          data: {
            tenantId,                       // stamped from session
            name: body.name.trim(),
            effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(),
            effectiveTo:   body.effectiveTo   ? new Date(body.effectiveTo)   : null,
            isActive:      body.isActive ?? true,
            notes:         body.notes?.trim() || null,
            createdBy,
          },
        });
        return NextResponse.json(row, { status: 201 });
        } catch (e) {
        console.error('[transport-calendars.POST]', e);
        return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
      }
  });
}

