import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { cacheRead, publicCacheControl, revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
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
    const tenantId = searchParams.get('tenantId');
    const lite = searchParams.get('lite') === 'true';

    const roles = await getRoles(tenantId, lite);
    return NextResponse.json(roles, {
      headers: { 'Cache-Control': publicCacheControl() },
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
        },
        include: { _count: { select: { permissions: true } } },
      })
    );
    // New role means the cached role list is now stale.
    await revalidateCache(CACHE_TAG);
    return NextResponse.json(role, { status: 201 });
    } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
