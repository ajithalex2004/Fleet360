import { randomInt } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { generateSelfBilledTaxInvoice } from '@/lib/finance/self-billing';
import { assertPeriodOpen } from '@/lib/finance/journal-service';

export const dynamic = 'force-dynamic';

type PayableRow = Record<string, unknown>;

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; meta?: { code?: unknown }; message?: unknown } | null;
  const code = e?.meta?.code ?? e?.code;
  const msg = String(e?.message ?? err ?? '');
  return code === '23505' || code === 'P2002' || /\b23505\b|duplicate key/i.test(msg);
}

function fmtDate(d: unknown, fallback: string): string {
  if (!d) return fallback;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function mapPayableToSelfBill(r: PayableRow) {
  const lineItems = Array.isArray(r.line_items) ? r.line_items : [];
  const issueDate = fmtDate(r.issue_date, new Date().toISOString().slice(0, 10));
  const dueDate = fmtDate(r.due_date, issueDate);
  const firstItem = (lineItems[0] && typeof lineItems[0] === 'object' ? lineItems[0] : {}) as Record<string, unknown>;
  const periodStart = String(firstItem.billingPeriodStart ?? firstItem.serviceDate ?? issueDate);
  const periodEnd = String(firstItem.billingPeriodEnd ?? issueDate);
  const subTotal = Number(r.subtotal ?? 0);
  const vatTotal = Number(r.vat_amount ?? 0);
  const totalAmount = Number(r.total_amount ?? subTotal + vatTotal);

  return {
    id: String(r.id),
    invoiceNo: String(r.payable_number ?? `SB-${String(r.id).slice(0, 8)}`),
    selfBillNumber: String(r.payable_number ?? `SB-${String(r.id).slice(0, 8)}`),
    carrierId: String(r.vendor_id ?? 'CARRIER-001'),
    carrierName: String(r.vendor_name ?? 'Carrier'),
    carrierTrn: String(r.vendor_trn ?? firstItem.carrierTrn ?? ''),
    billingPeriodStart: periodStart,
    billingPeriodEnd: periodEnd,
    issueDate,
    dueDate,
    currency: String(r.currency ?? 'AED'),
    subTotal,
    subtotalNet: subTotal,
    vatTotal,
    totalAmount,
    grandTotalGross: totalAmount,
    status: String(r.status ?? 'ISSUED'),
    tripsCount: lineItems.length || 1,
    items: lineItems,
  };
}

/**
 * POST /api/finance/self-billing
 * Generates an Article 59(9) Self-Billed Tax Invoice for a transporter / owner-driver
 * and persists it into finance_payables.
 */
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const rawBody = await req.json();
    const body = stripTenantOwnershipFields(rawBody);

    const supplierName = String(
      body.carrierName ?? body.supplier?.supplierName ?? ''
    ).trim();
    const supplierTrn = String(
      body.carrierTrn ?? body.supplier?.supplierTrn ?? ''
    ).trim();
    const hasItems = Array.isArray(body.items) && body.items.length > 0;
    const hasTrips = Array.isArray(body.trips) && body.trips.length > 0;

    const missing: string[] = [];
    if (!supplierName) missing.push('carrierName is required');
    if (!supplierTrn) missing.push('valid 15-digit carrierTrn is required');
    if (!hasItems && !hasTrips) missing.push('at least one line item or trip must be specified');

    if (missing.length > 0) {
      return NextResponse.json({
        ok: false,
        error: 'Unprocessable Entity',
        message: 'Missing required self-billing fields',
        details: missing,
        missingFields: missing,
      }, { status: 422 });
    }

    const carrierId = String(body.carrierId ?? body.vendorId ?? 'CARRIER-001');
    const today = new Date().toISOString().slice(0, 10);
    const billingPeriodStart = String(body.billingPeriodStart ?? today);
    const billingPeriodEnd = String(body.billingPeriodEnd ?? today);

    const supplier = body.supplier || {
      supplierName,
      supplierTrn,
      address: body.address ?? 'Industrial Area 13',
      city: body.city ?? 'Sharjah',
      emirate: body.emirate ?? 'Sharjah',
      contactPhone: body.contactPhone ?? '+971 50 123 4567',
    };

    const rawItems = hasItems
      ? body.items
      : body.trips.map((t: Record<string, unknown>, idx: number) => ({
          tripId: String(t.tripId ?? t.id ?? `TRIP-${idx + 1}`),
          tripNumber: String(t.tripNumber ?? t.tripNo ?? `TRIP-2026-${8810 + idx}`),
          description: String(t.description ?? `Carrier Freight Trip #${idx + 1}`),
          serviceDate: String(t.serviceDate ?? t.date ?? billingPeriodEnd),
          quantity: Number(t.quantity ?? 1),
          ratePerUnit: Number(t.ratePerUnit ?? t.amount ?? 500),
          vatRatePct: Number(t.vatRatePct ?? 5),
        }));

    const selfBillNumber =
      body.selfBillNumber ??
      body.invoiceNo ??
      `SB-${new Date().getFullYear()}-${randomInt(10000, 100000)}`;

    const invoice = generateSelfBilledTaxInvoice({
      selfBillNumber,
      supplier,
      items: rawItems,
      settlementPeriod: body.settlementPeriod,
      beneficiaryIban: body.beneficiaryIban || 'AE290330000000012345678',
      paymentDueDate: body.paymentDueDate ?? body.dueDate,
    });

    const enrichedLineItems = invoice.items.map((it) => ({
      ...it,
      carrierTrn: supplierTrn,
      billingPeriodStart,
      billingPeriodEnd,
    }));

    return await withTenantRls(prisma, tenantId, async (tx) => {
      try {
        await assertPeriodOpen(tx, tenantId, invoice.issueDate);
      } catch (periodErr: unknown) {
        const statusCode = (periodErr as { statusCode?: number })?.statusCode;
        if (statusCode === 422) {
          return NextResponse.json(
            { error: (periodErr as Error).message },
            { status: 422 },
          );
        }
        throw periodErr;
      }

      const [inserted] = await tx.$queryRawUnsafe<PayableRow[]>(
        `INSERT INTO finance_payables
           (payable_number, vendor_id, vendor_name, vendor_email,
            module, source_type, source_id, description, line_items,
            subtotal, vat_amount, total_amount, currency,
            issue_date, due_date, status, payment_status,
            prepared_by, notes, tenant_id)
         VALUES ($1,$2,$3,$4,'LOGISTICS','SELF_BILLING',$5,$6,$7::jsonb,$8::numeric,$9::numeric,$10::numeric,'AED',$11::date,$12::date,'APPROVED','UNPAID',$13,$14,$15)
         RETURNING *`,
        invoice.selfBillNumber,
        carrierId,
        supplierName,
        supplier.contactEmail ?? null,
        carrierId,
        `Art. 59(9) Self-Billed Tax Invoice (${billingPeriodStart} to ${billingPeriodEnd})`,
        JSON.stringify(enrichedLineItems),
        invoice.subtotalNet,
        invoice.vatTotal,
        invoice.grandTotalGross,
        invoice.issueDate,
        invoice.paymentDueDate,
        req.headers.get('x-user-id') ?? 'system',
        invoice.statutoryDeclaration,
        tenantId,
      );

      if (!inserted) {
        throw new Error('Failed to persist self-billed payable');
      }

      const selfBilledInvoice = {
        ...mapPayableToSelfBill(inserted),
        statutoryDeclaration: invoice.statutoryDeclaration,
      };

      return NextResponse.json({
        success: true,
        message: 'UAE FTA Art. 59(9) Self-Billed Tax Invoice generated and recorded in AP.',
        data: selfBilledInvoice,
        selfBilledTaxInvoice: invoice,
        complianceStandard: 'UAE_VAT_EXECUTIVE_REG_ART_59_9',
      }, { status: 201 });
    });
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { error: 'Self-billed invoice number already exists for this tenant' },
        { status: 409 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error in self-billing generation API:', err);
    return NextResponse.json({ error: 'Failed to generate self-billed invoice', details: msg }, { status: 500 });
  }
}

