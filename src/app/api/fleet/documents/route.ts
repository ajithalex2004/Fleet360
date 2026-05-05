import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const vehicleId = sp.get('vehicleId');
    const status = sp.get('status');
    const { take, skip, page, limit } = paginate(sp);
    const where = { ...(vehicleId ? { vehicleId } : {}), ...(status ? { status } : {}) };
    const [data, total] = await Promise.all([
      prisma.vehicleDocument.findMany({
        where,
        orderBy: { expiryDate: 'asc' },
        take,
        skip,
      }),
      prisma.vehicleDocument.count({ where }),
    ]);
    return NextResponse.json(paginatedResponse(data, total, page, limit));
  } catch (error) {
    console.error('Error fetching documents:', error);
    return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const document = await prisma.vehicleDocument.create({ data: body });
    return NextResponse.json(document, { status: 201 });
  } catch (error) {
    console.error('Error creating document:', error);
    return NextResponse.json({ error: 'Failed to create document' }, { status: 500 });
  }
}
