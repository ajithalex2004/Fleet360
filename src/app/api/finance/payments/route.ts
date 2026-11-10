export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { resetInvoiceDunningOnSettlement } from '@/lib/finance/module-ledger';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
/**
 * GET  /api/finance/payments — list payments with invoice reconciliation data
 * POST /api/finance/payments — record a payment and reconcile against finance_invoices
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

  // tenant scoping on p.tenant_id so unlinked payments (p.invoice_id IS NULL) are included
  const conditions: string[] = ['p.tenant_id = $1'];
  const values: unknown[]    = [tenantId];

  if (invoiceId) {
    values.push(invoiceId);
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

    await tx.$executeRawUnsafe('SAVEPOINT summary_q');
    let summary: SumRow | undefined;
    try {
      [summary] = await tx.$queryRawUnsafe<SumRow[]>(
        `SELECT COALESCE(SUM(p.amount), 0) AS total_paid, COUNT(*) AS count
           FROM finance_payments p
           LEFT JOIN finance_invoices i ON i.id = p.invoice_id
          WHERE p.tenant_id = $1`,
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

    const outcome = await withTenantRls(prisma, tenantId, async (tx) => {
      if (invoiceId) {
        type OwnRow = { id: string };
        const [owned] = await tx.$queryRawUnsafe<OwnRow[]>(
          `SELECT id FROM finance_invoices WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
          invoiceId, tenantId
        );

        if (!owned) return { notFound: true as const };
      }

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

      let newStatus: string | null = null;
      if (invoiceId) {
        await tx.$executeRawUnsafe(
          `INSERT INTO finance_payment_allocations
             (payment_id, invoice_id, allocated_amount, allocation_date, notes, allocated_by, tenant_id)
           VALUES ($1::uuid, $2::uuid, $3::numeric, $4::date, $5, $6, $7)`,
          row.id, invoiceId, Number(amount),
          paymentDate ?? new Date().toISOString().split('T')[0],
          'Payment recorded against the invoice', req.headers.get('x-user-id'), tenantId,
        );
        const [inv] = await tx.$queryRawUnsafe<Array<{
          payment_status: string;
          paid_amount: number | string | null;
          total_amount: number | string | null;
          module_source: string | null;
          reference_type: string | null;
          reference_id: string | null;
        }>>(
          `SELECT payment_status, paid_amount, total_amount, module_source, reference_type, reference_id::text
             FROM finance_invoices
            WHERE id = $1::uuid AND tenant_id = $2`,
          invoiceId, tenantId,
        );
        newStatus = inv?.payment_status ?? null;

        const paidAmt = Number(inv?.paid_amount ?? amount);
        const leaseInvId = String(inv?.reference_id || invoiceId);

        // Propagate settlement to LeaseInvoice & reset dunning
        if (newStatus === 'PAID') {
          await resetInvoiceDunningOnSettlement(tx, tenantId, leaseInvId, 'finance-payment').catch(() => {});

          if ((inv?.reference_type === 'LEASE_INVOICE' || inv?.module_source === 'LEASING') && inv?.reference_id) {
            await tx.$executeRawUnsafe('SAVEPOINT sync_lease_inv');
            try {
              await tx.$executeRawUnsafe(
                `UPDATE lease_invoices
                    SET status = 'PAID', paid_at = NOW(), current_dunning_stage = 'SETTLED', updated_at = NOW()
                  WHERE id = $1 AND tenant_id = $2`,
                inv.reference_id, tenantId,
              );
              await tx.$executeRawUnsafe(
                `UPDATE lease_dunning_notices
                    SET dispatch_status = 'SUPPRESSED', updated_at = NOW()
                  WHERE invoice_id = $1 AND tenant_id = $2 AND dispatch_status IN ('PENDING', 'FAILED')`,
                inv.reference_id, tenantId,
              );
              await tx.$executeRawUnsafe('RELEASE SAVEPOINT sync_lease_inv');
            } catch {
              await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sync_lease_inv');
            }
          }
        }

        // Propagate payment to RentalInvoice
        if ((inv?.reference_type === 'RENTAL_INVOICE' || inv?.module_source === 'RENTAL') && inv?.reference_id) {
          await tx.$executeRawUnsafe('SAVEPOINT sync_rental_inv');
          try {
            await tx.$executeRawUnsafe(
              `UPDATE rental_invoices
                  SET paid_amount = $1::numeric,
                      balance_due = GREATEST(0, total_amount - $1::numeric),
                      status = CASE WHEN $1::numeric >= total_amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
                      updated_at = NOW()
                WHERE id = $2 AND tenant_id = $3`,
              paidAmt, inv.reference_id, tenantId,
            );
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT sync_rental_inv');
          } catch {
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sync_rental_inv');
          }
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
