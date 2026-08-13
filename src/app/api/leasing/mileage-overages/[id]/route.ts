/**
 * /api/leasing/mileage-overages/[id] — single overage PATCH.
 *
 * Tenant scoping: requires x-tenant-id. Refuses to touch overages from
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
    const existing = await prisma.leaseMileageOverage.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const { contract, ...data } = await req.json();
    const overage = await prisma.leaseMileageOverage.update({
      where: { id: params.id },
      data,
    });
    return NextResponse.json(overage);
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
