import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const incident = await prisma.tripIncident.findUnique({ where: { id: params.id } });
    if (!incident) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(incident);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    if (body.status === 'RESOLVED' && !body.resolvedAt) body.resolvedAt = new Date();
    const incident = await prisma.tripIncident.update({ where: { id: params.id }, data: { ...body, updatedAt: new Date() } });
    return NextResponse.json(incident);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.tripIncident.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
