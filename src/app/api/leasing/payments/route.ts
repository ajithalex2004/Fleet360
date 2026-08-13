/**
 * /api/leasing/payments — V1 collection route.
 *
 * History: written against the V1 `leasePayment` model (removed by
 * Layer 2.6). Now backed by `leasePayment2` with tenant scoping.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const sp = req.nextUrl.searchParams;
    const contractId = sp.get('contractId');
    const status = sp.get('status');
    const { take, skip, page, limit } = paginate(sp);
    // Filter payments to the caller's tenant by joining through the contract.
    const where = {
      ...(contractId ? { contractId } : {}),
      ...(status ? { status } : {}),
      contract: { tenantId },
    };
    const [data, total] = await Promise.all([
      prisma.leasePayment2.findMany({
        where,
        orderBy: { dueDate: 'desc' },
        take,
        skip,
      }),
      prisma.leasePayment2.count({ where }),
    ]);
    return NextResponse.json(paginatedResponse(data, total, page, limit));
  } catch (error) {
    console.error('Error fetching payments:', error);
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const payment = await prisma.leasePayment2.create({
      data: { ...body, tenantId },
    });
    return NextResponse.json(payment, { status: 201 });
  } catch (error) {
    console.error('Error creating payment:', error);
    return NextResponse.json({ error: 'Failed to create payment' }, { status: 500 });
  }
}
