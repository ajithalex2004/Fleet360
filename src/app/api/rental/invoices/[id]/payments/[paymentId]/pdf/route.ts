export const dynamic = 'force-dynamic';

/**
 * GET /api/rental/invoices/[id]/payments/[paymentId]/pdf?lang=en|ar
 *
 * Receipt PDF for a single rental payment. Queries DB rows inside `withTenantRls`
 * and closes the transaction BEFORE running CPU-heavy `renderPdf`.
 */

import { createElement } from 'react';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { renderPdf } from '@/lib/pdf/render';
import { ReceiptPdf, type ReceiptPdfData } from '@/lib/pdf/templates/receipt';
import type { Lang } from '@/lib/pdf/theme';
import { captureException } from '@/lib/sentry';
import { withSavepoint } from '@/lib/rental/locks';
import { sanitizeDownloadFilename } from '@/lib/rental/security-guards';

export const runtime = 'nodejs';

const VENDOR = {
  name: 'Fleet360 — Rent-A-Car',
  tagline: 'UAE Smart Transport Management',
  address: 'Dubai, United Arab Emirates',
  email: 'finance@fleet360.app',
  trn: '',
};

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function parseSettingsJson(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function resolveTenantVendor(tx: TxClient, tenantId: string) {
  const tenantRecord =
    typeof tx.tenant?.findUnique === 'function'
      ? await withSavepoint(
          tx,
          'rcpt_pdf_tenant_prisma',
          () =>
            tx.tenant.findUnique({
              where: { id: tenantId },
              select: {
                name: true,
                address: true,
                contactEmail: true,
                contactPhone: true,
                trn: true,
              },
            }),
          null,
        )
      : null;

  const rawRows = await withSavepoint<Array<Record<string, unknown>>>(
    tx,
    'rcpt_pdf_tenant_raw',
    () =>
      tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        'SELECT * FROM tenants WHERE id = $1 LIMIT 1',
        tenantId,
      ),
    [],
  );
  const rawTenant = rawRows[0] ?? null;
  const settings = parseSettingsJson(rawTenant?.settings);

  const phone = pickStr(
    tenantRecord?.contactPhone,
    rawTenant?.contact_phone,
    rawTenant?.phone,
    settings?.phone,
  );

  return {
    name: pickStr(tenantRecord?.name, rawTenant?.name, VENDOR.name),
    tagline: VENDOR.tagline,
    address: pickStr(tenantRecord?.address, rawTenant?.address, settings?.address, VENDOR.address),
    email: pickStr(
      tenantRecord?.contactEmail,
      rawTenant?.contact_email,
      rawTenant?.email,
      settings?.email,
      VENDOR.email,
    ),
    ...(phone ? { phone } : {}),
    trn: pickStr(
      tenantRecord?.trn,
      rawTenant?.trn,
      rawTenant?.tax_registration_number,
      rawTenant?.vat_number,
      settings?.trn,
      settings?.taxRegistrationNumber,
      settings?.vatNumber,
      process.env.DEFAULT_SUPPLIER_TRN ?? '',
    ),
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> },
) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const { id: invoiceId, paymentId } = await params;
  const lang: Lang = req.nextUrl.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
  const download = req.nextUrl.searchParams.get('download') === '1';

  try {
    // Phase 1: Query DB inside `withTenantRls`, then release DB connection before rendering PDF
    const data = await withTenantRls<ReceiptPdfData | null>(prisma, tenantId, async (tx) => {
      const payment = await tx.rentalInvoicePayment.findFirst({
        where: { id: paymentId, invoiceId, tenantId },
        include: { invoice: true },
      });
      if (
        !payment ||
        !payment.invoice ||
        payment.invoice.tenantId !== tenantId ||
        payment.invoice.deletedAt !== null
      ) {
        return null;
      }

      const vendor = await resolveTenantVendor(tx, tenantId);
      const customer = payment.invoice.customerId
        ? await tx.rentalCustomer.findFirst({
            where: { id: payment.invoice.customerId, tenantId },
          })
        : null;
      const agreement = payment.invoice.agreementId
        ? await tx.rentalAgreement.findFirst({
            where: { id: payment.invoice.agreementId, tenantId },
          })
        : null;

      const pmMap: Record<string, string> = {
        CASH: 'CASH',
        CARD: 'CARD',
        PREAUTH_CAPTURE: 'CARD',
        BANK: 'BANK_TRANSFER',
        BANK_TRANSFER: 'BANK_TRANSFER',
        CHEQUE: 'CHEQUE',
        PDC: 'CHEQUE',
        ONLINE: 'CARD',
        DEPOSIT_DEDUCTION: 'CARD',
      };
      const rawMethod = String(payment.paymentMethod ?? 'CASH').toUpperCase();

      return {
        receiptNumber: payment.receiptNo ?? `RCP-${paymentId.slice(0, 8)}`,
        receivedDate: payment.paidAt,
        amount: Number(payment.amount),
        currency: payment.currency ?? 'AED',
        paymentType: rawMethod === 'DEPOSIT_DEDUCTION' ? 'SECURITY' : 'MONTHLY',
        paymentMethod: pmMap[rawMethod] ?? 'CASH',
        chequeNo: rawMethod === 'CHEQUE' || rawMethod === 'PDC' ? payment.referenceNo : null,
        bankRef: ['BANK', 'BANK_TRANSFER', 'ONLINE'].includes(rawMethod)
          ? payment.referenceNo
          : null,
        receivedBy: payment.receivedBy,
        vendor,
        lessee: customer
          ? {
              name: customer.companyName ?? customer.fullName,
              type: customer.customerType === 'CORPORATE' ? 'corporate' : 'individual',
              tradeLicense: customer.tradeLicense,
              emiratesId: null,
              email: customer.email,
              phone: customer.phone,
            }
          : { name: '—', type: 'individual' },
        contractRef: agreement?.agreementNo ?? payment.invoice.invoiceNo,
        notes: payment.notes,
      };
    });

    if (!data) {
      return jsonErr('Receipt not found', 404);
    }

    // Phase 2: Render PDF OUTSIDE `withTenantRls`
    const buffer = await renderPdf(createElement(ReceiptPdf, { data, lang }));
    const safeFilename = sanitizeDownloadFilename(
      `${data.receiptNumber}_${lang}.pdf`,
      `receipt_${lang}.pdf`,
    );
    return pdfResponse(buffer, safeFilename, download);
  } catch (err) {
    captureException(err, { context: 'rental.payment.pdf', tags: { paymentId, lang } });
    console.error('[rental payment pdf] error:', err);
    return jsonErr('Failed to generate receipt PDF', 500);
  }
}

function jsonErr(error: string, status: number) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pdfResponse(buffer: Buffer, filename: string, download: boolean) {
  const safe = sanitizeDownloadFilename(filename, 'receipt.pdf');
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(buffer.length),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${safe}"`,
      'Cache-Control': 'private, no-cache',
    },
  });
}
