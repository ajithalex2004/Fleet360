/**
 * /api/leasing/contracts/[id] — V1 detail route.
 *
 * History: written against the V1 `leaseContract` model (removed by
 * Layer 2.6). Now backed by `leaseContract2` with tenant scoping on every
 * operation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const contract = await prisma.leaseContract2.findFirst({
      where: { id: params.id, tenantId },
    });
    if (!contract) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(contract);
  } catch (error) {
    console.error('Error fetching contract:', error);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const body = await req.json();
    // Guarded update — refuses to touch contracts from another tenant.
    const existing = await prisma.leaseContract2.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const contract = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseContract2.update({
      where: { id: params.id },
      data: body,
    }),
    );
    return NextResponse.json(contract);
  } catch (error) {
    console.error('Error updating contract:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const existing = await prisma.leaseContract2.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseContract2.update({
      where: { id: params.id },
      data: { deletedAt: new Date() },
    }),
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting contract:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
