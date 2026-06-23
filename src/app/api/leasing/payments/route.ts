import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { legacyLeasingBillingWriteMoved } from '@/lib/finance-leasing-billing-routing';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const contractId = sp.get('contractId');
    const status = sp.get('status');
    const { take, skip, page, limit } = paginate(sp);
    const where = { ...(contractId ? { contractId } : {}), ...(status ? { status } : {}) };
    const [data, total] = await Promise.all([
      prisma.leasePayment.findMany({
        where,
        orderBy: { dueDate: 'desc' },
        take,
        skip,
      }),
      prisma.leasePayment.count({ where }),
    ]);
    return NextResponse.json(paginatedResponse(data, total, page, limit));
  } catch (error) {
    console.error('Error fetching payments:', error);
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const moved = legacyLeasingBillingWriteMoved(req, '/api/finance/leasing-billing/payments');
    if (moved) return moved;
    const body = await req.json();
    const payment = await prisma.leasePayment.create({ data: body });
    return NextResponse.json(payment, { status: 201 });
  } catch (error) {
    console.error('Error creating payment:', error);
    return NextResponse.json({ error: 'Failed to create payment' }, { status: 500 });
  }
}