/**
 * GET /api/finance/self-billing
 * Lists self-billed carrier invoices from finance_payables
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const sp = req.nextUrl.searchParams;
  const requestedTenantId = sp.get('tenantId');
  if (requestedTenantId && requestedTenantId !== tenantId) {
    return NextResponse.json({
      ok: false,
      error: 'Tenant self-billing agreement not found',
      message: 'No self-billing configuration or records found for tenant',
      missingFields: ['carrier_self_billing_agreement', 'records'],
    }, { status: 422 });
  }

  try {
    return await withTenantRls(prisma, tenantId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<PayableRow[]>(
        `SELECT *
           FROM finance_payables
          WHERE tenant_id = $1
            AND deleted_at IS NULL
            AND (source_type = 'SELF_BILLING' OR module = 'LOGISTICS')
          ORDER BY created_at DESC
          LIMIT 50`,
        tenantId,
      );

      if (rows.length === 0) {
        return NextResponse.json({
          ok: false,
          error: 'No self-billing configuration or records found for tenant',
          message: 'No self-billing payables found for tenant',
          missingFields: ['records'],
        }, { status: 422 });
      }

      const invoices = rows.map(mapPayableToSelfBill);

      return NextResponse.json({
        success: true,
        totalRecords: invoices.length,
        data: invoices,
        invoices,
      });
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error in self-billing GET API:', err);
    return NextResponse.json({ error: 'Failed to fetch self-billed invoices', details: msg }, { status: 500 });
  }
}
