import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { attachTenantToEntity, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { ensureRentalGovernance, rentalEntityVisible } from '@/lib/rental-governance';

export async function GET(req: NextRequest) {
  await ensureRentalGovernance();
  try {
    const sp = req.nextUrl.searchParams;
    const ctx = requireOperationalContext(req, 'rac', { requestedTenantId: sp.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;

    const status = sp.get('status');
    const customerId = sp.get('customerId');
    const agreementId = sp.get('agreementId');
    const invoiceType = sp.get('invoiceType');
    const corporateAcctId = sp.get('corporateAccountId');
    const overdueOnly = sp.get('overdue') === 'true';
    const { take, skip, page, limit } = paginate(sp);

    const conditions = ['ri.deleted_at IS NULL', 'ri.tenant_id::text = $1'];
    const params: unknown[] = [ctx.tenantId];
    if (status) {
      params.push(status);
      conditions.push(`ri.status = $${params.length}`);
    }
    if (customerId) {
      params.push(customerId);
      conditions.push(`ri.customer_id = $${params.length}`);
    }
    if (agreementId) {
      params.push(agreementId);
      conditions.push(`ri.agreement_id = $${params.length}`);
    }
    if (invoiceType) {
      params.push(invoiceType);
      conditions.push(`ri.invoice_type = $${params.length}`);
    }
    if (corporateAcctId) {
      params.push(corporateAcctId);
      conditions.push(`ri.corporate_account_id = $${params.length}`);
    }
    if (overdueOnly) {
      conditions.push(`ri.due_date < NOW() AND ri.status NOT IN ('PAID','VOID')`);
    }
    const where = conditions.join(' AND ');
    const pageParams = [...params, take, skip];

    const [data, totalRows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT ri.*, ra.agreement_no,
                COALESCE(ri.total_amount - ri.paid_amount, 0) AS balance_due
           FROM rental_invoices ri
           LEFT JOIN rental_agreements ra ON ra.id = ri.agreement_id
          WHERE ${where}
          ORDER BY ri.invoice_date DESC
          LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
        ...pageParams,
      ),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count
           FROM rental_invoices ri
          WHERE ${where}`,
        ...params,
      ),
    ]);

    return NextResponse.json(paginatedResponse(data, Number(totalRows[0]?.count ?? 0), page, limit));
  } catch (error) {
    console.error('[rental/invoices] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac', { write: true });
    if (ctx instanceof NextResponse) return ctx;

    const body = await req.json();
    const { lineItems = [], ...invoiceData } = body;
    const agreementId = String(invoiceData.agreementId ?? '');
    const customerId = String(invoiceData.customerId ?? '');
    if (!agreementId || !customerId) {
      return NextResponse.json({ error: 'agreementId and customerId are required' }, { status: 400 });
    }

    const agreementVisible = await rentalEntityVisible('rental_agreements', agreementId, ctx.tenantId);
    const customerVisible = await rentalEntityVisible('rental_customers', customerId, ctx.tenantId);
    if (!agreementVisible) return NextResponse.json({ error: 'Agreement not found for tenant' }, { status: 404 });
    if (!customerVisible) return NextResponse.json({ error: 'Customer not found for tenant' }, { status: 404 });

    if (!invoiceData.invoiceNo) {
      const countRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM rental_invoices WHERE tenant_id::text = $1`,
        ctx.tenantId,
      ).catch(() => [{ count: BigInt(0) }]);
      const seq = Number(countRows[0]?.count ?? 0) + 1;
      invoiceData.invoiceNo = `RINV-${String(seq).padStart(6, '0')}`;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await prisma.$executeRawUnsafe(
      `INSERT INTO rental_invoices
         (id, created_at, updated_at, invoice_no, agreement_id, customer_id,
          invoice_type, invoice_date, due_date, period_from, period_to, currency, subtotal, discount_amount,
          taxable_amount, tax_rate, tax_amount, total_amount, paid_amount, balance_due, status, is_corporate,
          corporate_account_id, billing_mode, payment_terms_days, notes, internal_notes)
       VALUES
         ($1,$2::timestamptz,$3::timestamptz,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10::timestamptz,$11::timestamptz,
          $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
      id,
      now,
      now,
      invoiceData.invoiceNo,
      agreementId,
      customerId,
      invoiceData.invoiceType ?? 'STANDARD',
      invoiceData.invoiceDate ?? now,
      invoiceData.dueDate ?? now,
      invoiceData.periodFrom ?? null,
      invoiceData.periodTo ?? null,
      invoiceData.currency ?? 'AED',
      invoiceData.subtotal ?? 0,
      invoiceData.discountAmount ?? 0,
      invoiceData.taxableAmount ?? 0,
      invoiceData.taxRate ?? 5,
      invoiceData.taxAmount ?? 0,
      invoiceData.totalAmount ?? 0,
      0,
      invoiceData.totalAmount ?? 0,
      invoiceData.status ?? 'DRAFT',
      invoiceData.isCorporate ?? false,
      invoiceData.corporateAccountId ?? null,
      invoiceData.billingMode ?? 'SEPARATE',
      invoiceData.paymentTermsDays ?? 30,
      invoiceData.notes ?? null,
      invoiceData.internalNotes ?? null,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE rental_invoices
          SET balance_due = COALESCE(balance_due, total_amount)
        WHERE id = $1`,
      id,
    ).catch(() => {});
    await attachTenantToEntity('rental_invoices', id, ctx.tenantId);

    let sortOrder = 0;
    for (const li of Array.isArray(lineItems) ? lineItems : []) {
      const liId = crypto.randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO rental_invoice_line_items
           (id, invoice_id, line_type, description, quantity, unit_price, unit_label, discount_pct, taxable, amount, sort_order, reference_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        liId,
        id,
        li.lineType,
        li.description,
        li.quantity ?? 1,
        li.unitPrice ?? 0,
        li.unitLabel ?? 'day',
        li.discountPct ?? 0,
        li.taxable ?? true,
        li.amount ?? 0,
        sortOrder++,
        li.referenceId ?? null,
      );
    }

    const invoiceRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM rental_invoices WHERE id = $1 AND tenant_id::text = $2 LIMIT 1`,
      id,
      ctx.tenantId,
    );
    const invoice = invoiceRows[0] ?? { id, invoiceNo: invoiceData.invoiceNo };
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'RentalInvoice',
      entityId: id,
      action: 'CREATE',
      after: invoice,
      summary: `Created rental invoice ${String(invoiceData.invoiceNo)}.`,
      sourceEntityType: 'RentalAgreement',
      sourceEntityId: agreementId,
    });
    return NextResponse.json(invoice, { status: 201 });
  } catch (error) {
    console.error('[rental/invoices] POST error:', error);
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }
}
