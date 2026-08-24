import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {

  try {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

    if (!authz.ok) {

      return NextResponse.json({ error: authz.error }, { status: authz.status });

    }

    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

        const { searchParams } = new URL(req.url);
        const tripId = searchParams.get('tripId');
        const passengers = await tx.tripPassenger.findMany({
          where: { tenantId, ...(tripId ? { tripId } : {}) },
          include: { trip: { include: { route: true } } },
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(passengers);
    });
  } catch (e) {
    console.error('Error fetching passengers:', e);
    return NextResponse.json({ error: 'Failed to fetch passengers' }, { status: 500 });
  }
}


export async function POST(req: NextRequest) {

  try {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

    if (!authz.ok) {

      return NextResponse.json({ error: authz.error }, { status: authz.status });

    }

    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const passenger = await tx.tripPassenger.create({
          data: { ...body, tenantId },
          include: { trip: true },
        });
        // Recount confirmedCount from the source of truth (TripPassenger rows)
        // instead of `increment: 1`. The roster-expansion helper
        // (src/lib/bus-ops/expand-roster.ts) also updates this field by
        // re-counting; using increment here would race under concurrent
        // creates + expansions and could double- or under-count on retries.
        // A single point of truth avoids drift.
        const attendance = await tx.tripPassenger.count({
          where: { tripId: body.tripId, deletedAt: null },
        });
        await tx.tripSchedule.update({
          where: { id: body.tripId },
          data: { confirmedCount: attendance },
        });
        return NextResponse.json(passenger, { status: 201 });
    });
  } catch (e) {
    console.error('Error creating passenger:', e);
    return NextResponse.json({ error: 'Failed to create passenger' }, { status: 500 });
  }
}

