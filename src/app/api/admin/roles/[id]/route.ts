export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { checkRoleAccess } from '@/lib/admin-scope';
import { isSuperAdmin } from '@/lib/admin-access';
const CACHE_TAG = 'roles:all';

// `catch (e)` is typed `unknown` under strict mode — `e?.message` doesn't
// compile without narrowing first.
function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const access = await checkRoleAccess(req.headers, tenantId, params.id, 'read');
  if (access.denied) return access.denied;

  // Roles are tenant-scoped (tenantId column with RLS). Super admin can see
  // any role by id, so we use the '*' wildcard.
  return withPlatformAdmin(prisma, async (tx) => {
    const role = await tx.role.findUnique({
      where: { id: params.id },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // private: access depends on the caller, so shared caches must not reuse it.
    return NextResponse.json(role, { headers: { 'Cache-Control': 'private, max-age=30' } });
  });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
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
    const body = stripTenantOwnershipFields(bodyRaw);
    const { permissions, ...data } = body;
    if (!isSuperAdmin(req.headers)) {
      // A role's code is what gets signed into its holders' sessions, and
      // a tenant copy must keep its platform role's code. Tenant admins
      // may edit names, descriptions and permissions only.
      delete data.code;
      delete data.isSystem;
    } else if (data.code === 'SUPER_ADMIN' && access.owner !== null) {
      return NextResponse.json(
        { error: 'A tenant role cannot use the SUPER_ADMIN code.' },
        { status: 400 },
      );
    }
    // Super Admin can update any role including system roles
    // This allows editing name, description, isSystem flag etc.
    const role = await withPlatformAdmin(prisma, (tx) =>
      tx.role.update({
        where: { id: params.id },
        data,
      })
    );
    await revalidateCache(CACHE_TAG);
    return NextResponse.json(role);
  } catch (e) {
    console.error('PATCH /api/admin/roles/[id] error:', e);
    return NextResponse.json({ error: errorMessage(e, 'Failed to update role') }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const access = await checkRoleAccess(req.headers, tenantId, params.id, 'write');
  if (access.denied) return access.denied;

  try {
    // Super Admin can delete any role including system roles
    // The UI already shows a warning confirmation for system roles
    await withPlatformAdmin(prisma, (tx) =>
      tx.role.delete({ where: { id: params.id } })
    );
    await revalidateCache(CACHE_TAG);
    return NextResponse.json({ success: true });
    } catch (e) {
    console.error('DELETE /api/admin/roles/[id] error:', e);
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      (e.code === 'P2003' || e.code === 'P2014')
    ) {
      return NextResponse.json(
        { error: 'This role is assigned to users. Remove those assignments first before deleting.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: errorMessage(e, 'Failed to delete role') }, { status: 500 });
  }
}
