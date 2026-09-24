export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { cacheRead, revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { isSuperAdmin } from '@/lib/admin-access';
const CACHE_TAG = 'roles:all';

/**
 * Cached read of the role list. Cache key includes (tenantId, lite) so
 * each filter permutation is cached independently. The role catalog
 * is shared across users (per-tenant filtering happens at query time,
 * not at the auth layer), so it's safe to mark `public` for CDN.
 */
const getRoles = cacheRead(
  async (tenantId: string | null, lite: boolean) => withPlatformAdmin(prisma, (tx) =>
    tx.role.findMany({
      where: tenantId ? { OR: [{ tenantId }, { tenantId: null, isSystem: true }] } : {},
      include: lite
        ? { _count: { select: { permissions: true, userTenants: true } } }
        : {
            _count: { select: { permissions: true, userTenants: true } },
            permissions: { include: { permission: true } },
          },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    })
  ),
  [CACHE_TAG],
);

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const { searchParams } = new URL(req.url);
    // Non-super-admins get their own tenant's roles plus the platform
    // system roles; without a tenant filter this lists every tenant's roles.
    const tenantId = isSuperAdmin(req.headers)
      ? searchParams.get('tenantId')
      : authz.tenantId;
    const lite = searchParams.get('lite') === 'true';

    const roles = await getRoles(tenantId, lite);
    return NextResponse.json(roles, {
      // private: the list depends on the caller, so shared caches must not reuse it.
      headers: { 'Cache-Control': 'private, max-age=30' },
    });
    } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);
    const { permissionIds = [], ...roleData } = body;
    const role = await withPlatformAdmin(prisma, (tx) =>
      tx.role.create({
        data: {
          ...roleData,
          permissions: permissionIds.length
            ? { create: permissionIds.map((pid: string) => ({ permissionId: pid })) }
            : undefined,
        } as Prisma.RoleUncheckedCreateInput,
        include: { _count: { select: { permissions: true } } },
      })
    );
    // New role means the cached role list is now stale.
    await revalidateCache(CACHE_TAG);
    return NextResponse.json(role, { status: 201 });
    } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
