import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const role = await prisma.role.findUnique({
    where: { id: params.id },
    include: { permissions: { include: { permission: true } } },
  });
  if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(role);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { permissions, ...data } = await req.json();
    // Super Admin can update any role including system roles
    // This allows editing name, description, isSystem flag etc.
    const role = await prisma.role.update({
      where: { id: params.id },
      data,
    });
    return NextResponse.json(role);
  } catch (e: any) {
    console.error('PATCH /api/admin/roles/[id] error:', e);
    return NextResponse.json({ error: e?.message ?? 'Failed to update role' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Super Admin can delete any role including system roles
    // The UI already shows a warning confirmation for system roles
    await prisma.role.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('DELETE /api/admin/roles/[id] error:', e);
    if (e?.code === 'P2003' || e?.code === 'P2014') {
      return NextResponse.json(
        { error: 'This role is assigned to users. Remove those assignments first before deleting.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: e?.message ?? 'Failed to delete role' }, { status: 500 });
  }
}
