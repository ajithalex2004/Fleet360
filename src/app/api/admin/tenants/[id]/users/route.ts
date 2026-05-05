import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Single joined query — avoids 2 sequential DB round-trips
    const userTenants = await prisma.userTenant.findMany({
      where: { tenantId: params.id },
      include: {
        role: true,
        user: true,   // join user in same query instead of a second findMany
      },
    });

    // Return flat structure so the UI can access u.firstName, u.username,
    // u.roleName, u.roleCode directly without nested drilling
    return NextResponse.json(
      userTenants.map(ut => ({
        ...ut.user,
        userId:         ut.userId,
        userTenantId:   ut.id,
        roleId:         ut.roleId,
        roleName:       ut.role.name,
        roleCode:       ut.role.code,
        isActive:       ut.isActive,
        isTenantActive: ut.isActive,
      })),
      {
        headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=30' },
      }
    );
  } catch (e) {
    console.error('GET /api/admin/tenants/[id]/users error:', e);
    return NextResponse.json({ error: 'Failed to fetch tenant users' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { userId, roleId } = body;

    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    if (!roleId)  return NextResponse.json({ error: 'roleId is required' },  { status: 400 });

    // Validate all referenced records exist
    const user   = await prisma.user.findUnique({ where: { id: userId } });
    if (!user)   return NextResponse.json({ error: `User not found: ${userId}` }, { status: 404 });

    const tenant = await prisma.tenant.findUnique({ where: { id: params.id } });
    if (!tenant) return NextResponse.json({ error: `Tenant not found: ${params.id}` }, { status: 404 });

    const role   = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role)   return NextResponse.json({ error: `Role not found: ${roleId}` }, { status: 404 });

    // Upsert: update role if assignment already exists
    const existing = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId, tenantId: params.id } },
    });

    const ut = existing
      ? await prisma.userTenant.update({
          where: { id: existing.id },
          data: { roleId, isActive: true },
        })
      : await prisma.userTenant.create({
          data: { userId, tenantId: params.id, roleId },
        });

    return NextResponse.json(ut, { status: 201 });
  } catch (e: any) {
    console.error('POST /api/admin/tenants/[id]/users error:', e);
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: 'User is already assigned to this tenant' }, { status: 409 });
    }
    return NextResponse.json(
      { error: e?.message ?? 'Failed to assign user to tenant' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });

    await prisma.userTenant.deleteMany({ where: { tenantId: params.id, userId } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('DELETE /api/admin/tenants/[id]/users error:', e);
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
