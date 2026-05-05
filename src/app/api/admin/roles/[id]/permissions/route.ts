import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const rps = await prisma.rolePermission.findMany({
    where: { roleId: params.id },
    include: { permission: true },
  });
  return NextResponse.json(rps.map(rp => rp.permission));
}

// PUT: replace all permissions for a role
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { permissionIds }: { permissionIds: string[] } = await req.json();
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: params.id } }),
      prisma.rolePermission.createMany({
        data: permissionIds.map(pid => ({ roleId: params.id, permissionId: pid })),
        skipDuplicates: true,
      }),
    ]);
    const perms = await prisma.rolePermission.findMany({
      where: { roleId: params.id }, include: { permission: true },
    });
    return NextResponse.json(perms.map(rp => rp.permission));
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
