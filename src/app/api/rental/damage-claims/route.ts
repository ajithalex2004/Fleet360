import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const status = sp.get('status');
    const bookingId = sp.get('bookingId');
    const { take, skip, page, limit } = paginate(sp);
    const where = { deletedAt: null, ...(status ? { status } : {}), ...(bookingId ? { bookingId } : {}) };
    const [data, total] = await Promise.all([
      prisma.damageClaim.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.damageClaim.count({ where }),
    ]);
    return NextResponse.json(paginatedResponse(data, total, page, limit));
  } catch (error) {
    console.error('Error fetching damage claims:', error);
    return NextResponse.json({ error: 'Failed to fetch damage claims' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const damageClaim = await prisma.damageClaim.create({ data: body });
    return NextResponse.json(damageClaim, { status: 201 });
  } catch (error) {
    console.error('Error creating damage claim:', error);
    return NextResponse.json({ error: 'Failed to create damage claim' }, { status: 500 });
  }
}
