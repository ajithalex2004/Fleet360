/**
 * PATCH /api/leasing/renewals/[id]
 *
 * Tenant scoping: requires x-tenant-id. Refuses to touch renewals from
 * another tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const existing = await prisma.leaseRenewal.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await req.json();
    const { originalContract, ...data } = body;
    if (data.status === 'ACCEPTED' && !data.customerResponseAt) data.customerResponseAt = new Date();
    const renewal = await prisma.leaseRenewal.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
    });
    return NextResponse.json(renewal);
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
