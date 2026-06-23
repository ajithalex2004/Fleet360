import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';
import { canonicalRoleCode, canonicalRoleLabel } from '@/lib/role-canonicalization';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const auth = await requireAdminPermission(req, 'view', 'users');
    if (auth instanceof NextResponse) return auth;
    const { id } = await params;
    const tenantId = resolveTenantBoundary(auth.ctx, id);
    if (tenantId instanceof NextResponse) return tenantId;

    // Single joined query — avoids 2 sequential DB round-trips
    const userTenants = await prisma.userTenant.findMany({
      where: { tenantId },
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
        roleName:       canonicalRoleLabel(ut.role.code, ut.role.name),
        roleCode:       canonicalRoleCode(ut.role) ?? ut.role.code,
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

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const auth = await requireAdminPermission(req, 'edit', 'users');
    if (auth instanceof NextResponse) return auth;
    const { id } = await params;
    const tenantId = resolveTenantBoundary(auth.ctx, id);
    if (tenantId instanceof NextResponse) return tenantId;

    const body = await req.json();
    const { userId, roleId } = body;

    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    if (!roleId)  return NextResponse.json({ error: 'roleId is required' },  { status: 400 });

    // Validate all referenced records exist
    const user   = await prisma.user.findUnique({ where: { id: userId } });
    if (!user)   return NextResponse.json({ error: `User not found: ${userId}` }, { status: 404 });

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return NextResponse.json({ error: `Tenant not found: ${tenantId}` }, { status: 404 });

    const role   = await prisma.role.findFirst({
      where: { id: roleId, OR: [{ tenantId }, { tenantId: null, isSystem: true }] },
    });
    if (!role)   return NextResponse.json({ error: `Role not found: ${roleId}` }, { status: 404 });

    // Upsert: update role if assignment already exists
    const existing = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
    });

    const ut = existing
      ? await prisma.userTenant.update({
          where: { id: existing.id },
          data: { roleId, isActive: true },
        })
      : await prisma.userTenant.create({
          data: { userId, tenantId, roleId },
        });

    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId,
      entityType: 'UserTenant',
      entityId: ut.id,
      entityName: user.email,
      action: existing ? 'UPDATE' : 'CREATE',
      before: existing,
      after: ut,
      summary: `Assigned ${user.email} to tenant ${tenant.name} as ${role.code}.`,
    });
    return NextResponse.json(ut, { status: 201 });
  } catch (e: unknown) {
    console.error('POST /api/admin/tenants/[id]/users error:', e);
    if (typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2002') {
      return NextResponse.json({ error: 'User is already assigned to this tenant' }, { status: 409 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to assign user to tenant' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const auth = await requireAdminPermission(req, 'delete', 'users');
    if (auth instanceof NextResponse) return auth;
    const { id } = await params;
    const tenantId = resolveTenantBoundary(auth.ctx, id);
    if (tenantId instanceof NextResponse) return tenantId;

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });

    const existing = await prisma.userTenant.findMany({ where: { tenantId, userId } });
    await prisma.userTenant.deleteMany({ where: { tenantId, userId } });
    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId,
      entityType: 'UserTenant',
      entityId: userId,
      action: 'DELETE',
      before: existing,
      summary: `Removed user ${userId} from tenant ${tenantId}.`,
    });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    console.error('DELETE /api/admin/tenants/[id]/users error:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
