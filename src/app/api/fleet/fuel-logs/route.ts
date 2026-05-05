import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const vehicleId = sp.get('vehicleId');
    const driverId = sp.get('driverId');
    const { take, skip, page, limit } = paginate(sp);
    const where = { ...(vehicleId ? { vehicleId } : {}), ...(driverId ? { driverId } : {}) };
    const [data, total] = await Promise.all([
      prisma.fuelLog.findMany({
        where,
        orderBy: { fuelDate: 'desc' },
        take,
        skip,
      }),
      prisma.fuelLog.count({ where }),
    ]);
    return NextResponse.json(paginatedResponse(data, total, page, limit));
  } catch (error) {
    console.error('Error fetching fuel logs:', error);
    return NextResponse.json({ error: 'Failed to fetch fuel logs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const fuelLog = await prisma.fuelLog.create({ data: body });
    return NextResponse.json(fuelLog, { status: 201 });
  } catch (error) {
    console.error('Error creating fuel log:', error);
    return NextResponse.json({ error: 'Failed to create fuel log' }, { status: 500 });
  }
}
