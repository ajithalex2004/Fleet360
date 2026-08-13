import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET  /api/finance/payments — list payments with invoice reconciliation data
 * POST /api/finance/payments — record a payment and reconcile against finance_invoices
 *
 * finance_payments and finance_invoices are managed by Prisma migrations:
 *   - 20260810000001_finance_extended_columns
 * Runtime CREATE TABLE / ALTER TABLE removed — schema is authoritative.
 */

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Missing x-tenant-id header' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const invoiceId = searchParams.get('invoiceId') ?? '';
  const q         = searchParams.get('q') ?? '';
  const page      = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit     = Math.min(100, parseInt(searchParams.get('limit') ?? '25'));
  const offset    = (page - 1) * limit;

  // tenant scoping is the mandatory first condition
  const conditions: string[] = ['i.tenant_id = $1'];
  const values: unknown[]    = [tenantId];

  if (invoiceId) {
    values.push(invoiceId);
    conditions.push(`p.invoice_id = $${values.length}`);
  }
  if (q) {
    values.push(`%${q}%`);
    const i = values.length;
    conditions.push(`(i.invoice_number ILIKE $${i} OR i.client_name ILIKE $${i} OR p.reference ILIKE $${i})`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  type PayRow = Record<string, unknown>;
  const [rows, countRows] = await Promise.all([
    prisma.$queryRawUnsafe<PayRow[]>(
      `SELECT p.id, p.invoice_id, p.amount, p.payment_date, p.payment_method,
              p.reference, p.notes, p.created_at,
              i.invoice_number, i.client_name, i.total_amount,
              i.paid_amount, i.payment_status, i.currency
         FROM finance_payments p
         LEFT JOIN finance_invoices i ON i.id = p.invoice_id
         ${where}
        ORDER BY p.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      ...values
    ),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) as count
         FROM finance_payments p
         LEFT JOIN finance_invoices i ON i.id = p.invoice_id
        ${where}`,
      ...values
    ),
  ]);

  const fmt     = (d: unknown) => d ? (d as Date)?.toISOString?.() ?? d : null;
  const fmtDate = (d: unknown) => d ? String((d as Date)?.toISOString?.().split('T')[0] ?? d) : null;

  const enriched = rows.map(r => ({
    ...r,
    payment_date: fmtDate(r.payment_date),
    created_at:   fmt(r.created_at),
  }));

  // Summary stats scoped to tenant via invoice join
  type SumRow = { total_paid: number | null; count: bigint };
  const [summary] = await prisma.$queryRawUnsafe<SumRow[]>(
    `SELECT COALESCE(SUM(p.amount), 0) AS total_paid, COUNT(*) AS count
       FROM finance_payments p
       LEFT JOIN finance_invoices i ON i.id = p.invoice_id
      WHERE i.tenant_id = $1`,
    tenantId
  ).catch(() => [{ total_paid: 0, count: BigInt(0) }]);

  return NextResponse.json({
    data:       enriched,
    total:      Number(countRows[0]?.count ?? 0),
    page,
    limit,
    totalPaid:  Number(summary?.total_paid ?? 0),
    totalCount: Number(summary?.count ?? 0),
  });
}

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Missing x-tenant-id header' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      invoiceId, amount, paymentDate,
      paymentMethod = 'BANK_TRANSFER', reference, notes,
    } = body;

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    // Verify the invoice belongs to this tenant before accepting payment
    if (invoiceId) {
      type OwnRow = { id: string };
      const [owned] = await prisma.$queryRawUnsafe<OwnRow[]>(
        `SELECT id FROM finance_invoices WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        invoiceId, tenantId
      ).catch(() => [] as OwnRow[]);

      if (!owned) {
        return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
      }
    }

    // Insert payment
    type InsRow = { id: string };
    const [row] = await prisma.$queryRawUnsafe<InsRow[]>(
      `INSERT INTO finance_payments (invoice_id, amount, payment_date, payment_method, reference, notes)
       VALUES ($1, $2, $3::date, $4, $5, $6) RETURNING id`,
      invoiceId ?? null,
      Number(amount),
      paymentDate ?? new Date().toISOString().split('T')[0],
      paymentMethod,
      reference ?? null,
      notes ?? null
    );

    // Reconcile against invoice if provided
    let newStatus = null;
    if (invoiceId) {
      type InvRow = { total_amount: number; paid_amount: number };
      const [inv] = await prisma.$queryRawUnsafe<InvRow[]>(
        `SELECT total_amount, paid_amount FROM finance_invoices
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        invoiceId, tenantId
      ).catch(() => [] as InvRow[]);

      if (inv) {
        const newPaid = Math.round((Number(inv.paid_amount) + Number(amount)) * 100) / 100;
        newStatus = newPaid >= Number(inv.total_amount) ? 'PAID' : 'PARTIAL';
        await prisma.$executeRawUnsafe(
          `UPDATE finance_invoices
              SET paid_amount = $2, payment_status = $3, updated_at = NOW()
            WHERE id = $1 AND tenant_id = $4`,
          invoiceId, newPaid, newStatus, tenantId
        );
      }
    }

    return NextResponse.json({ success: true, id: row.id, newInvoiceStatus: newStatus }, { status: 201 });
  } catch (err) {
    console.error('[finance/payments POST]', err);
    return NextResponse.json({ error: 'Failed to create payment' }, { status: 500 });
  }
}
