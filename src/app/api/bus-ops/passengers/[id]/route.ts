import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  assertPassengerTransition, PassengerTransitionError,
  type TripPassengerStatus,
} from '@/lib/bus-ops/state-machines';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    // Read current status so we can guard the transition.
    const existing = await prisma.tripPassenger.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true, status: true },
    });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const body = await req.json();
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
    const passenger = await prisma.tripPassenger.update({ where: { id: params.id }, data });
    return NextResponse.json(passenger);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const existing = await prisma.tripPassenger.findFirst({ where: { id: params.id, tenantId }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await prisma.tripPassenger.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
