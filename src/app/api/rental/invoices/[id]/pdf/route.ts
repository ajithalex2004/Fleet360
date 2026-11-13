export const dynamic = 'force-dynamic';

/**
 * GET /api/rental/invoices/[id]/pdf?lang=en|ar
 *
 * Loads tenant-scoped RentalInvoice data inside `withTenantRls`, then closes the DB
 * transaction BEFORE generating the UAE FTA TLV QR PNG (`generateFtaTlvQrBase64` +
 * `qrcode`) and rendering the React-PDF stream (`renderPdf`), preventing pool exhaustion.
 * Supports both Tax Invoices (`STANDARD`) and Tax Credit Notes (`CREDIT_NOTE` / Art. 61).
 */

import { createElement } from 'react';
import * as QRCodeNs from 'qrcode';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { generateFtaTlvQrBase64 } from '@/lib/finance/fta-qr';
import { renderPdf } from '@/lib/pdf/render';
import { InvoicePdf, type InvoicePdfData } from '@/lib/pdf/templates/invoice';
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

async function renderQrDataUrl(payload: string): Promise<string | null> {
  try {
    const qrMod = QRCodeNs as unknown as {
      toDataURL?: (text: string, opts?: Record<string, unknown>) => Promise<string>;
      default?: { toDataURL?: (text: string, opts?: Record<string, unknown>) => Promise<string> };
    };
    const fn = qrMod.toDataURL ?? qrMod.default?.toDataURL;
    if (typeof fn !== 'function') return null;
    return await fn(payload, { errorCorrectionLevel: 'M', margin: 1, width: 140 });
  } catch {
    return null;
  }
}

