export const dynamic = 'force-dynamic';

import { holdersOfRole, revokeRoleHolders } from '@/lib/auth/session-revocation';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { checkRoleAccess } from '@/lib/admin-scope';
const ROLES_TAG = 'roles:all';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const access = await checkRoleAccess(req.headers, tenantId, params.id, 'read');
  if (access.denied) return access.denied;

  return withPlatformAdmin(prisma, async (tx) => {
    const rps = await tx.rolePermission.findMany({
      where: { roleId: params.id },
      include: { permission: true },
    });
    return NextResponse.json(rps.map(rp => rp.permission), {
      // private: access depends on the caller, so shared caches must not reuse it.
      headers: { 'Cache-Control': 'private, max-age=30' },
    });
  });
}

// PUT: replace all permissions for a role
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const access = await checkRoleAccess(req.headers, tenantId, params.id, 'write');
  if (access.denied) return access.denied;

  try {
    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(bodyRaw) as { permissionIds: string[] };
    const { permissionIds } = body;
    const holders = await holdersOfRole(params.id);
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
    // Sessions carry the old permission set: they end within 60 s.
    await revokeRoleHolders(holders, 'role-permissions-changed', authz.userId);
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
