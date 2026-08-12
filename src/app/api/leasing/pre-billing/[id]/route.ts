/**
 * /api/leasing/pre-billing/[id] — PATCH a pre-billing statement.
 *
 * Tenant scoping: requires x-tenant-id. Refuses to touch statements from
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
    const existing = await prisma.leasePreBillingStatement.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await req.json();
    const { contract, ...data } = body;
    if (data.status === 'SENT' && !data.sentAt) data.sentAt = new Date();
    if (data.status === 'CONFIRMED' && !data.confirmedAt) data.confirmedAt = new Date();
    const stmt = await prisma.leasePreBillingStatement.update({
      where: { id: params.id },
      data,
    });
    return NextResponse.json(stmt);
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
