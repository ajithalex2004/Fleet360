import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId');
    // lite=true skips the full permissions include — used by dropdowns that only need name/code/id
    const lite = searchParams.get('lite') === 'true';

    const roles = await prisma.role.findMany({
      where: tenantId ? { OR: [{ tenantId }, { tenantId: null, isSystem: true }] } : {},
      include: lite
        ? { _count: { select: { permissions: true, userTenants: true } } }
        : {
            _count: { select: { permissions: true, userTenants: true } },
            permissions: { include: { permission: true } },
          },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return NextResponse.json(roles, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
    });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { permissionIds = [], ...roleData } = body;
    const role = await prisma.role.create({
      data: {
        ...roleData,
        permissions: permissionIds.length
          ? { create: permissionIds.map((pid: string) => ({ permissionId: pid })) }
          : undefined,
      },
      include: { _count: { select: { permissions: true } } },
    });
    return NextResponse.json(role, { status: 201 });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
