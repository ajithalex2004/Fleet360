import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertCanWrite } from '@/lib/access-control';

/**
 * GET  /api/finance/invoices  — paginated list with filters
 * POST /api/finance/invoices  — create invoice with line items + UAE 5% VAT
 *
 * Auto-creates finance_invoices table on first call.
 */

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS finance_invoices (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_number   TEXT NOT NULL UNIQUE,
      client_name      TEXT NOT NULL,
      client_email     TEXT,
      client_phone     TEXT,
      client_address   TEXT,
      service_type     TEXT NOT NULL DEFAULT 'GENERAL',
      module           TEXT NOT NULL DEFAULT 'GENERAL',
      description      TEXT,
      line_items       JSONB NOT NULL DEFAULT '[]',
      subtotal         NUMERIC(14,2) NOT NULL DEFAULT 0,
      discount_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
      vat_rate         NUMERIC(5,2)  NOT NULL DEFAULT 5,
      vat_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
      total_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
      paid_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
      currency         TEXT NOT NULL DEFAULT 'AED',
      issue_date       DATE NOT NULL DEFAULT CURRENT_DATE,
      due_date         DATE,
      payment_status   TEXT NOT NULL DEFAULT 'DRAFT',
      notes            TEXT,
      reference_id     UUID,
      reference_type   TEXT,
      created_by       TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at       TIMESTAMPTZ
    )
  `).catch(() => {});

  // Ensure payment_status index exists
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_finance_invoices_status ON finance_invoices(payment_status)
    WHERE deleted_at IS NULL
  `).catch(() => {});

  // Ensure tenant_id column exists (added for multi-tenant isolation)
  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS tenant_id TEXT
  `).catch(() => {});
}

export async function GET(req: NextRequest) {
  await ensureTable();

  const { searchParams } = new URL(req.url);
  const status   = searchParams.get('status') ?? '';
  const module   = searchParams.get('module') ?? '';
  const q        = searchParams.get('q') ?? '';
  const page     = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit    = Math.min(100, parseInt(searchParams.get('limit') ?? '25'));
  const offset   = (page - 1) * limit;

  const conditions: string[] = ['deleted_at IS NULL'];
  const values: unknown[] = [];

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

  // Summary counts
  type SumRow = { payment_status: string; cnt: bigint };
  const summary = await prisma.$queryRawUnsafe<SumRow[]>(
    `SELECT payment_status, COUNT(*) as cnt FROM finance_invoices WHERE deleted_at IS NULL GROUP BY payment_status`
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

  await ensureTable();

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
    const subtotal = (lineItems as { qty: number; unitPrice: number }[])
      .reduce((sum, item) => sum + (Number(item.qty) || 1) * (Number(item.unitPrice) || 0), 0);
    const discounted = Math.max(0, subtotal - Number(discountAmount));
    const vatAmount  = Math.round(discounted * (Number(vatRate) / 100) * 100) / 100;
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

    // Read tenant from middleware-injected header for multi-tenant isolation
    const tenantId = req.headers.get('x-tenant-id') ?? null;

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
