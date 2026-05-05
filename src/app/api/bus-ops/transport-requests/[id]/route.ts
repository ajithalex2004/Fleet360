import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { staffMember, ...data } = body;
    if (data.status === 'APPROVED' && !data.approvedAt) data.approvedAt = new Date();
    const request = await prisma.staffTransportRequest.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
      include: { staffMember: true },
    });
    return NextResponse.json(request);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.staffTransportRequest.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
