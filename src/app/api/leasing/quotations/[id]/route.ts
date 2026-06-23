import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildLesseeDisplayName } from '@/lib/leasing-lessee-display';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const quotation = await prisma.leaseQuotation.findUnique({
      where: { id: params.id },
      include: {
        vehicles: true,
        lineItems: true,
        lessee: true,
        inquiry: true,
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
      lesseeName: buildLesseeDisplayName(quotation),
      history,
    });
  } catch (error) {
    console.error('Fetch quotation error:', error);
    return NextResponse.json({ error: 'Failed to fetch quotation details' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const allowed: Record<string, unknown> = {};

    if (body.status !== undefined) allowed.status = body.status;
    if (body.validUntil !== undefined) allowed.validUntil = body.validUntil ? new Date(body.validUntil) : null;
    if (body.notes !== undefined) allowed.notes = body.notes;
    if (body.lesseeId !== undefined) allowed.lesseeId = body.lesseeId;
    allowed.updatedAt = new Date();

    const updated = await prisma.leaseQuotation.update({
      where: { id: params.id },
      data: allowed,
      include: {
        vehicles: true,
        lineItems: true,
        lessee: true,
        inquiry: true,
      },
    });

    return NextResponse.json({
      ...updated,
      lesseeName: buildLesseeDisplayName(updated),
    });
  } catch (error) {
    console.error('Patch quotation error:', error);
    return NextResponse.json({ error: 'Failed to update quotation' }, { status: 500 });
  }
}
