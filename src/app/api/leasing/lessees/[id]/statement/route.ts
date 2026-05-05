/**
 * GET /api/leasing/lessees/[id]/statement?lang=en|ar&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Customer Account Statement PDF — invoices + receipts in the requested
 * period, with running balance. Defaults to the last 90 days.
 */

import { createElement } from 'react';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { renderPdf } from '@/lib/pdf/render';
import { StatementPdf, type StatementPdfData, type StatementTransaction } from '@/lib/pdf/templates/statement';
import type { Lang } from '@/lib/pdf/theme';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const VENDOR = {
  name: 'XL AI Smart Mobility',
  tagline: 'UAE Smart Transport Management',
  address: 'Dubai, United Arab Emirates',
  email: 'finance@xl-mobility.ai',
  trn: '',
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: lesseeId } = await params;
  const lang: Lang = req.nextUrl.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
  const download = req.nextUrl.searchParams.get('download') === '1';

  const fromParam = req.nextUrl.searchParams.get('from');
  const toParam = req.nextUrl.searchParams.get('to');
  const periodTo = toParam ? new Date(toParam) : new Date();
  const periodFrom = fromParam ? new Date(fromParam) : new Date(periodTo.getTime() - 90 * 86400000);

  try {
    const lessee = await prisma.lessee.findUnique({ where: { id: lesseeId } });
    if (!lessee) return jsonErr('Lessee not found', 404);

    // Pull invoices in period.
    const invoices = await prisma.leaseInvoice.findMany({
      where: { lesseeId, issueDate: { gte: periodFrom, lte: periodTo } },
      orderBy: { issueDate: 'asc' },
    });

    // Pull receipts (via the lessee's contracts).
    const contracts = await prisma.leaseContract2.findMany({
      where: { lesseeId },
      select: { id: true },
    });
    const receipts = await prisma.leaseReceipt.findMany({
      where: {
        contractId: { in: contracts.map((c) => c.id) },
        receivedDate: { gte: periodFrom, lte: periodTo },
      },
      orderBy: { receivedDate: 'asc' },
    });

    // Compute opening balance: invoices issued before period - payments before period.
    const priorInvoices = await prisma.leaseInvoice.findMany({
      where: { lesseeId, issueDate: { lt: periodFrom } },
      select: { totalAmount: true },
    });
    const priorReceipts = await prisma.leaseReceipt.findMany({
      where: {
        contractId: { in: contracts.map((c) => c.id) },
        receivedDate: { lt: periodFrom },
      },
      select: { amount: true },
    });
    const openingBalance =
      priorInvoices.reduce((s, i) => s + Number(i.totalAmount ?? 0), 0) -
      priorReceipts.reduce((s, r) => s + Number(r.amount), 0);

    // Merge invoice + receipt events on a timeline + accumulate running balance.
    type Event = { date: Date; type: 'INVOICE' | 'PAYMENT'; ref: string; amount: number };
    const events: Event[] = [
      ...invoices.map((i) => ({
        date: i.issueDate,
        type: 'INVOICE' as const,
        ref: i.invoiceNo ?? `INV-${i.id.slice(0, 6)}`,
        amount: Number(i.totalAmount ?? 0),
      })),
      ...receipts.map((r) => ({
        date: r.receivedDate,
        type: 'PAYMENT' as const,
        ref: r.receiptNumber ?? `RCP-${r.id.slice(0, 6)}`,
        amount: Number(r.amount),
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    let running = openingBalance;
    const transactions: StatementTransaction[] = events.map((e) => {
      if (e.type === 'INVOICE') {
        running += e.amount;
        return { date: e.date, type: 'INVOICE', reference: e.ref, debit: e.amount, runningBalance: running };
      }
      running -= e.amount;
      return { date: e.date, type: 'PAYMENT', reference: e.ref, credit: e.amount, runningBalance: running };
    });

    const data: StatementPdfData = {
      periodFrom,
      periodTo,
      vendor: VENDOR,
      lessee: {
        name: lessee.name,
        type: lessee.type === 'corporate' ? 'corporate' : 'individual',
        address: lessee.address,
        email: lessee.email,
        tradeLicense: lessee.tradeLicense,
        emiratesId: lessee.emiratesId,
      },
      openingBalance,
      closingBalance: running,
      transactions,
      currency: 'AED',
    };

    const buffer = await renderPdf(createElement(StatementPdf, { data, lang }));
    const filename = `Statement_${lessee.name.replace(/\s+/g, '_')}_${lang}.pdf`;
    return pdfResponse(buffer, filename, download);
  } catch (err) {
    captureException(err, { context: 'leasing.lessee.statement', tags: { lesseeId, lang } });
    return jsonErr('Failed to generate statement PDF', 500);
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
