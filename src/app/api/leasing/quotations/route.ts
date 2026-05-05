import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  try {
    const quotations = await prisma.leaseQuotation.findMany({
      where: { deletedAt: null },
      include: {
        lineItems: true,
        vehicles:  true,
        lessee:    true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const safe = (quotations as any[]).map(q => ({
      ...q,
      vehicles:  Array.isArray(q.vehicles)  ? q.vehicles  : [],
      lineItems: Array.isArray(q.lineItems) ? q.lineItems : [],
    }));

    return NextResponse.json(safe);
  } catch (error) {
    console.error('GET /api/leasing/quotations error:', error);
    return NextResponse.json({ error: 'Failed to fetch quotations' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // Generate serial quotation number: QUO-0001, QUO-0002, etc.
    const countExisting = await prisma.leaseQuotation.count();
    const quotationNumber = `QUO-${String(countExisting + 1).padStart(4, '0')}`;


    // Strip relational/extra fields that aren't on the LeaseQuotation model
    const {
      vehicles, lineItems, lessee, inquiry,
      approvalSteps, contracts, ...quotationData
    } = body;

    const quotation = await prisma.leaseQuotation.create({
      data: {
        ...quotationData,
        quotationNumber,
        status: quotationData.status ?? 'NEW',
        ...(Array.isArray(vehicles) && vehicles.length > 0 ? {
          vehicles: {
            create: vehicles.map((v: any) => ({
              vehicleType: v.vehicleType ?? 'SEDAN',
              make:        v.make        ?? null,
              model:       v.model       ?? null,
              year:        v.year        ?? new Date().getFullYear(),
              quantity:    Number(v.quantity)    || 1,
              monthlyRate: Number(v.monthlyRate) || 0,
            })),
          },
        } : {}),
      },
      include: { lineItems: true, vehicles: true },
    });

    return NextResponse.json({
      ...quotation,
      vehicles:  Array.isArray(quotation.vehicles)  ? quotation.vehicles  : [],
      lineItems: Array.isArray(quotation.lineItems) ? quotation.lineItems : [],
    }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/leasing/quotations error:', error);
    return NextResponse.json(
      { error: error?.message ?? 'Failed to create quotation' },
      { status: 500 }
    );
  }
}
