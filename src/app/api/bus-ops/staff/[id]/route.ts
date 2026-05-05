import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const member = await prisma.staffMember.findUnique({
      where: { id: params.id },
      include: { transportRequests: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
    if (!member) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(member);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { transportRequests, ...data } = body;
    const member = await prisma.staffMember.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
    });
    return NextResponse.json(member);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.staffMember.update({
      where: { id: params.id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
