/**
 * GET /api/leasing/pre-billing/[id]/pdf?lang=en|ar&download=0|1
 *
 * Bilingual pre-billing statement PDF.
 */

import { createElement } from 'react';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { renderPdf } from '@/lib/pdf/render';
import { PreBillingPdf, type PreBillingPdfData } from '@/lib/pdf/templates/pre-billing';
import type { Lang } from '@/lib/pdf/theme';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const VENDOR_DEFAULT = {
  name: 'XL AI Smart Mobility',
  tagline: 'UAE Smart Transport Management',
  address: 'Dubai, United Arab Emirates',
  phone: '',
  email: 'noreply@xl-mobility.ai',
  trn: '',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const langParam = request.nextUrl.searchParams.get('lang');
  const lang: Lang = langParam === 'ar' ? 'ar' : 'en';
  const download = request.nextUrl.searchParams.get('download') === '1';

  try {
    const stmt = await prisma.leasePreBillingStatement.findUnique({
      where: { id },
      include: { contract: true },
    });
    if (!stmt) {
      return new Response(JSON.stringify({ error: 'Statement not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const lessee = await prisma.lessee.findUnique({ where: { id: stmt.lesseeId } });
    if (!lessee) {
      return new Response(JSON.stringify({ error: 'Lessee not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Sources are not persisted — only summary totals are. The PDF still
    // shows a clean summary; itemised detail is only present at aggregate-time.
    // We surface the period via createdAt → +30 days as a fallback display.
    const periodFrom = stmt.contract?.startDate ?? stmt.createdAt ?? new Date();
    const periodTo = stmt.dueDate;

    const data: PreBillingPdfData = {
      statementNo: stmt.statementNo ?? `PBS-${id.slice(0, 8)}`,
      billingPeriod: stmt.billingPeriod,
      dueDate: stmt.dueDate,
      periodFrom,
      periodTo,
      vendor: VENDOR_DEFAULT,
      lessee: {
        name: lessee.name,
        type: lessee.type === 'corporate' ? 'corporate' : 'individual',
        address: lessee.address,
        email: lessee.email,
        phone: lessee.phone,
        tradeLicense: lessee.tradeLicense,
        emiratesId: lessee.emiratesId,
      },
      contractRef: stmt.contract?.contractNumber ?? null,
      baseRent: Number(stmt.baseRent ?? 0),
      fuelCharges: Number(stmt.fuelCharges ?? 0),
      fineCharges: Number(stmt.fineCharges ?? 0),
      maintenanceCharges: Number(stmt.maintenanceCharges ?? 0),
      overageCharges: Number(stmt.overageCharges ?? 0),
      otherCharges: Number(stmt.otherCharges ?? 0),
      vatPct: 5,
      vatAmount: Number(stmt.vatAmount ?? 0),
      totalAmount: Number(stmt.totalAmount),
      currency: stmt.currency ?? 'AED',
    };

    const buffer = await renderPdf(createElement(PreBillingPdf, { data, lang }));
    const filename = `${data.statementNo}_${lang}.pdf`;
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(buffer.length),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
        'Cache-Control': 'private, no-cache',
      },
    });
  } catch (err) {
    captureException(err, { context: 'leasing.pre-billing.pdf', tags: { statementId: id, lang } });
    console.error('[pre-billing pdf] error:', err);
    return new Response(JSON.stringify({ error: 'Failed to generate PDF' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
