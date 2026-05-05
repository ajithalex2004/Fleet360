import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { assertCanWrite } from '@/lib/access-control';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const status = sp.get('status');
    const lesseeId = sp.get('lesseeId');
    const { take, skip, page, limit } = paginate(sp);
    const where = { deletedAt: null, ...(status ? { status } : {}), ...(lesseeId ? { lesseeId } : {}) };
    const [data, total] = await Promise.all([
      prisma.leaseContract.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.leaseContract.count({ where }),
    ]);
    return NextResponse.json(paginatedResponse(data, total, page, limit));
  } catch (error) {
    console.error('Error fetching contracts:', error);
    return NextResponse.json({ error: 'Failed to fetch contracts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = assertCanWrite(req, 'leasing');
  if (guard) return guard;

  try {
    const body = await req.json();
    const contract = await prisma.leaseContract.create({ data: body });
    return NextResponse.json(contract, { status: 201 });
  } catch (error) {
    console.error('Error creating contract:', error);
    return NextResponse.json({ error: 'Failed to create contract' }, { status: 500 });
  }
}
