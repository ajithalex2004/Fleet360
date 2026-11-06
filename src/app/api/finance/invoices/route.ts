export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { assertCanWrite } from '@/lib/access-control';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { normalizeTrn } from '@/lib/finance/uae';

/**
 * GET  /api/finance/invoices  — paginated list with filters
 * POST /api/finance/invoices  — create invoice with line items + UAE 5% VAT & Peppol PINT-AE metadata
 */

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') ?? '';
    const moduleParam = searchParams.get('module') ?? '';
    const q      = searchParams.get('q') ?? '';
    const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
    const limit  = Math.min(100, parseInt(searchParams.get('limit') ?? '25'));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['deleted_at IS NULL', 'tenant_id = $1'];
    const values: unknown[]    = [tenantId];

    if (status) {
      values.push(status);
      conditions.push(`payment_status = $${values.length}`);
    }
    if (moduleParam) {
      values.push(moduleParam);
      conditions.push(`module = $${values.length}`);
    }
    if (q) {
      values.push(`%${q}%`);
      const i = values.length;
      conditions.push(`(invoice_number ILIKE $${i} OR client_name ILIKE $${i} OR description ILIKE $${i})`);
    }

    const where = conditions.join(' AND ');

    type InvRow = Record<string, unknown>;
    const [rows, countRows] = await Promise.all([
      tx.$queryRawUnsafe<InvRow[]>(
        `SELECT id, invoice_number, client_name, client_email, client_phone, client_address,
                service_type, module, description,
                subtotal, vat_amount, total_amount, paid_amount, discount_amount,
                currency, issue_date, due_date, payment_status, notes,
                module_source, reference_id, reference_type, source_payload,
                created_at, updated_at
           FROM finance_invoices
          WHERE ${where}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}`,
        ...values
      ),
      tx.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) as count FROM finance_invoices WHERE ${where}`,
        ...values
      ),
    ]);

    const today = new Date().toISOString().split('T')[0];
    const enriched = rows.map(r => {
      const sp = (r.source_payload && typeof r.source_payload === 'object' ? r.source_payload : {}) as Record<string, unknown>;
      return {
        ...r,
        customer_trn: sp.customerTrn ?? null,
        peppol_status: sp.peppolStatus ?? 'READY',
        peppol_submission_id: sp.peppolSubmissionId ?? null,
        peppol_digest_hash: sp.peppolDigestHash ?? null,
        qr_code_base64: sp.qrCodeBase64 ?? null,
        payment_status:
          r.payment_status === 'SENT' &&
          r.due_date &&
          String(r.due_date).split('T')[0] < today
            ? 'OVERDUE'
            : r.payment_status,
        issue_date: (r.issue_date as Date)?.toISOString?.().split('T')[0] ?? r.issue_date,
        due_date:   r.due_date ? (r.due_date as Date)?.toISOString?.().split('T')[0] ?? r.due_date : null,
        created_at: (r.created_at as Date)?.toISOString?.() ?? r.created_at,
        updated_at: (r.updated_at as Date)?.toISOString?.() ?? r.updated_at,
      };
    });

    type SumRow = { payment_status: string; cnt: bigint };
    const summary = await tx.$queryRawUnsafe<SumRow[]>(
      `SELECT payment_status, COUNT(*) as cnt
         FROM finance_invoices
        WHERE deleted_at IS NULL AND tenant_id = $1
        GROUP BY payment_status`,
      tenantId
    ).catch(() => [] as SumRow[]);

    const counts: Record<string, number> = {};
    for (const s of summary) counts[s.payment_status] = Number(s.cnt);

    return NextResponse.json({
      data:  enriched,
      total: Number(countRows[0]?.count ?? 0),
      page,
      limit,
      counts,
    });
  });
}


export async function POST(req: NextRequest) {

  // Enforce TRIAL plan read-only restriction
  const guard = assertCanWrite(req, 'finance');
  if (guard) return guard;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const {
        clientName, clientEmail, clientPhone, clientAddress,
        customerTrn, customerCrn, customerEmirate,
        supplyDate, invoiceTypeCode = '380', buyerReference, orderReference, paymentMeansCode = '30',
        serviceType = 'GENERAL', module = 'GENERAL',
        description, lineItems = [], discountAmount = 0,
        vatRate = 5, currency = 'AED',
        issueDate, dueDate, notes, referenceId, referenceType, createdBy,
      } = body;

      if (!clientName) return NextResponse.json({ error: 'clientName is required' }, { status: 400 });

      const itemsList = (lineItems as Array<{
        description?: string;
        qty?: number;
        unitPrice?: number;
        taxCategoryCode?: string;
        vatRatePercent?: number;
      }>);

      // Calculate totals from line items
      const subtotal = itemsList.reduce(
        (sum, item) => sum + (Number(item.qty) || 1) * (Number(item.unitPrice) || 0),
        0,
      );
      const discounted = Math.max(0, subtotal - Number(discountAmount));

      const hasLineTaxOverrides = itemsList.some(it => it.taxCategoryCode && it.taxCategoryCode !== 'S');
      const vatAmount = hasLineTaxOverrides
        ? Math.round(
            itemsList.reduce((sum, item) => {
              const lineNet = (Number(item.qty) || 1) * (Number(item.unitPrice) || 0);
              const cat = item.taxCategoryCode || (Number(vatRate) > 0 ? 'S' : 'Z');
              const rate = item.vatRatePercent !== undefined ? Number(item.vatRatePercent) : (cat === 'S' ? Number(vatRate) : 0);
              return sum + lineNet * (rate / 100);
            }, 0) * 100
          ) / 100
        : Math.round(discounted * (Number(vatRate) / 100) * 100) / 100;

      const totalAmount = Math.round((discounted + vatAmount) * 100) / 100;

      // Generate invoice number: INV-YYYYMM-XXXX-rnd
      const prefix = `INV-${new Date().toISOString().slice(0, 7).replace('-', '')}`;
      type SeqRow = { seq: number | bigint | string | null };
      const [seqRow] = await tx.$queryRawUnsafe<SeqRow[]>(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM '^INV-[0-9]{4,6}-([0-9]+)') AS INTEGER)), 0) as seq
           FROM finance_invoices
          WHERE tenant_id = $1 AND invoice_number ~ $2`,
        tenantId,
        `^${prefix}-[0-9]+`,
      ).catch(() => [{ seq: 0 }]);
      const seq = (Number(seqRow?.seq ?? 0) + 1).toString().padStart(4, '0');
      const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
      const invoiceNumber = `${prefix}-${seq}-${rnd}`;

      const sourcePayload = {
        customerTrn: normalizeTrn(customerTrn as string | undefined) || undefined,
        customerCrn: customerCrn ? String(customerCrn).trim() : undefined,
        customerEmirate: customerEmirate ? String(customerEmirate).trim() : undefined,
        supplyDate: supplyDate ? String(supplyDate) : undefined,
        invoiceTypeCode: String(invoiceTypeCode || '380'),
        buyerReference: buyerReference ? String(buyerReference).trim() : undefined,
        orderReference: orderReference ? String(orderReference).trim() : undefined,
        paymentMeansCode: String(paymentMeansCode || '30'),
        peppolStatus: 'READY',
      };

      type InsRow = { id: string };
      const [row] = await tx.$queryRawUnsafe<InsRow[]>(
        `INSERT INTO finance_invoices
           (invoice_number, client_name, client_email, client_phone, client_address,
            service_type, module, description, line_items, subtotal, discount_amount,
            vat_rate, vat_amount, total_amount, currency, issue_date, due_date,
            notes, reference_id, reference_type, created_by, source_payload, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,
                 $16::date,$17::date,$18,$19,$20,$21,$22::jsonb,$23)
         RETURNING id`,
        invoiceNumber, clientName, clientEmail ?? null, clientPhone ?? null, clientAddress ?? null,
        serviceType, module, description ?? null,
        JSON.stringify(lineItems),
        subtotal, Number(discountAmount), Number(vatRate), vatAmount, totalAmount,
        currency,
        issueDate ?? new Date().toISOString().split('T')[0],
        dueDate ?? null,
        notes ?? null,
        referenceId ?? null, referenceType ?? null, createdBy ?? null,
        JSON.stringify(sourcePayload),
        tenantId
      );

      return NextResponse.json({ success: true, id: row.id, invoiceNumber }, { status: 201 });
    } catch (err) {
      console.error('[finance/invoices POST]', err);
      return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
    }
  });
}
