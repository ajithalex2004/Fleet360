/**
 * /api/leasing/renewals — list + create LeaseRenewal rows.
 *
 * Tenant scoping: requires x-tenant-id. Reads filter by tenant; creates
 * verify the source contract belongs to the caller's tenant and stamp the
 * new renewal with the same tenantId. renewalNo is scoped per tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const renewals = await prisma.leaseRenewal.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
      },
      include: { originalContract: { select: { contractNumber: true, endDate: true, monthlyRate: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(renewals);
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const contract = await prisma.leaseContract2.findFirst({
      where: { id: body.originalContractId, tenantId },
      select: { id: true },
    });
    if (!contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }
    const count = await prisma.leaseRenewal.count({ where: { tenantId } });
    const renewalNo = `RNW-${String(count + 1).padStart(5, '0')}`;
    const renewal = await prisma.leaseRenewal.create({
      data: { ...body, renewalNo, tenantId },
    });
    return NextResponse.json(renewal, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
