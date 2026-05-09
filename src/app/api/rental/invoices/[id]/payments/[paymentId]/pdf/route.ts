/**
 * GET /api/rental/invoices/[id]/payments/[paymentId]/pdf?lang=en|ar
 *
 * Receipt PDF for a single rental payment. Reuses the leasing ReceiptPdf
 * template — adapts RentalInvoicePayment data to its shape.
 */

import { createElement } from 'react';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { renderPdf } from '@/lib/pdf/render';
import { ReceiptPdf, type ReceiptPdfData } from '@/lib/pdf/templates/receipt';
import type { Lang } from '@/lib/pdf/theme';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const VENDOR = {
  name: 'Fleet360 — Rent-A-Car',
  tagline: 'UAE Smart Transport Management',
  address: 'Dubai, United Arab Emirates',
  email: 'finance@fleet360.app',
  trn: '',
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> },
) {
  const { id: invoiceId, paymentId } = await params;
  const lang: Lang = req.nextUrl.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
  const download = req.nextUrl.searchParams.get('download') === '1';

  try {
    const payment = await prisma.rentalInvoicePayment.findUnique({
      where: { id: paymentId },
      include: { invoice: true },
    });
    if (!payment || payment.invoiceId !== invoiceId) return jsonErr('Receipt not found', 404);

    const customer = await prisma.rentalCustomer.findUnique({ where: { id: payment.invoice.customerId } });
    const agreement = await prisma.rentalAgreement.findUnique({ where: { id: payment.invoice.agreementId } });

    // Map RentalInvoicePayment.paymentMethod (CASH|CARD|BANK|CHEQUE|ONLINE)
    // to receipt template's paymentMethod (CASH|CHEQUE|BANK_TRANSFER|CARD).
    const pmMap: Record<string, string> = { CASH: 'CASH', CARD: 'CARD', BANK: 'BANK_TRANSFER', CHEQUE: 'CHEQUE', ONLINE: 'CARD' };
    const data: ReceiptPdfData = {
      receiptNumber: payment.receiptNo ?? `RCP-${paymentId.slice(0, 8)}`,
      receivedDate: payment.paidAt,
      amount: Number(payment.amount),
      currency: payment.currency ?? 'AED',
      paymentType: 'MONTHLY', // closest match for RAC; receipt template handles fallback
      paymentMethod: pmMap[payment.paymentMethod ?? 'CASH'] ?? 'CASH',
      chequeNo: payment.paymentMethod === 'CHEQUE' ? payment.referenceNo : null,
      bankRef: ['BANK', 'ONLINE'].includes(payment.paymentMethod ?? '') ? payment.referenceNo : null,
      receivedBy: payment.receivedBy,
      vendor: VENDOR,
      lessee: customer ? {
        name: customer.companyName ?? customer.fullName,
        type: customer.customerType === 'CORPORATE' ? 'corporate' : 'individual',
        tradeLicense: customer.tradeLicense,
        emiratesId: null,
        email: customer.email,
        phone: customer.phone,
      } : { name: '—', type: 'individual' },
      contractRef: agreement?.agreementNo ?? payment.invoice.invoiceNo,
      notes: payment.notes,
    };

    const buffer = await renderPdf(createElement(ReceiptPdf, { data, lang }));
    return pdfResponse(buffer, `${data.receiptNumber}_${lang}.pdf`, download);
  } catch (err) {
    captureException(err, { context: 'rental.payment.pdf', tags: { paymentId, lang } });
    console.error('[rental payment pdf] error:', err);
    return jsonErr('Failed to generate receipt PDF', 500);
  }
}

function jsonErr(error: string, status: number) {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });
}
function pdfResponse(buffer: Buffer, filename: string, download: boolean) {
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(buffer.length),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'private, no-cache',
    },
  });
}
