/**
 * Payment Allocations API — /api/finance/payment-allocations
 *
 * Many-to-many allocation of payments against AR invoices or AP payables.
 * A single payment can be split across multiple documents (partial allocation).
 *
 * After each allocation the DB trigger fn_sync_alloc_paid_amount() automatically
 * recalculates paid_amount and payment_status on the target document.
 *
 * GET  — list allocations for a payment or document
 * POST — create a new allocation
 * DELETE — remove an allocation (trigger reverses the paid_amount update)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
type Row = Record<string, unknown>;

function getTenant(req: NextRequest): string | null {
  return req.headers.get('x-tenant-id');
}

// ── GET /api/finance/payment-allocations ─────────────────────────────────────

export async function GET(req: NextRequest) {
  const tenantId = getTenant(req);
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp        = req.nextUrl.searchParams;
  const paymentId = sp.get('paymentId');
  const invoiceId = sp.get('invoiceId');
  const payableId = sp.get('payableId');

  if (!paymentId && !invoiceId && !payableId) {
    return NextResponse.json(
      { error: 'Provide at least one of: paymentId, invoiceId, payableId' },
      { status: 400 },
    );
  }

  let where = `WHERE 1=1`;
  const params: unknown[] = [];
  let pi = 1;

  if (tenantId !== '*') { where += ` AND pa.tenant_id = $${pi++}`; params.push(tenantId); }
  if (paymentId)        { where += ` AND pa.payment_id = $${pi++}::uuid`; params.push(paymentId); }
  if (invoiceId)        { where += ` AND pa.invoice_id = $${pi++}::uuid`; params.push(invoiceId); }
  if (payableId)        { where += ` AND pa.payable_id = $${pi++}::uuid`; params.push(payableId); }

  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT pa.*,
       p.amount          AS payment_amount,
       p.payment_method  AS payment_method,
       p.payment_date    AS payment_date,
       p.reference       AS payment_reference,
       i.invoice_number  AS invoice_number,
       i.client_name     AS invoice_client,
       i.total_amount    AS invoice_total,
       ap.payable_number AS payable_number,
       ap.vendor_name    AS payable_vendor,
       ap.total_amount   AS payable_total
       FROM finance_payment_allocations pa
       JOIN finance_payments p    ON p.id = pa.payment_id
       LEFT JOIN finance_invoices i    ON i.id = pa.invoice_id
       LEFT JOIN finance_payables ap   ON ap.id = pa.payable_id
      ${where}
      ORDER BY pa.created_at DESC`,
    ...params,
  ).catch(() => []);

  // Summary: total allocated vs unallocated on the payment
  let summary: Row | null = null;
  if (paymentId) {
    const [s] = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT p.amount                              AS payment_amount,
              COALESCE(SUM(pa.allocated_amount),0)  AS total_allocated,
              p.amount - COALESCE(SUM(pa.allocated_amount),0) AS unallocated
         FROM finance_payments p
         LEFT JOIN finance_payment_allocations pa ON pa.payment_id = p.id
        WHERE p.id = $1::uuid
        GROUP BY p.amount`,
      paymentId,
    ).catch(() => []);
    summary = s ?? null;
  }

  return NextResponse.json({ data: rows, summary });
}

// ── POST /api/finance/payment-allocations ─────────────────────────────────────

export async function POST(req: NextRequest) {
  const tenantId = getTenant(req);
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { paymentId, invoiceId, payableId, allocatedAmount, allocationDate, notes, allocatedBy } = body;

  if (!paymentId) {
    return NextResponse.json({ error: 'paymentId is required' }, { status: 400 });
  }
  if (!invoiceId && !payableId) {
    return NextResponse.json(
      { error: 'Provide either invoiceId (AR) or payableId (AP)' },
      { status: 400 },
    );
  }
  if (!allocatedAmount || parseFloat(allocatedAmount) <= 0) {
    return NextResponse.json({ error: 'allocatedAmount must be > 0' }, { status: 400 });
  }

  // Verify payment belongs to tenant and has sufficient unallocated balance
  const [payment] = await prisma.$queryRawUnsafe<
    { id: string; amount: string; tenant_id: string }[]
  >(
    `SELECT id, amount::text, tenant_id FROM finance_payments WHERE id=$1::uuid`,
    paymentId,
  ).catch(() => []);

  if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  if (tenantId !== '*' && payment.tenant_id !== tenantId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [alreadyAllocated] = await prisma.$queryRawUnsafe<{ total: string }[]>(
    `SELECT COALESCE(SUM(allocated_amount),0)::text AS total
       FROM finance_payment_allocations WHERE payment_id=$1::uuid`,
    paymentId,
  ).catch(() => [{ total: '0' }]);

  const paymentAmt  = parseFloat(payment.amount);
  const usedAmt     = parseFloat(alreadyAllocated?.total ?? '0');
  const requestAmt  = parseFloat(String(allocatedAmount));
  const remaining   = paymentAmt - usedAmt;

  if (requestAmt > remaining + 0.005) {
    return NextResponse.json(
      { error: `Allocation of ${requestAmt} exceeds unallocated balance of ${remaining.toFixed(2)}` },
      { status: 400 },
    );
  }

  const [row] = await prisma.$queryRawUnsafe<Row[]>(
    `INSERT INTO finance_payment_allocations
       (payment_id, invoice_id, payable_id, allocated_amount, allocation_date,
        notes, allocated_by, tenant_id)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    paymentId,
    invoiceId ? `${invoiceId}::uuid` : null,   // trigger handles UUID cast
    payableId ? `${payableId}::uuid` : null,
    requestAmt,
    allocationDate ?? new Date().toISOString().slice(0, 10),
    notes          ?? null,
    allocatedBy    ?? req.headers.get('x-user-id') ?? null,
    tenantId,
  ).catch(() => []);

  if (!row) return NextResponse.json({ error: 'Failed to create allocation' }, { status: 500 });
  return NextResponse.json(row, { status: 201 });
}

// ── DELETE /api/finance/payment-allocations?id=... ────────────────────────────

export async function DELETE(req: NextRequest) {
  const tenantId = getTenant(req);
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

  const [current] = await prisma.$queryRawUnsafe<{ tenant_id: string }[]>(
    `SELECT tenant_id FROM finance_payment_allocations WHERE id=$1::uuid`,
    id,
  ).catch(() => []);

  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (tenantId !== '*' && current.tenant_id !== tenantId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Hard delete — trigger will reverse paid_amount on the linked document
  await prisma.$executeRawUnsafe(
    `DELETE FROM finance_payment_allocations WHERE id=$1::uuid`, id,
  );
  return NextResponse.json({ deleted: true });
}
