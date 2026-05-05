import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const quotation = await prisma.leaseQuotation.findUnique({
      where: { id: params.id },
      include: {
        vehicles: true,
        lineItems: true,
      },
    });

    if (!quotation) {
      return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    }

    // Fetch approval history (Audit Trail)
    const history = await prisma.leaseApprovalStep.findMany({
      where: {
        entityId: params.id,
        entityType: 'QUOTATION',
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return NextResponse.json({
      ...quotation,
      history,
    });
  } catch (error) {
    console.error('Fetch quotation error:', error);
    return NextResponse.json({ error: 'Failed to fetch quotation details' }, { status: 500 });
  }
}
