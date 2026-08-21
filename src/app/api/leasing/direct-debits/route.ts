/**
 * /api/leasing/direct-debits — list + create LeaseDirectDebit rows.
 *
 * Tenant scoping: requires x-tenant-id. Reads filter by tenant (and the
 * join through lessee); creates stamp the new row with the same tenantId.
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
    const { searchParams } = new URL(req.url);
    const lesseeId = searchParams.get('lesseeId');
    const dds = await prisma.leaseDirectDebit.findMany({
      where: {
        tenantId,
        ...(lesseeId
          ? { lessee: { id: lesseeId, tenantId } }
          : {}),
      },
      include: { lessee: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(dds);
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
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
    const lessee = await prisma.lessee.findFirst({
      where: { id: body.lesseeId, tenantId },
      select: { id: true },
    });
    if (!lessee) {
      return NextResponse.json({ error: 'Lessee not found' }, { status: 404 });
    }
    const count = await prisma.leaseDirectDebit.count({ where: { tenantId } });
    const mandateRef = body.mandateRef ?? `DD-${String(count + 1).padStart(6, '0')}`;
    const dd = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseDirectDebit.create({
      data: { ...body, mandateRef, tenantId },
    }),
    );
    return NextResponse.json(dd, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
