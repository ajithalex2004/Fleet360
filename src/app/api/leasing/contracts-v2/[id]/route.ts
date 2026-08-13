/**
 * /api/leasing/contracts-v2/[id] — V2 contract detail route.
 *
 * Tenant scoping: every operation requires x-tenant-id and refuses to read
 * or mutate contracts from another tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const contract = await prisma.leaseContract2.findFirst({
      where: { id: params.id, tenantId, deletedAt: null },
      include: {
        lessee: true,
        vehicles: true,
        payments2: { orderBy: { dueDate: 'asc' } },
        receipts: { orderBy: { createdAt: 'desc' } },
        exchanges: { orderBy: { exchangeDate: 'desc' } },
        alerts: { orderBy: { createdAt: 'desc' } },
        openingBranch: true,
        closingBranch: true,
        quotation: true,
      },
    });
    if (!contract) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(contract);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const body = await req.json();
    // Refuse to PATCH contracts from another tenant — the read-before-write
    // guard returns 404 instead of leaking the row exists.
    const existing = await prisma.leaseContract2.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const contract = await prisma.leaseContract2.update({
      where: { id: params.id },
      data: { ...body, updatedAt: new Date() },
    });
    return NextResponse.json(contract);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const existing = await prisma.leaseContract2.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await prisma.leaseContract2.update({
      where: { id: params.id },
      data: { deletedAt: new Date(), status: 'TERMINATED' },
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
