import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  assertPassengerTransition, PassengerTransitionError,
  type TripPassengerStatus,
} from '@/lib/bus-ops/state-machines';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        // Read current status so we can guard the transition.
        const existing = await tx.tripPassenger.findFirst({
          where: { id: params.id, tenantId },
          select: { id: true, status: true },
        });
        if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { trip, ...data } = body;

        // Status change → assert allowed transition. Same-state assignments
        // pass (idempotent). Illegal transitions return 409 with a message
        // listing the allowed next states from the current one.
        if (data.status && data.status !== existing.status) {
          try {
            assertPassengerTransition(
              (existing.status ?? 'CONFIRMED') as TripPassengerStatus,
              data.status as TripPassengerStatus,
            );
          } catch (e) {
            if (e instanceof PassengerTransitionError) return NextResponse.json({ error: e.message }, { status: 409 });
            throw e;
          }
        }

        // If marking as BOARDED, set boardedAt
        if (data.status === 'BOARDED' && !data.boardedAt) data.boardedAt = new Date();
        const passenger = await tx.tripPassenger.update({ where: { id: params.id }, data });
        return NextResponse.json(passenger);
      } catch (e) {
        return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
      }
  });
}


export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        const existing = await tx.tripPassenger.findFirst({ where: { id: params.id, tenantId }, select: { id: true } });
        if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        await tx.tripPassenger.delete({ where: { id: params.id } });
        return NextResponse.json({ success: true });
        } catch (e) {
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
      }
  });
}

