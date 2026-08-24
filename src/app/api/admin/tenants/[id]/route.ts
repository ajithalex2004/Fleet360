import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const CACHE_TAG = 'tenants:list';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    return await withTenantRls(prisma, params.id, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: params.id },
        include: {
          modules: true,
          roles: { include: { _count: { select: { permissions: true, userTenants: true } } } },
          userTenants: { include: { role: true } },
        },
      });
      if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(tenant, {
        headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
      });
    });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    return await withTenantRls(prisma, params.id, async (tx) => {
      const { modules, userTenants, roles, ...data } = await req.json();
      const tenant = await tx.tenant.update({
        where: { id: params.id },
        data: { ...data, updatedAt: new Date() },
      });
      // Bust the list cache so the tenants page and the platform
      // dashboard's stat card see the change on the next render.
      revalidateCache([CACHE_TAG]);
      return NextResponse.json(tenant);
    });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    return await withTenantRls(prisma, params.id, async (tx) => {
      await tx.tenant.update({ where: { id: params.id }, data: { isActive: false } });
      revalidateCache([CACHE_TAG]);
      return NextResponse.json({ success: true });
    });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
