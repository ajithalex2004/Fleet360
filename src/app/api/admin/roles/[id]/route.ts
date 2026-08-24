import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const CACHE_TAG = 'roles:all';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  // Roles are tenant-scoped (tenantId column with RLS). Super admin can see
  // any role by id, so we use the '*' wildcard.
  return withPlatformAdmin(prisma, async (tx) => {
    const role = await tx.role.findUnique({
      where: { id: params.id },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(role, { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } });
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(bodyRaw);
    const { permissions, ...data } = body;
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
    return NextResponse.json({ error: e?.message ?? 'Failed to update role' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

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
    if (e?.code === 'P2003' || e?.code === 'P2014') {
      return NextResponse.json(
        { error: 'This role is assigned to users. Remove those assignments first before deleting.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: e?.message ?? 'Failed to delete role' }, { status: 500 });
  }
}
