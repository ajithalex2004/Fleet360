import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { trip, ...data } = body;
    // If marking as BOARDED, set boardedAt
    if (data.status === 'BOARDED' && !data.boardedAt) data.boardedAt = new Date();
    const passenger = await prisma.tripPassenger.update({ where: { id: params.id }, data });
    return NextResponse.json(passenger);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.tripPassenger.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
