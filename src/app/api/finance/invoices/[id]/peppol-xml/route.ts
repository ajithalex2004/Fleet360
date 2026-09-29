import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import {
  generatePeppolUaeInvoiceXml,
  isValidUaeTrn,
  PeppolInvoiceData,
  PeppolInvoiceLine,
  PeppolParty,
} from '@/lib/finance/peppol-e-invoice';
import { buildPeppolWorkbook } from '@/lib/finance/peppol-xlsx';
import { emirateOf, normalizeTrn } from '@/lib/finance/uae';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finance/invoices/:id/peppol-xml[?format=xml|xlsx|json]
 *
 * Renders a UAE Peppol PINT-UAE e-invoice for one of the tenant's invoices
 * (finance_invoices first, then lease invoices). The seller is the tenant
 * itself, so the tenant's TRN must be set. The id SAMPLE_INVOICE_ID returns
 * a clearly labelled sample; any other unknown id is a 404 — it used to fall
 * back to made-up data, so a real invoice's download could show someone
 * else's figures.
 */

const SAMPLE_INVOICE_ID = 'INV-DEMO-001';

const DEFAULT_NOTE = 'UAE Tax Invoice pursuant to Federal Decree-Law No. 8 of 2017 & Peppol PINT-UAE specifications.';

function isoDate(v: unknown): string | undefined {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

// Addresses are free text; pick the emirate out of it when one is named.
function address(street: unknown): PeppolParty['address'] {
  const s = String(street || '').trim();
  const emirate = emirateOf(s);
  return { street: s || '—', city: emirate ?? 'Dubai', state: emirate, countryCode: 'AE' };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function line(id: number, name: string, qty: number, unitPrice: number, vatPct: number, description?: string): PeppolInvoiceLine {
  const net = round2(qty * unitPrice);
  return {
    id,
    name,
    description,
    quantity: qty,
    unitPrice,
    netAmount: net,
    vatRatePercent: vatPct,
    vatAmount: round2(net * vatPct / 100),
    taxCategoryCode: vatPct > 0 ? 'S' : 'Z',
  };
}

function sampleInvoice(): PeppolInvoiceData {
  return {
    invoiceNumber: SAMPLE_INVOICE_ID,
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    currency: 'AED',
    seller: {
      name: 'Sample Seller Transport LLC',
      trn: '100456789012345',
      crn: 'CN-1029384',
      address: { street: 'Sheikh Zayed Road, Al Quoz 1', city: 'Dubai', state: 'Dubai', countryCode: 'AE' },
      contact: { name: 'Finance Department', email: 'billing@example.ae' },
    },
    buyer: {
      name: 'Sample Buyer Logistics LLC',
      trn: '100234567890003',
      address: { street: 'Khalifa Industrial Zone Abu Dhabi (KIZAD)', city: 'Abu Dhabi', state: 'Abu Dhabi', countryCode: 'AE' },
    },
    lines: [line(1, 'Heavy Commercial Transport Services', 5, 1200, 5, 'Route DXB-AUH Industrial Haulage')],
    notes: 'SAMPLE — illustrative data only, not a tax invoice. FTA Electronic Tax Invoice layout per UAE Peppol PINT mandate.',
  };
}

async function tenantSeller(tx: TxClient, tenantId: string): Promise<PeppolParty | null> {
  const t = await tx.tenant.findUnique({ where: { id: tenantId } }).catch(() => null);
  if (!t) return null;
  return {
    name: t.name,
    trn: normalizeTrn(t.trn),
    address: address(t.address),
    contact: {
      name: t.contactName || undefined,
      email: t.contactEmail || undefined,
      phone: t.contactPhone || undefined,
    },
  };
}

type FinanceInvoiceRow = Record<string, unknown>;

async function loadInvoice(tx: TxClient, tenantId: string, id: string): Promise<Omit<PeppolInvoiceData, 'seller'> | null> {
  // 1. Finance module invoices, by id or invoice number.
  const [fi] = await tx.$queryRawUnsafe<FinanceInvoiceRow[]>(
    `SELECT * FROM finance_invoices
      WHERE tenant_id = $1 AND deleted_at IS NULL AND (id::text = $2 OR invoice_number = $2)
      LIMIT 1`,
    tenantId, id,
  );
  if (fi) {
    const vatPct = Number(fi.vat_rate ?? 5);
    const items = Array.isArray(fi.line_items) ? fi.line_items as Array<Record<string, unknown>> : [];
    const lines = items.map((it, i) =>
      line(i + 1, String(it.description || fi.description || 'Services'), Number(it.qty ?? it.quantity ?? 1), Number(it.unitPrice ?? it.unit_price ?? 0), vatPct),
    );
    if (lines.length === 0) {
      lines.push(line(1, String(fi.description || fi.service_type || 'Services'), 1, Number(fi.subtotal ?? 0), vatPct));
    }
    const discount = Number(fi.discount_amount ?? 0);
    if (discount > 0) lines.push(line(lines.length + 1, 'Discount', 1, -discount, vatPct));
    return {
      invoiceNumber: String(fi.invoice_number),
      issueDate: isoDate(fi.issue_date) ?? new Date().toISOString().slice(0, 10),
      dueDate: isoDate(fi.due_date),
      currency: String(fi.currency || 'AED'),
      buyer: {
        name: String(fi.client_name || ''),
        trn: fi.customer_trn ? String(fi.customer_trn) : '',
        address: address(fi.client_address),
        contact: {
          email: fi.client_email ? String(fi.client_email) : undefined,
          phone: fi.client_phone ? String(fi.client_phone) : undefined,
        },
      },
      lines,
      notes: fi.notes ? String(fi.notes) : DEFAULT_NOTE,
    };
  }

  // 2. Leasing invoices (ids are uuids; anything else cannot match).
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const inv = await tx.leaseInvoice.findFirst({
    where: { id, tenantId },
    include: { lessee: true, lines: true },
  });
  if (!inv) return null;
  const vatPct = Number(inv.vatPct ?? 5);
  const lines = inv.lines.length > 0
    ? inv.lines.map((l, i) => line(i + 1, l.description || 'Fleet leasing services', Number(l.quantity ?? 1), Number(l.unitAmount), vatPct))
    : [line(1, 'Fleet Leasing & Mobility Services', 1, Number(inv.subTotal ?? 0), vatPct, `Billing period: ${inv.billingPeriod || '—'}`)];
  return {
    invoiceNumber: inv.invoiceNo || `INV-${inv.id.substring(0, 8).toUpperCase()}`,
    issueDate: isoDate(inv.issueDate) ?? new Date().toISOString().slice(0, 10),
    dueDate: isoDate(inv.dueDate),
    currency: inv.currency || 'AED',
    buyer: {
      name: inv.lessee?.name || '',
      trn: '',
      crn: inv.lessee?.tradeLicense || undefined,
      address: address(inv.lessee?.address),
      contact: {
        name: inv.lessee?.contactPerson || undefined,
        email: inv.lessee?.email || undefined,
        phone: inv.lessee?.phone || undefined,
      },
    },
    lines,
    notes: inv.notes || DEFAULT_NOTE,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authz = requireAuthorizedTenant(req);
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;
    const { id } = await params;
    const isSample = id === SAMPLE_INVOICE_ID;

    let invoiceData: PeppolInvoiceData;
    if (isSample) {
      invoiceData = sampleInvoice();
    } else {
      const loaded = await withTenantRls(prisma, tenantId, async (tx) => {
        const invoice = await loadInvoice(tx, tenantId, id);
        return invoice ? { invoice, seller: await tenantSeller(tx, tenantId) } : null;
      });
      if (!loaded) {
        return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
      }
      if (!loaded.seller || !isValidUaeTrn(loaded.seller.trn)) {
        return NextResponse.json({
          error: 'Your company TRN is missing or invalid. An administrator can set the 15-digit UAE TRN (starting with 100) under Admin → Company profile before issuing Peppol e-invoices.',
          fixUrl: '/admin/company-profile',
        }, { status: 422 });
      }
      invoiceData = { ...loaded.invoice, seller: loaded.seller };
    }

    const result = generatePeppolUaeInvoiceXml(invoiceData);
    if (!result.isValid || !result.xml) {
      return NextResponse.json({ error: 'Failed to generate valid Peppol XML', details: result.errors }, { status: 422 });
    }

    const format = req.nextUrl.searchParams.get('format');
    const safeName = invoiceData.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, '_');

    if (format === 'json') {
      return NextResponse.json({
        invoiceNumber: invoiceData.invoiceNumber,
        sample: isSample,
        digestHash: result.digestHash,
        warnings: result.warnings,
        xml: result.xml,
      });
    }

    if (format === 'xlsx') {
      const buf = buildPeppolWorkbook(invoiceData, result, { sample: isSample });
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${safeName}-peppol.xlsx"`,
          'X-Invoice-Digest-SHA256': result.digestHash || '',
        },
      });
    }

    return new NextResponse(result.xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeName}-peppol.xml"`,
        'X-Invoice-Digest-SHA256': result.digestHash || '',
      },
    });
  } catch (error: unknown) {
    console.error('Error generating Peppol e-invoice:', error);
    return NextResponse.json({ error: 'Internal server error generating Peppol e-invoice' }, { status: 500 });
  }
}
