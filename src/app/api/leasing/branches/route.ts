/**
 * /api/leasing/branches — list/create/update/soft-delete lease branches.
 *
 * Tenant scoping: requires x-tenant-id.
 *
 * Note: the Prisma `LeaseBranch` model has no `deletedAt` field (only
 * `isActive`). The original route's `where: { tenantId, deletedAt: null }` filter
 * was a pre-existing type error (KNOWN-TS-001); this rewrite drops the
 * broken filter and uses `isActive` for the list view instead.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const branches = await prisma.leaseBranch.findMany({
      where: { tenantId, isActive: { not: false } },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json(branches);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const body = await req.json();
    const branch = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseBranch.create({ data: { ...body, tenantId } }),
    );
    return NextResponse.json(branch, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const body = await req.json();
    const { id, ...data } = body;
    const existing = await prisma.leaseBranch.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const branch = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseBranch.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
    }),
    );
    return NextResponse.json(branch);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const existing = await prisma.leaseBranch.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    // No soft-delete column on LeaseBranch — flip isActive to false.
    await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseBranch.update({
      where: { id },
      data: { isActive: false, updatedAt: new Date() },
    }),
    );
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
