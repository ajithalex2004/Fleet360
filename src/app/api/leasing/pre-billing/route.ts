/**
 * /api/leasing/pre-billing — list + create pre-billing statements.
 *
 * Tenant scoping: requires x-tenant-id. The contract referenced by the new
 * statement must belong to the caller's tenant; statementNo is scoped per
 * tenant; every created row is stamped with the same tenantId.
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
    const contractId = searchParams.get('contractId');
    const status     = searchParams.get('status');
    const stmts = await prisma.leasePreBillingStatement.findMany({
      where: {
        tenantId,
        ...(contractId
          ? { contract: { id: contractId, tenantId } }
          : {}),
        ...(status ? { status } : {}),
      },
      include: { contract: { select: { contractNumber: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(stmts);
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

    // Verify the referenced contract belongs to this tenant.
    const contract = await prisma.leaseContract2.findFirst({
      where: { id: body.contractId, tenantId },
      select: { id: true },
    });
    if (!contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }

    const count = await prisma.leasePreBillingStatement.count({ where: { tenantId } });
    const statementNo = `PBS-${String(count + 1).padStart(5, '0')}`;
    const baseFields = ['baseRent','fuelCharges','fineCharges','maintenanceCharges','overageCharges','otherCharges'];
    const sub = baseFields.reduce((s, k) => s + parseFloat(body[k] || '0'), 0);
    const vatAmount = sub * 0.05;
    const totalAmount = sub + vatAmount;
    const stmt = await prisma.leasePreBillingStatement.create({
      data: { ...body, statementNo, vatAmount, totalAmount, tenantId },
    });
    return NextResponse.json(stmt, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
