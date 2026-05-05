import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { assertCanWrite } from '@/lib/access-control';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const status = sp.get('status');
    const customerId = sp.get('customerId');
    const { take, skip, page, limit } = paginate(sp);
    const where = {
      ...(status ? { status } : {}),
      ...(customerId ? { customerId } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.rentalAgreement.findMany({
        where,
        include: {
          booking: {
            select: {
              id: true,
              bookingRef: true,
              pickupDate: true,
              dropoffDate: true,
              customer: { select: { id: true, fullName: true, phone: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.rentalAgreement.count({ where }),
    ]);
    return NextResponse.json(paginatedResponse(data, total, page, limit));
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = assertCanWrite(req, 'rac');
  if (guard) return guard;

  try {
    const body = await req.json();
    const count = await prisma.rentalAgreement.count();
    const agreementNo = body.agreementNo ?? `AGR-${String(count + 1).padStart(5, '0')}`;
    const agreement = await prisma.rentalAgreement.create({
      data: { ...body, agreementNo },
    });
    return NextResponse.json(agreement, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
