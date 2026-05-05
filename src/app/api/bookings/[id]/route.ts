import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: params.id },
    });
    if (!booking) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(booking);
  } catch (error) {
    console.error('Error fetching booking:', error);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const booking = await prisma.booking.update({
      where: { id: params.id },
      data: body,
    });
    return NextResponse.json(booking);
  } catch (error) {
    console.error('Error updating booking:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

/**
 * PATCH /api/bookings/[id]
 * Partial update — used by the Logistics Dispatch Board to assign vehicle/driver
 * and transition status (e.g. CONFIRMED → ACTIVE).
 * Only whitelisted fields are patched to prevent accidental overwrites.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json() as Record<string, unknown>;

    // Whitelist patchable fields for dispatch actions
    const allowed = ['status', 'vehicleId', 'notes', 'approvedBy', 'approvedAt'];
    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) data[key] = body[key];
    }

    if (!Object.keys(data).length) {
      return NextResponse.json({ error: 'No valid fields to patch.' }, { status: 400 });
    }

    const booking = await prisma.booking.update({
      where: { id: params.id },
      data,
    });
    return NextResponse.json(booking);
  } catch (error) {
    console.error('Error patching booking:', error);
    return NextResponse.json({ error: 'Failed to patch' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.booking.update({
      where: { id: params.id },
      data: { deletedAt: new Date() },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting booking:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
