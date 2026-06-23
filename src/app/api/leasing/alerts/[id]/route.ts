import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { action, acknowledgedBy, ...data } = body;

    let updateData: Record<string, unknown> = { ...data };

    if (action === 'ACKNOWLEDGE') {
      updateData.status = 'ACKNOWLEDGED';
      updateData.acknowledgedBy = acknowledgedBy ?? null;
    } else if (action === 'RESOLVE') {
      updateData.status = 'RESOLVED';
      updateData.resolvedAt = new Date();
    }

    const alert = await prisma.leaseAlert.update({
      where: { id: params.id },
      data: updateData,
    });
    return NextResponse.json(alert);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.leaseAlert.delete({
      where: { id: params.id },
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
