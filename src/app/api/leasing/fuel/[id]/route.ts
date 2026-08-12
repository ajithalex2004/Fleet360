/**
 * /api/leasing/fuel/[id] — single fuel log PATCH + DELETE.
 *
 * Tenant scoping: requires x-tenant-id. Refuses to touch logs from another
 * tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const existing = await prisma.leaseFuelLog.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await req.json();
    const { contract, ...data } = body;
    const log = await prisma.leaseFuelLog.update({ where: { id: params.id }, data });
    return NextResponse.json(log);
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const existing = await prisma.leaseFuelLog.findFirst({
    where: { id: params.id, tenantId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  await prisma.leaseFuelLog.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
