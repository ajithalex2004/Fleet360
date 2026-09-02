export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PartnerInvoiceService } from '@/lib/exchange/partner-invoice-service';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/invoices?partnerId=...
 * POST /api/exchange/invoices
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const partnerId = searchParams.get('partnerId');

  const where = partnerId ? { partnerId } : {};
  const invoices = await prisma.partnerInvoice.findMany({
    where,
    include: {
      award: {
        include: { request: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ invoices });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { partnerId, awardId, invoiceNumber, invoiceDate, subtotalAmount, vatAmount } = body;

    if (!partnerId || !awardId || !invoiceNumber || subtotalAmount == null) {
      return NextResponse.json({ error: 'Missing required invoice fields' }, { status: 400 });
    }

    const invoice = await PartnerInvoiceService.submitInvoice({
      partnerId,
      awardId,
      invoiceNumber,
      invoiceDate: invoiceDate || new Date(),
      subtotalAmount: Number(subtotalAmount),
      vatAmount: vatAmount != null ? Number(vatAmount) : undefined,
    });

    return NextResponse.json({ ok: true, invoice });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to submit invoice' }, { status: 500 });
  }
}
