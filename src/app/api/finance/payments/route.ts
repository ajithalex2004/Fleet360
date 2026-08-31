export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
/**
 * GET  /api/finance/payments — list payments with invoice reconciliation data
 * POST /api/finance/payments — record a payment and reconcile against finance_invoices
 *
 * finance_payments and finance_invoices are managed by Prisma migrations:
 *   - 20260810000001_finance_extended_columns
 * Runtime CREATE TABLE / ALTER TABLE removed — schema is authoritative.
 */

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

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
    // ::uuid — finance_payments.invoice_id is uuid and the bound value is a
    // JS string, which Postgres rejects with 42883 rather than coercing.
    conditions.push(`p.invoice_id = $${values.length}::uuid`);
  }
  if (q) {
    values.push(`%${q}%`);
    const i = values.length;
    conditions.push(`(i.invoice_number ILIKE $${i} OR i.client_name ILIKE $${i} OR p.reference ILIKE $${i})`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  type PayRow = Record<string, unknown>;
  type SumRow = { total_paid: number | null; count: bigint };

  const { rows, countRows, summary } = await withTenantRls(prisma, tenantId, async (tx) => {
    // Sequential, not Promise.all: inside the transaction these share a single
    // connection, which Prisma will not multiplex.
    const rows = await tx.$queryRawUnsafe<PayRow[]>(
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
    );
    const countRows = await tx.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) as count
         FROM finance_payments p
         LEFT JOIN finance_invoices i ON i.id = p.invoice_id
        ${where}`,
      ...values
    );

    // Summary stats scoped to tenant via invoice join.
    //
    // This keeps its original zero-fallback, but a bare .catch() is not enough
    // once the query runs inside a transaction: a failed statement aborts the
    // whole tx, so the fallback would be returned and the commit would then
    // fail anyway. The savepoint is what keeps the rollback local to this one
    // statement.
    await tx.$executeRawUnsafe('SAVEPOINT summary_q');
    let summary: SumRow | undefined;
    try {
      [summary] = await tx.$queryRawUnsafe<SumRow[]>(
        `SELECT COALESCE(SUM(p.amount), 0) AS total_paid, COUNT(*) AS count
           FROM finance_payments p
           LEFT JOIN finance_invoices i ON i.id = p.invoice_id
          WHERE i.tenant_id = $1`,
        tenantId
      );
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT summary_q');
    } catch {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT summary_q');
      summary = { total_paid: 0, count: BigInt(0) };
    }

    return { rows, countRows, summary };
  });

  const fmt     = (d: unknown) => d ? (d as Date)?.toISOString?.() ?? d : null;
  const fmtDate = (d: unknown) => d ? String((d as Date)?.toISOString?.().split('T')[0] ?? d) : null;

  const enriched = rows.map(r => ({
    ...r,
    payment_date: fmtDate(r.payment_date),
    created_at:   fmt(r.created_at),
  }));

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
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  try {
    const body = stripTenantOwnershipFields((await req.json()) as Record<string, unknown>);
    const {
      invoiceId, amount, paymentDate,
      paymentMethod = 'BANK_TRANSFER', reference, notes,
    } = body;

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    // Insert + reconcile now share one transaction. They always should have:
    // the payment row and the invoice's paid_amount/payment_status must move
    // together, and previously a failure between them left the payment
    // recorded against an invoice that still showed nothing paid.
    //
    // The ownership check returns a sentinel rather than a NextResponse so the
    // transaction is not held open across response construction.
    const outcome = await withTenantRls(prisma, tenantId, async (tx) => {
      // Verify the invoice belongs to this tenant before accepting payment
      if (invoiceId) {
        type OwnRow = { id: string };
        const [owned] = await tx.$queryRawUnsafe<OwnRow[]>(
          `SELECT id FROM finance_invoices WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
          invoiceId, tenantId
        );

        if (!owned) return { notFound: true as const };
      }

      // Insert payment.
      //
      // tenant_id is supplied explicitly. Until 20260910000005 this INSERT had
      // no tenant column to fill: `finance_payments` resolved to a shadow copy
      // in `public` that had none, while the correctly tenant-isolated table
      // sat unreachable in the `finance` schema behind it on search_path. The
      // shadow is gone, so this now writes to the protected table — and would
      // fail with 23502 rather than silently landing untenanted if it did not
      // pass a tenant.
      type InsRow = { id: string };
      const [row] = await tx.$queryRawUnsafe<InsRow[]>(
        `INSERT INTO finance_payments (tenant_id, invoice_id, amount, payment_date, payment_method, reference, notes)
         VALUES ($7, $1::uuid, $2, $3::date, $4, $5, $6) RETURNING id`,
        invoiceId ?? null,
        Number(amount),
        paymentDate ?? new Date().toISOString().split('T')[0],
        paymentMethod,
        reference ?? null,
        notes ?? null,
        tenantId
      );

      // Reconcile against invoice if provided
      let newStatus: string | null = null;
      if (invoiceId) {
        type InvRow = { total_amount: number; paid_amount: number };
        const [inv] = await tx.$queryRawUnsafe<InvRow[]>(
          `SELECT total_amount, paid_amount FROM finance_invoices
            WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
          invoiceId, tenantId
        );

        if (inv) {
          const newPaid = Math.round((Number(inv.paid_amount) + Number(amount)) * 100) / 100;
          newStatus = newPaid >= Number(inv.total_amount) ? 'PAID' : 'PARTIAL';
          await tx.$executeRawUnsafe(
            `UPDATE finance_invoices
                SET paid_amount = $2, payment_status = $3, updated_at = NOW()
              WHERE id = $1::uuid AND tenant_id = $4`,
            invoiceId, newPaid, newStatus, tenantId
          );
        }
      }

      return { notFound: false as const, id: row.id, newStatus };
    });

    if (outcome.notFound) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, id: outcome.id, newInvoiceStatus: outcome.newStatus }, { status: 201 });
    } catch (err) {
    console.error('[finance/payments POST]', err);
    return NextResponse.json({ error: 'Failed to create payment' }, { status: 500 });
  }
}
