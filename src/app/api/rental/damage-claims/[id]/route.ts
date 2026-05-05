import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const claim = await prisma.damageClaim.findUnique({
      where: { id: params.id },
      include: { booking: { include: { customer: true } } },
    });
    if (!claim) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(claim);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { booking, ...data } = body;
    const claim = await prisma.damageClaim.update({ where: { id: params.id }, data });
    return NextResponse.json(claim);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.damageClaim.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
