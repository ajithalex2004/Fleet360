import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertCanWrite } from '@/lib/access-control';

/**
 * GET  /api/finance/invoices  — paginated list with filters
 * POST /api/finance/invoices  — create invoice with line items + UAE 5% VAT
 *
 * finance_invoices is owned by Prisma migration
 * 20260809000000_adopt_finance_tables_with_rls — the table and all its
 * columns exist before the application starts. FORCE ROW LEVEL SECURITY
 * is the primary tenant isolation guard; every query here also passes an
 * explicit tenant_id filter for defence-in-depth.
 *
 * The old ensureTable() function that ran CREATE TABLE IF NOT EXISTS and
 * ALTER TABLE at request time has been removed. Schema changes must go
 * through Prisma migrations.
 */

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? '';
  const module = searchParams.get('module') ?? '';
  const q      = searchParams.get('q') ?? '';
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit  = Math.min(100, parseInt(searchParams.get('limit') ?? '25'));
  const offset = (page - 1) * limit;

  // Always scope to the current tenant — both for defence-in-depth and
  // because a platform admin with app.tenant_id='*' would otherwise see
  // every tenant's invoices on this list endpoint.
  const conditions: string[] = ['deleted_at IS NULL', 'tenant_id = $1'];
  const values: unknown[]    = [tenantId];

  if (status) {
    values.push(status);
    conditions.push(`payment_status = $${values.length}`);
  }
  if (module) {
    values.push(module);
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
    prisma.$queryRawUnsafe<InvRow[]>(
      `SELECT id, invoice_number, client_name, client_email, client_phone,
              service_type, module, description,
              subtotal, vat_amount, total_amount, paid_amount, discount_amount,
              currency, issue_date, due_date, payment_status, notes,
              module_source, reference_id, reference_type,
              created_at, updated_at
         FROM finance_invoices
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      ...values
    ),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) as count FROM finance_invoices WHERE ${where}`,
      ...values
    ),
  ]);

  // Compute overdue status dynamically
  const today = new Date().toISOString().split('T')[0];
  const enriched = rows.map(r => ({
    ...r,
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
  }));

  // Summary counts scoped to this tenant
  type SumRow = { payment_status: string; cnt: bigint };
  const summary = await prisma.$queryRawUnsafe<SumRow[]>(
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
}

export async function POST(req: NextRequest) {
  // Enforce TRIAL plan read-only restriction
  const guard = assertCanWrite(req, 'finance');
  if (guard) return guard;

  const tenantId = req.headers.get('x-tenant-id') ?? null;

  try {
    const body = await req.json();
    const {
      clientName, clientEmail, clientPhone, clientAddress,
      serviceType = 'GENERAL', module = 'GENERAL',
      description, lineItems = [], discountAmount = 0,
      vatRate = 5, currency = 'AED',
      issueDate, dueDate, notes, referenceId, referenceType, createdBy,
    } = body;

    if (!clientName) return NextResponse.json({ error: 'clientName is required' }, { status: 400 });

    // Calculate totals from line items
    const subtotal    = (lineItems as { qty: number; unitPrice: number }[])
      .reduce((sum, item) => sum + (Number(item.qty) || 1) * (Number(item.unitPrice) || 0), 0);
    const discounted  = Math.max(0, subtotal - Number(discountAmount));
    const vatAmount   = Math.round(discounted * (Number(vatRate) / 100) * 100) / 100;
    const totalAmount = Math.round((discounted + vatAmount) * 100) / 100;

    // Generate invoice number: INV-YYYYMM-XXXX-rnd (random suffix prevents concurrent insert collisions)
    const prefix = `INV-${new Date().toISOString().slice(0, 7).replace('-', '')}`;
    type SeqRow = { last_seq: bigint | null };
    const [seqRow] = await prisma.$queryRawUnsafe<SeqRow[]>(
      `SELECT MAX(CAST(SPLIT_PART(invoice_number, '-', 3) AS INTEGER)) as last_seq
         FROM finance_invoices WHERE invoice_number LIKE $1`,
      `${prefix}-%`
    ).catch(() => [{ last_seq: null }]);
    const seq = (Number(seqRow?.last_seq ?? 0) + 1).toString().padStart(4, '0');
    const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
    const invoiceNumber = `${prefix}-${seq}-${rnd}`;

    type InsRow = { id: string };
    const [row] = await prisma.$queryRawUnsafe<InsRow[]>(
      `INSERT INTO finance_invoices
         (invoice_number, client_name, client_email, client_phone, client_address,
          service_type, module, description, line_items, subtotal, discount_amount,
          vat_rate, vat_amount, total_amount, currency, issue_date, due_date,
          notes, reference_id, reference_type, created_by, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,
               $16::date,$17::date,$18,$19,$20,$21,$22)
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
      tenantId
    );

    return NextResponse.json({ success: true, id: row.id, invoiceNumber }, { status: 201 });
  } catch (err) {
    console.error('[finance/invoices POST]', err);
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }
}
