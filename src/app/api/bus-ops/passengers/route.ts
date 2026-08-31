export const dynamic = 'force-dynamic';

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

        // tripId arrives from the request body and was previously trusted.
        // Nothing checked it belonged to the caller: the create attached a
        // passenger to any trip, the recount below counted across tenants,
        // and the update overwrote a foreign trip's confirmedCount. RLS would
        // normally stop that, but the database role holds BYPASSRLS, so it
        // does not. Resolve the trip within the tenant first and refuse if it
        // isn't there — 404 rather than 403, so this cannot be used to probe
        // which trip ids exist.
        const trip = body.tripId
          ? await tx.tripSchedule.findFirst({
              where: { id: body.tripId, tenantId, deletedAt: null },
              select: { id: true },
            })
          : null;
        if (!trip) {
          return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
        }

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
          where: { tripId: trip.id, tenantId, deletedAt: null },
        });
        // updateMany, not update: update takes a unique selector and cannot
        // carry tenantId, so it would still address the row by id alone.
        // The trip is already proven to be this tenant's above; this keeps
        // the guarantee visible in the statement itself.
        await tx.tripSchedule.updateMany({
          where: { id: trip.id, tenantId },
          data: { confirmedCount: attendance },
        });
        return NextResponse.json(passenger, { status: 201 });
    });
  } catch (e) {
    console.error('Error creating passenger:', e);
    return NextResponse.json({ error: 'Failed to create passenger' }, { status: 500 });
  }
}

