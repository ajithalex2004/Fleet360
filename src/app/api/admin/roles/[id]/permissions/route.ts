import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const ROLES_TAG = 'roles:all';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withPlatformAdmin(prisma, async (tx) => {
    const rps = await tx.rolePermission.findMany({
      where: { roleId: params.id },
      include: { permission: true },
    });
    return NextResponse.json(rps.map(rp => rp.permission), {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
    });
  });
}

// PUT: replace all permissions for a role
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(bodyRaw);
    const { permissionIds }: { permissionIds: string[] } = body;
    const perms = await withPlatformAdmin(prisma, async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: params.id } });
      if (permissionIds.length > 0) {
        const BATCH = 50;
        for (let i = 0; i < permissionIds.length; i += BATCH) {
          const slice = permissionIds.slice(i, i + BATCH).map(pid => ({
            roleId: params.id, permissionId: pid,
          }));
          await tx.rolePermission.createMany({ data: slice, skipDuplicates: true });
        }
      }
      return tx.rolePermission.findMany({
        where: { roleId: params.id }, include: { permission: true },
      });
    });
    // The role's permission set changed, so the cached role list
    // (which embeds the permission count) is now stale.
    await revalidateCache(ROLES_TAG);
    return NextResponse.json(perms.map(rp => rp.permission));
  } catch (e) {
    console.error('[PUT /api/admin/roles/[id]/permissions]', e);
    return NextResponse.json(
      {
        error: 'Failed',
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
