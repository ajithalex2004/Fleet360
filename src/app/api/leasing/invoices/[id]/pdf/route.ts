import { createElement } from 'react';
import { NextRequest, NextResponse } from 'next/server';
import { renderPdf } from '@/lib/pdf/render';
import { InvoicePdf, type InvoicePdfData } from '@/lib/pdf/templates/invoice';
import type { Lang } from '@/lib/pdf/theme';
import { captureException } from '@/lib/sentry';
import { requireOperationalContext } from '@/lib/cross-module-governance';
import { leaseInvoiceInTenant } from '@/lib/leasing-billing-reconciliation';

export const runtime = 'nodejs';

const VENDOR = {
  name: 'Fleet360',
  tagline: 'UAE Smart Transport Management',
  address: 'Dubai, United Arab Emirates',
  phone: '',
  email: 'finance@fleet360.app',
  trn: '',
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang: Lang = req.nextUrl.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
  const download = req.nextUrl.searchParams.get('download') === '1';

  try {
    const ctx = requireOperationalContext(req, 'leasing');
    if (ctx instanceof NextResponse) return ctx;
    const scoped = await leaseInvoiceInTenant(id, ctx);
    if (scoped.error) return scoped.error;
    const inv = scoped.invoice;

    const data: InvoicePdfData = {
      invoiceNo: inv.invoiceNo ?? `INV-${id.slice(0, 8)}`,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      billingPeriod: inv.billingPeriod,
      vendor: VENDOR,
      lessee: {
        name: inv.lessee?.name ?? '—',
        type: inv.lessee?.type === 'corporate' ? 'corporate' : 'individual',
        address: inv.lessee?.address ?? null,
        email: inv.lessee?.email ?? null,
        phone: inv.lessee?.phone ?? null,
        tradeLicense: inv.lessee?.tradeLicense ?? null,
        emiratesId: inv.lessee?.emiratesId ?? null,
        trn: null,
      },
      contractRef: null,
      lines: (inv.lines ?? []).map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitAmount: Number(l.unitAmount ?? 0),
        totalAmount: Number(l.totalAmount ?? 0),
        lineType: l.lineType,
      })),
      subTotal: Number(inv.subTotal ?? 0),
      vatPct: inv.vatPct ? Number(inv.vatPct) : 5,
      vatAmount: Number(inv.vatAmount ?? 0),
      totalAmount: Number(inv.totalAmount ?? 0),
      currency: inv.currency ?? 'AED',
      notes: inv.notes,
    };

    const buffer = await renderPdf(createElement(InvoicePdf, { data, lang }));
    return pdfResponse(buffer, `${data.invoiceNo}_${lang}.pdf`, download);
  } catch (err) {
    captureException(err, { context: 'leasing.invoice.pdf', tags: { invoiceId: id, lang } });
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
