import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const schedule = await prisma.tripSchedule.findUnique({ where: { id: params.id } });
    if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (['COMPLETED', 'CANCELLED'].includes(schedule.status ?? '')) {
      return NextResponse.json({ error: `Cannot cancel from status: ${schedule.status}` }, { status: 400 });
    }
    const updated = await prisma.tripSchedule.update({
      where: { id: params.id },
      data: {
        status: 'CANCELLED',
        notes: body.reason ? `CANCELLED: ${body.reason}` : schedule.notes,
        updatedAt: new Date(),
      },
    });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to cancel' }, { status: 500 });
  }
}
