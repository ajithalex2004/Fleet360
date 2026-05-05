import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * PATCH /api/finance/vat/:id  — advance VAT return status (DRAFT→SUBMITTED→PAID)
 * GET   /api/finance/vat/:id  — single VAT return detail
 */

const VALID_STATUSES = ['DRAFT', 'SUBMITTED', 'PAID', 'CANCELLED'];

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const vatReturn = await prisma.vatReturn.findUnique({ where: { id: params.id } });
    if (!vatReturn) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(vatReturn);
  } catch (err) {
    console.error('[finance/vat GET/:id]', err);
    return NextResponse.json({ error: 'Failed to fetch VAT return' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { status, submissionDate, paymentDate, notes } = body;

    if (status && !VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }

    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (status)          data.status = status;
    if (notes !== undefined) data.notes = notes;
    if (status === 'SUBMITTED' || submissionDate) {
      data.submissionDate = submissionDate ? new Date(submissionDate) : new Date();
    }
    if (status === 'PAID' || paymentDate) {
      data.paymentDate = paymentDate ? new Date(paymentDate) : new Date();
    }

    const updated = await prisma.vatReturn.update({ where: { id: params.id }, data });
    return NextResponse.json({ success: true, ...updated });
  } catch (err) {
    console.error('[finance/vat PATCH/:id]', err);
    return NextResponse.json({ error: 'Failed to update VAT return' }, { status: 500 });
  }
}
