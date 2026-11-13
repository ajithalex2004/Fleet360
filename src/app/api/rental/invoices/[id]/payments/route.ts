export const dynamic = 'force-dynamic';

/**
 * GET & POST /api/rental/invoices/:id/payments
 * Records a payment receipt against an issued Tax Invoice inside `withInvoicePaymentLock`,
 * generates a collision-free `RRCPT-XXXXXX` receipt number, posts the balanced GL entry
 * (`DR 1110/1120/1160/2150` / `CR 1131 Trade Receivables — RAC`), and mirrors to Finance.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { mirrorRentalInvoiceToFinance } from '@/lib/finance/module-ledger';
import {
  postRacInvoiceIssuedGl,
  postRacInvoicePaymentGl,
} from '@/lib/finance/rac-gl-posting';
import { nextRentalSerial, withInvoicePaymentLock } from '@/lib/rental/locks';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT *
           FROM rental_invoice_payments
          WHERE invoice_id = $1 AND tenant_id::text = $2
          ORDER BY COALESCE(paid_at, created_at) DESC`,
        params.id,
        tenantId,
      );

      const normalized = rows.map((r) => ({
        ...r,
        id: String(r.id),
        invoiceId: String(r.invoice_id),
        receiptNo: (r.receipt_no as string | null) ?? null,
        amount: Number(r.amount ?? 0),
        currency: String(r.currency ?? 'AED'),
        paymentMethod: (r.payment_method as string | null) ?? 'CASH',
        referenceNo: (r.reference_no as string | null) ?? null,
        paidAt: r.paid_at ? new Date(String(r.paid_at)).toISOString() : null,
        paymentDate: r.payment_date
          ? new Date(String(r.payment_date)).toISOString()
          : r.paid_at
            ? new Date(String(r.paid_at)).toISOString()
            : null,
        receivedBy: (r.received_by as string | null) ?? null,
        notes: (r.notes as string | null) ?? null,
      }));

      return NextResponse.json(normalized);
    } catch {
      return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(
      (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
    );
    const { amount, paymentMethod, paymentDate, referenceNo, notes } = body;

    const numericAmount = Number(amount);
    if (!amount || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      return NextResponse.json(
        { error: 'amount must be a positive number' },
        { status: 400 },
      );
    }
    const paidAmt = Number(numericAmount.toFixed(2));
    const receivedBy = req.headers.get('x-user-id')?.trim() || 'system';

    type PaymentOutcome =
      | { ok: true; invoiceId: string; payload: unknown }
      | { ok: false; response: NextResponse };

    const outcome = await withTenantRls<PaymentOutcome>(prisma, tenantId, async (tx) =>
      withInvoicePaymentLock(tx, tenantId, params.id, async () => {
        const rows = await tx.$queryRawUnsafe<any[]>(
          `SELECT *
             FROM rental_invoices
            WHERE id = $1
              AND tenant_id::text = $2
              AND deleted_at IS NULL`,
          params.id,
          tenantId,
        );
        if (!rows.length) {
          return {
            ok: false,
            response: NextResponse.json({ error: 'Invoice not found' }, { status: 404 }),
          };
        }

        const inv = rows[0];
        const currentStatus = String(inv.status ?? 'DRAFT').toUpperCase();
        const invoiceType = String(inv.invoice_type ?? 'STANDARD').toUpperCase();

        if (invoiceType === 'CREDIT_NOTE') {
          return {
            ok: false,
            response: NextResponse.json(
              { error: 'Cannot record a payment receipt on a Tax Credit Note' },
              { status: 409 },
            ),
          };
        }

        if (['DRAFT', 'PAID', 'VOID', 'CANCELLED', 'CREDITED'].includes(currentStatus)) {
          return {
            ok: false,
            response: NextResponse.json(
              { error: `Cannot record payment on a ${currentStatus} invoice` },
              { status: 409 },
            ),
          };
        }

        const totalAmt = Number(inv.total_amount ?? 0);
        const existingPaid = Number(inv.paid_amount ?? 0);
        const currentBalance =
          inv.balance_due != null
            ? Number(inv.balance_due)
            : Number(Math.max(0, totalAmt - existingPaid).toFixed(2));

        if (paidAmt > currentBalance + 0.01) {
          return {
            ok: false,
            response: NextResponse.json(
              {
                error: `Payment amount (${paidAmt.toFixed(2)}) exceeds remaining balance due (${currentBalance.toFixed(2)})`,
              },
              { status: 422 },
            ),
          };
        }

        const paymentId = crypto.randomUUID();
        const receiptNo = await nextRentalSerial(tx, {
          tenantId,
          series: 'RRCPT',
          prefix: 'RRCPT-',
          table: 'rental_invoice_payments',
          column: 'receipt_no',
        });

        const now = new Date().toISOString();
        const parsedPaidDate = paymentDate ? new Date(String(paymentDate)) : new Date(now);
        const paidDateIso = Number.isNaN(parsedPaidDate.getTime())
          ? now
          : parsedPaidDate.toISOString();
        const resolvedMethod = String(paymentMethod ?? 'CASH').trim() || 'CASH';

        await tx.$executeRawUnsafe(
          `INSERT INTO rental_invoice_payments
             (id, tenant_id, invoice_id, receipt_no, paid_at, payment_date,
              amount, currency, payment_method, reference_no, notes, received_by, created_at)
           VALUES
             ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz,
              $6, $7, $8, $9, $10, $11, $12::timestamptz)`,
          paymentId,
          tenantId,
          params.id,
          receiptNo,
          paidDateIso,
          paidAmt,
          inv.currency ?? 'AED',
          resolvedMethod,
          referenceNo ?? null,
          notes ?? null,
          receivedBy,
          now,
        );

        const newBalanceDue = Number(Math.max(0, currentBalance - paidAmt).toFixed(2));
        const newPaidTotal = Number((existingPaid + paidAmt).toFixed(2));
        const newStatus = newBalanceDue <= 0.009 ? 'PAID' : 'PARTIALLY_PAID';

        await tx.$executeRawUnsafe(
          `UPDATE rental_invoices
              SET paid_amount = $1,
                  balance_due = $2,
                  status = $3,
                  paid_at = CASE WHEN $2 <= 0.009 THEN $4::timestamptz ELSE paid_at END,
                  updated_at = $4::timestamptz
            WHERE id = $5 AND tenant_id::text = $6`,
          newPaidTotal,
          newBalanceDue,
          newStatus,
          now,
          params.id,
          tenantId,
        );

        // Ensure parent invoice's issue GL exists idempotently before posting settlement against 1131 AR
        await postRacInvoiceIssuedGl(tx, {
          tenantId,
          invoiceId: params.id,
          invoiceNo: String(inv.invoice_no ?? params.id),
          invoiceDate: inv.invoice_date ?? now,
          status: newStatus,
          currency: String(inv.currency ?? 'AED'),
          subtotal: Number(inv.subtotal ?? 0),
          discountAmount: Number(inv.discount_amount ?? 0),
          taxAmount: Number(inv.tax_amount ?? 0),
          totalAmount: totalAmt,
          preparedBy: receivedBy,
        });

        await postRacInvoicePaymentGl(tx, {
          tenantId,
          paymentId,
          receiptNo,
          invoiceNo: String(inv.invoice_no ?? params.id),
          amount: paidAmt,
          paymentMethod: resolvedMethod,
          paidAt: paidDateIso,
          currency: String(inv.currency ?? 'AED'),
          preparedBy: receivedBy,
        });

        const updated = await tx.$queryRawUnsafe<any[]>(
          'SELECT * FROM rental_invoices WHERE id = $1 AND tenant_id::text = $2',
          params.id,
          tenantId,
        );

        return {
          ok: true,
          invoiceId: params.id,
          payload: {
            payment: {
              id: paymentId,
              receiptNo,
              amount: paidAmt,
              paymentMethod: resolvedMethod,
              paymentDate: paidDateIso,
              paidAt: paidDateIso,
              receivedBy,
            },
            invoice: updated[0],
          },
        };
      }),
    );

    if (!outcome.ok) {
      return outcome.response;
    }

    await mirrorRentalInvoiceToFinance(outcome.invoiceId, tenantId, receivedBy).catch((err) =>
      console.warn('[rental/payments] mirror failed:', err),
    );

    return NextResponse.json(outcome.payload, { status: 201 });
  } catch (e) {
    console.error('Invoice payment error:', e);
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 });
  }
}
