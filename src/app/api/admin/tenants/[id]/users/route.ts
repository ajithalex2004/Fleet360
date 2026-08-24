import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls, withPlatformAdmin } from '@/lib/rls';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    // Single joined query — avoids 2 sequential DB round-trips
    // UserTenant has RLS, Role has RLS, User is global. We use withTenantRls
    // so the join is constrained to the target tenant's memberships.
    const userTenants = await withTenantRls(prisma, params.id, (tx) =>
      tx.userTenant.findMany({
        where: { tenantId: params.id },
        include: {
          role: true,
          user: true,   // join user in same query instead of a second findMany
        },
      })
    );

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
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);
    const { userId, roleId } = body;

    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    if (!roleId)  return NextResponse.json({ error: 'roleId is required' },  { status: 400 });

    // User is global (no RLS), but Role has RLS. We need to look up the
    // User (no RLS issue) and the Role (need to see this tenant's roles
    // plus system roles) — so use withPlatformAdmin for the validation
    // step. The actual UserTenant write happens inside withTenantRls.
    const validations = await withPlatformAdmin(prisma, async (tx) => {
      const user   = await tx.user.findUnique({ where: { id: userId } });
      if (!user)   return { error: `User not found: ${userId}`, status: 404 as const };
      const tenant = await tx.tenant.findUnique({ where: { id: params.id } });
      if (!tenant) return { error: `Tenant not found: ${params.id}`, status: 404 as const };
      const role   = await tx.role.findUnique({ where: { id: roleId } });
      if (!role)   return { error: `Role not found: ${roleId}`, status: 404 as const };
      return { ok: true as const };
    });
    if ('error' in validations) {
      return NextResponse.json({ error: validations.error }, { status: validations.status });
    }

    // Upsert membership inside the tenant-scoped transaction.
    return await withTenantRls(prisma, params.id, async (tx) => {
      const existing = await tx.userTenant.findUnique({
        where: { userId_tenantId: { userId, tenantId: params.id } },
      });

      const ut = existing
        ? await tx.userTenant.update({
            where: { id: existing.id },
            data: { roleId, isActive: true },
          })
        : await tx.userTenant.create({
            data: { userId, tenantId: params.id, roleId },
          });

      return NextResponse.json(ut, { status: 201 });
    });
    } catch (e) {
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
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });

    await withTenantRls(prisma, params.id, (tx) =>
      tx.userTenant.deleteMany({ where: { tenantId: params.id, userId } })
    );
    return NextResponse.json({ success: true });
    } catch (e) {
    console.error('DELETE /api/admin/tenants/[id]/users error:', e);
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
