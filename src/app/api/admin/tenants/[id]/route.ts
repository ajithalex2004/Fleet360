import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: params.id },
      include: {
        modules: true,
        roles: { include: { _count: { select: { permissions: true, userTenants: true } } } },
        userTenants: { include: { role: true } },
      },
    });
    if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(tenant, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
    });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { modules, userTenants, roles, ...data } = await req.json();
    const tenant = await prisma.tenant.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
    });
    return NextResponse.json(tenant);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.tenant.update({ where: { id: params.id }, data: { isActive: false } });
    return NextResponse.json({ success: true });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
