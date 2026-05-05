/**
 * GET /api/rental/invoices/[id]/pdf?lang=en|ar
 *
 * Reuses the leasing InvoicePdf template — adapts RentalInvoice data
 * to its shape. The leasing template is already FTA-compliant and bilingual.
 */

import { createElement } from 'react';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { renderPdf } from '@/lib/pdf/render';
import { InvoicePdf, type InvoicePdfData } from '@/lib/pdf/templates/invoice';
import type { Lang } from '@/lib/pdf/theme';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const VENDOR = {
  name: 'XL AI Smart Mobility — Rent-A-Car',
  tagline: 'UAE Smart Transport Management',
  address: 'Dubai, United Arab Emirates',
  email: 'finance@xl-mobility.ai',
  trn: '',
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang: Lang = req.nextUrl.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
  const download = req.nextUrl.searchParams.get('download') === '1';

  try {
    const inv = await prisma.rentalInvoice.findUnique({
      where: { id },
      include: { lineItems: true, agreement: true },
    });
    if (!inv) return jsonErr('Rental invoice not found', 404);

    const customer = await prisma.rentalCustomer.findUnique({ where: { id: inv.customerId } });

    const data: InvoicePdfData = {
      invoiceNo: inv.invoiceNo ?? `INV-${id.slice(0, 8)}`,
      issueDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      billingPeriod: inv.periodFrom && inv.periodTo
        ? `${inv.periodFrom.toISOString().slice(0, 10)} → ${inv.periodTo.toISOString().slice(0, 10)}`
        : null,
      vendor: VENDOR,
      lessee: customer ? {
        name: customer.companyName ?? customer.fullName,
        type: customer.customerType === 'CORPORATE' ? 'corporate' : 'individual',
        address: customer.address,
        email: customer.email,
        phone: customer.phone,
        tradeLicense: customer.tradeLicense,
        emiratesId: null,
        trn: customer.vatNumber,
      } : { name: '—', type: 'individual' },
      contractRef: inv.agreement?.agreementNo ?? null,
      lines: (inv.lineItems ?? []).map((l: any) => ({
        description: l.description,
        quantity: l.quantity ? Number(l.quantity) : null,
        unitAmount: Number(l.unitPrice ?? 0),
        totalAmount: Number(l.amount ?? 0),
        lineType: l.lineType,
      })),
      subTotal: Number(inv.subtotal ?? 0),
      vatPct: inv.taxRate ? Number(inv.taxRate) : 5,
      vatAmount: Number(inv.taxAmount ?? 0),
      totalAmount: Number(inv.totalAmount ?? 0),
      currency: inv.currency ?? 'AED',
      notes: null,
    };

    const buffer = await renderPdf(createElement(InvoicePdf, { data, lang }));
    return pdfResponse(buffer, `${data.invoiceNo}_${lang}.pdf`, download);
  } catch (err) {
    captureException(err, { context: 'rental.invoice.pdf', tags: { invoiceId: id, lang } });
    console.error('[rental invoice pdf] error:', err);
    return jsonErr('Failed to generate invoice PDF', 500);
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
