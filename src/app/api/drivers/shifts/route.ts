import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const driverId = sp.get('driverId');
    const status = sp.get('status');
    const { take, skip, page, limit } = paginate(sp);
    const where = { ...(driverId ? { driverId } : {}), ...(status ? { status } : {}) };
    const [data, total] = await Promise.all([
      prisma.driverShift.findMany({
        where,
        orderBy: { shiftDate: 'desc' },
        take,
        skip,
      }),
      prisma.driverShift.count({ where }),
    ]);
    return NextResponse.json(paginatedResponse(data, total, page, limit));
  } catch (error) {
    console.error('Error fetching shifts:', error);
    return NextResponse.json({ error: 'Failed to fetch shifts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const shift = await prisma.driverShift.create({ data: body });
    return NextResponse.json(shift, { status: 201 });
  } catch (error) {
    console.error('Error creating shift:', error);
    return NextResponse.json({ error: 'Failed to create shift' }, { status: 500 });
  }
}