async function resolveTenantVendor(tx: TxClient, tenantId: string) {
  const tenantRecord =
    typeof tx.tenant?.findUnique === 'function'
      ? await withSavepoint(
          tx,
          'inv_pdf_tenant_prisma',
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
    'inv_pdf_tenant_raw',
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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const { id } = await params;
  const lang: Lang = req.nextUrl.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
  const download = req.nextUrl.searchParams.get('download') === '1';

  try {
    // Phase 1: Query DB strictly inside `withTenantRls` and close transaction before CPU-heavy PDF/QR rendering
    const loaded = await withTenantRls(prisma, tenantId, async (tx) => {
      const inv = await tx.rentalInvoice.findFirst({
        where: { id, tenantId, deletedAt: null },
        include: {
          lineItems: { where: { tenantId }, orderBy: { sortOrder: 'asc' } },
        },
      });
      if (!inv) {
        return null;
      }

      const vendor = await resolveTenantVendor(tx, tenantId);
      const customer = inv.customerId
        ? await tx.rentalCustomer.findFirst({ where: { id: inv.customerId, tenantId } })
        : null;
      const agreement = inv.agreementId
        ? await tx.rentalAgreement.findFirst({ where: { id: inv.agreementId, tenantId } })
        : null;

      // Fallback to core `customers.tax_registration_number` if `rental_customers.vat_number` is empty
      let customerTrn = customer?.vatNumber ?? null;
      if (!customerTrn && customer) {
        const coreCustRows = await withSavepoint<Array<{ trn: string | null }>>(
          tx,
          'inv_pdf_core_cust_trn',
          () =>
            tx.$queryRawUnsafe<Array<{ trn: string | null }>>(
              `SELECT tax_registration_number AS trn
                 FROM customers
                WHERE tenant_id::text = $1
                  AND tax_registration_number IS NOT NULL
                  AND tax_registration_number <> ''
                  AND (
                    id::text = $2
                    OR ($3 <> '' AND LOWER(email) = LOWER($3))
                    OR ($4 <> '' AND LOWER(company_name) = LOWER($4))
                  )
                LIMIT 1`,
              tenantId,
              customer.id,
              customer.email ?? '',
              customer.companyName ?? customer.fullName ?? '',
            ),
          [],
        );
        customerTrn = coreCustRows[0]?.trn ?? null;
      }

      let parentInvoiceNo: string | null = null;
      const rawParentId = (inv as unknown as { parentInvoiceId?: string | null }).parentInvoiceId;
      if (rawParentId) {
        const pRows = await withSavepoint<Array<{ invoice_no: string | null }>>(
          tx,
          'inv_pdf_parent_no',
          () =>
            tx.$queryRawUnsafe<Array<{ invoice_no: string | null }>>(
              'SELECT invoice_no FROM rental_invoices WHERE id = $1 AND tenant_id::text = $2 LIMIT 1',
              rawParentId,
              tenantId,
            ),
          [],
        );
        parentInvoiceNo = pRows[0]?.invoice_no ?? null;
      } else if (String(inv.invoiceType ?? '').toUpperCase() === 'CREDIT_NOTE') {
        const pRows = await withSavepoint<
          Array<{ parent_no: string | null }>
        >(
          tx,
          'inv_pdf_parent_join',
          () =>
            tx.$queryRawUnsafe<Array<{ parent_no: string | null }>>(
              `SELECT p.invoice_no AS parent_no
                 FROM rental_invoices c
                 JOIN rental_invoices p
                   ON p.id = c.parent_invoice_id
                  AND p.tenant_id::text = c.tenant_id::text
                WHERE c.id = $1 AND c.tenant_id::text = $2
                LIMIT 1`,
              id,
              tenantId,
            ),
          [],
        );
        parentInvoiceNo = pRows[0]?.parent_no ?? null;
      }

      return { inv, vendor, customer, customerTrn, agreement, parentInvoiceNo };
    });

    if (!loaded) {
      return jsonErr('Rental invoice not found', 404);
    }

    const { inv, vendor, customer, customerTrn, agreement, parentInvoiceNo } = loaded;
    const isCreditNote = String(inv.invoiceType ?? '').toUpperCase() === 'CREDIT_NOTE';
    const vatPct = inv.taxRate ? Number(inv.taxRate) : 5;
    const rawLines = inv.lineItems ?? [];

    const pdfLines = rawLines.map((l: any) => {
      const ltUpper = String(l.lineType ?? '').toUpperCase();
      const isFine =
        ltUpper === 'FINE' || ltUpper === 'TRAFFIC_FINE' || ltUpper === 'STATUTORY_FINE';
      const taxable =
        ltUpper === 'DISCOUNT'
          ? false
          : l.taxable !== undefined && l.taxable !== null
            ? Boolean(l.taxable)
            : !isFine;
      return {
        description: l.description,
        quantity: l.quantity ? Number(l.quantity) : null,
        unitAmount: Number(l.unitPrice ?? 0),
        totalAmount: Number(l.amount ?? 0),
        lineType: l.lineType,
        taxable,
        vatRatePct: taxable ? vatPct : 0,
      };
    });

    const hasDiscountLine = pdfLines.some(
      (l) => String(l.lineType ?? '').toUpperCase() === 'DISCOUNT',
    );
    const headerDiscount = Number(inv.discountAmount ?? 0);
    const displayDiscount = hasDiscountLine ? 0 : headerDiscount;

    const nonDiscountOutOfScope = Number(
      pdfLines
        .filter(
          (l) =>
            l.taxable === false && String(l.lineType ?? '').toUpperCase() !== 'DISCOUNT',
        )
        .reduce((s, l) => s + l.totalAmount, 0)
        .toFixed(2),
    );
    const computedTaxableLines = Number(
      pdfLines
        .filter((l) => l.taxable !== false)
        .reduce((s, l) => s + l.totalAmount, 0)
        .toFixed(2),
    );

    const subTotal = Number(inv.subtotal ?? 0);
    const vatAmount = Number(inv.taxAmount ?? 0);
    const totalAmount = Number(inv.totalAmount ?? 0);
    const invRecord = inv as unknown as Record<string, unknown>;
    const rawTaxableAmount = invRecord.taxableAmount ?? invRecord.taxablAmount ?? subTotal;
    const taxableSubtotal =
      pdfLines.length > 0 ? computedTaxableLines : Number(rawTaxableAmount);

    // Phase 2: Generate FTA TLV QR Code & render PDF OUTSIDE `withTenantRls`
    const issueIso =
      inv.invoiceDate instanceof Date
        ? inv.invoiceDate.toISOString()
        : new Date(String(inv.invoiceDate)).toISOString();

    const tlvBase64 = generateFtaTlvQrBase64({
      sellerName: vendor.name,
      sellerTrn: vendor.trn,
      timestamp: issueIso,
      totalWithVat: Math.abs(totalAmount),
      vatTotal: Math.abs(vatAmount),
    });
    const ftaQrDataUrl = await renderQrDataUrl(tlvBase64);

    const data: InvoicePdfData = {
      invoiceNo: inv.invoiceNo ?? `INV-${id.slice(0, 8)}`,
      issueDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      billingPeriod:
        inv.periodFrom && inv.periodTo
          ? `${inv.periodFrom.toISOString().slice(0, 10)} → ${inv.periodTo.toISOString().slice(0, 10)}`
          : null,
      vendor,
      lessee: customer
        ? {
            name: customer.companyName ?? customer.fullName,
            type: customer.customerType === 'CORPORATE' ? 'corporate' : 'individual',
            address: customer.address,
            email: customer.email,
            phone: customer.phone,
            tradeLicense: customer.tradeLicense,
            emiratesId: null,
            trn: customerTrn,
          }
        : { name: '—', type: 'individual' },
      contractRef: agreement?.agreementNo ?? null,
      lines: pdfLines,
      subTotal,
      vatPct,
      vatAmount,
      totalAmount,
      currency: inv.currency ?? 'AED',
      notes: inv.notes ?? null,
      documentKind: isCreditNote ? 'TAX_CREDIT_NOTE' : 'TAX_INVOICE',
      parentInvoiceNo,
      ftaQrDataUrl,
      taxableSubtotal,
      exemptOrOutOfScopeSubtotal: nonDiscountOutOfScope,
      discountAmount: displayDiscount,
    };

    const buffer = await renderPdf(createElement(InvoicePdf, { data, lang }));
    const safeFilename = sanitizeDownloadFilename(
      `${data.invoiceNo}_${lang}.pdf`,
      `invoice_${lang}.pdf`,
    );
    return pdfResponse(buffer, safeFilename, download);
  } catch (err) {
    captureException(err, { context: 'rental.invoice.pdf', tags: { invoiceId: id, lang } });
    console.error('[rental invoice pdf] error:', err);
    return jsonErr('Failed to generate invoice PDF', 500);
  }
}

function jsonErr(error: string, status: number) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pdfResponse(buffer: Buffer, filename: string, download: boolean) {
  const safe = sanitizeDownloadFilename(filename, 'invoice.pdf');
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
