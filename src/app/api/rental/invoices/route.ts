import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const status          = sp.get('status');
    const customerId      = sp.get('customerId');
    const agreementId     = sp.get('agreementId');
    const invoiceType     = sp.get('invoiceType');
    const corporateAcctId = sp.get('corporateAccountId');
    const overdueOnly     = sp.get('overdue') === 'true';
    const { take, skip, page, limit } = paginate(sp);

    const now = new Date();
    const where: any = {
      deletedAt: null,
      ...(status          ? { status }                            : {}),
      ...(customerId      ? { customerId }                        : {}),
      ...(agreementId     ? { agreementId }                       : {}),
      ...(invoiceType     ? { invoiceType }                       : {}),
      ...(corporateAcctId ? { corporateAccountId: corporateAcctId } : {}),
      ...(overdueOnly     ? { dueDate: { lt: now }, status: { notIn: ['PAID', 'VOID'] } } : {}),
    };

    const [data, total] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(
        "SELECT ri.*, ra.agreement_no, " +
        "COALESCE(ri.total_amount - ri.paid_amount, 0) AS balance_due " +
        "FROM rental_invoices ri " +
        "LEFT JOIN rental_agreements ra ON ra.id = ri.agreement_id " +
        "WHERE ri.deleted_at IS NULL " +
        (status      ? "AND ri.status = '" + status.replace(/'/g, '') + "' "           : '') +
        (customerId  ? "AND ri.customer_id = '" + customerId.replace(/'/g, '') + "' "  : '') +
        (agreementId ? "AND ri.agreement_id = '" + agreementId.replace(/'/g, '') + "' " : '') +
        (invoiceType ? "AND ri.invoice_type = '" + invoiceType.replace(/'/g, '') + "' " : '') +
        (overdueOnly ? "AND ri.due_date < NOW() AND ri.status NOT IN ('PAID','VOID') "  : '') +
        "ORDER BY ri.invoice_date DESC " +
        "LIMIT " + take + " OFFSET " + skip,
      ),
      prisma.$queryRawUnsafe<{ count: bigint }[]>(
        "SELECT COUNT(*) AS count FROM rental_invoices WHERE deleted_at IS NULL " +
        (status      ? "AND status = '" + status.replace(/'/g, '') + "' "           : '') +
        (customerId  ? "AND customer_id = '" + customerId.replace(/'/g, '') + "' "  : '') +
        (agreementId ? "AND agreement_id = '" + agreementId.replace(/'/g, '') + "' " : '') +
        (invoiceType ? "AND invoice_type = '" + invoiceType.replace(/'/g, '') + "' " : '') +
        (overdueOnly ? "AND due_date < NOW() AND status NOT IN ('PAID','VOID') "     : ''),
      ).then(r => Number(r[0]?.count ?? 0)),
    ]);

    return NextResponse.json(paginatedResponse(data, total as unknown as number, page, limit));
  } catch (e: any) {
    console.error('Invoice list error:', e);
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { lineItems = [], ...invoiceData } = body;

    // Auto-generate invoice number if not provided
    if (!invoiceData.invoiceNo) {
      const countRows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        "SELECT COUNT(*) AS count FROM rental_invoices"
      );
      const seq = Number(countRows[0]?.count ?? 0) + 1;
      invoiceData.invoiceNo = "RINV-" + String(seq).padStart(6, '0');
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await prisma.$executeRawUnsafe(
      "INSERT INTO rental_invoices (id,created_at,updated_at,invoice_no,agreement_id,customer_id," +
      "invoice_type,invoice_date,due_date,period_from,period_to,currency,subtotal,discount_amount," +
      "taxable_amount,tax_rate,tax_amount,total_amount,paid_amount,balance_due,status,is_corporate," +
      "corporate_account_id,billing_mode,payment_terms_days,notes,internal_notes) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)",
      id, now, now,
      invoiceData.invoiceNo, invoiceData.agreementId, invoiceData.customerId,
      invoiceData.invoiceType ?? 'STANDARD',
      invoiceData.invoiceDate ?? now,
      invoiceData.dueDate ?? now,
      invoiceData.periodFrom ?? null, invoiceData.periodTo ?? null,
      invoiceData.currency ?? 'AED',
      invoiceData.subtotal ?? 0, invoiceData.discountAmount ?? 0,
      invoiceData.taxableAmount ?? 0, invoiceData.taxRate ?? 5,
      invoiceData.taxAmount ?? 0, invoiceData.totalAmount ?? 0,
      0, invoiceData.totalAmount ?? 0,
      invoiceData.status ?? 'DRAFT',
      invoiceData.isCorporate ?? false,
      invoiceData.corporateAccountId ?? null,
      invoiceData.billingMode ?? 'SEPARATE',
      invoiceData.paymentTermsDays ?? 30,
      invoiceData.notes ?? null, invoiceData.internalNotes ?? null,
    );

    // Insert line items
    let sortOrder = 0;
    for (const li of lineItems) {
      const liId = crypto.randomUUID();
      await prisma.$executeRawUnsafe(
        "INSERT INTO rental_invoice_line_items (id,invoice_id,line_type,description,quantity,unit_price,unit_label,discount_pct,taxable,amount,sort_order,reference_id) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        liId, id, li.lineType, li.description,
        li.quantity ?? 1, li.unitPrice ?? 0,
        li.unitLabel ?? 'day', li.discountPct ?? 0,
        li.taxable ?? true, li.amount ?? 0,
        sortOrder++, li.referenceId ?? null,
      );
    }

    const invoice = await prisma.$queryRawUnsafe<any[]>(
      "SELECT * FROM rental_invoices WHERE id = $1", id
    );
    return NextResponse.json(invoice[0], { status: 201 });
  } catch (e: any) {
    console.error('Invoice create error:', e);
    return NextResponse.json({ error: e.message ?? 'Failed to create invoice' }, { status: 500 });
  }
}
