export const dynamic = 'force-dynamic';

/**
 * Credit Note individual operations — status lifecycle
 * DRAFT → ISSUED → APPLIED | REFUNDED | VOIDED
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

type CnRow = Record<string, unknown>;

export async function GET(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _.headers, nextUrl: _.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    return await withTenantRls(prisma, tenantId, async (tx) => {
      const [row] = await tx.$queryRawUnsafe<CnRow[]>(
        `SELECT * FROM finance_credit_notes WHERE id::text=$1 AND deleted_at IS NULL AND tenant_id=$2`,
        params.id,
        tenantId,
      );
      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(row);
    });
  } catch (err) {
    console.error('[finance/credit-notes/[id] GET]', err);
    return NextResponse.json({ error: 'Failed to fetch credit note' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    return await withTenantRls(prisma, tenantId, async (tx) => {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const { action } = body;
      const now = new Date().toISOString();

      const [cn] = await tx.$queryRawUnsafe<CnRow[]>(
        `SELECT * FROM finance_credit_notes WHERE id::text = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        params.id, tenantId,
      );

      if (!cn) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      const currentStatus = String(cn.status ?? 'DRAFT').toUpperCase();

      let sql = '';
      let sqlParams: unknown[] = [];

      if (action === 'apply') {
        if (currentStatus !== 'DRAFT' && currentStatus !== 'ISSUED') {
          return NextResponse.json(
            { error: `Cannot apply credit note in status ${currentStatus}` },
            { status: 409 },
          );
        }

        const applyAmt = Number(body.appliedAmount ?? body.applyAmount ?? cn.total_amount ?? 0);
        if (!Number.isFinite(applyAmt) || applyAmt <= 0) {
          return NextResponse.json({ error: 'Applied amount must be a positive number' }, { status: 400 });
        }

        const cnTotal = Number(cn.total_amount ?? 0);
        if (applyAmt > cnTotal + 0.005) {
          return NextResponse.json(
            { error: `Applied amount (${applyAmt}) exceeds credit note total (${cnTotal})` },
            { status: 422 },
          );
        }

        const targetInvoiceId = body.appliedToInvoiceId || body.invoiceId || cn.original_invoice_id;
        let targetInv: {
          id: string;
          invoice_number: string;
          total_amount: unknown;
          paid_amount: unknown;
          payment_status: string;
        } | null = null;
        let existingAppliedCredits = 0;

        if (targetInvoiceId) {
          const [inv] = await tx.$queryRawUnsafe<Array<{
            id: string;
            invoice_number: string;
            total_amount: unknown;
            paid_amount: unknown;
            payment_status: string;
          }>>(
            `SELECT id, invoice_number, total_amount, paid_amount, payment_status
               FROM finance_invoices
              WHERE (id::text = $1 OR invoice_number = $1)
                AND tenant_id = $2
                AND deleted_at IS NULL
              FOR UPDATE`,
            String(targetInvoiceId),
            tenantId,
          );
          if (!inv) {
            return NextResponse.json({ error: 'Target invoice not found' }, { status: 404 });
          }

          const [appliedRow] = await tx.$queryRawUnsafe<Array<{ applied_credits: string | number | null }>>(
            `SELECT COALESCE(SUM(COALESCE(applied_amount, total_amount)), 0) AS applied_credits
               FROM finance_credit_notes
              WHERE original_invoice_id = $1
                AND tenant_id = $2
                AND deleted_at IS NULL
                AND status = 'APPLIED'
                AND id::text <> $3`,
            String(inv.id),
            tenantId,
            String(cn.id),
          );
          existingAppliedCredits = Number(appliedRow?.applied_credits ?? 0);
          const remaining = Number(inv.total_amount ?? 0) - Number(inv.paid_amount ?? 0) - existingAppliedCredits;
          if (applyAmt > remaining + 0.05) {
            return NextResponse.json(
              { error: `Applied credit amount (${applyAmt}) exceeds remaining invoice balance (${Math.max(0, Number(remaining.toFixed(2)))})` },
              { status: 422 },
            );
          }
          targetInv = inv;
        }

        const [row] = await tx.$queryRawUnsafe<CnRow[]>(
          `UPDATE finance_credit_notes
              SET status = 'APPLIED',
                  applied_amount = $2::numeric,
                  original_invoice_id = COALESCE(original_invoice_id, $3),
                  original_invoice_no = COALESCE(original_invoice_no, $4),
                  updated_at = $5::timestamptz,
                  notes = COALESCE($6, notes)
            WHERE id::text = $1 AND tenant_id = $7
            RETURNING *`,
          params.id,
          applyAmt,
          targetInv ? String(targetInv.id) : null,
          targetInv ? String(targetInv.invoice_number) : null,
          now,
          body.notes ?? null,
          tenantId,
        );
        if (!row) return NextResponse.json({ error: 'Update failed' }, { status: 500 });

        if (targetInv) {
          await tx.$executeRawUnsafe(
            `UPDATE finance_invoices
                SET payment_status = CASE
                      WHEN payment_status = 'CANCELLED' THEN 'CANCELLED'
                      WHEN (COALESCE(paid_amount, 0) + $1::numeric) >= total_amount THEN 'PAID'
                      WHEN (COALESCE(paid_amount, 0) + $1::numeric) > 0 THEN 'PARTIAL'
                      ELSE payment_status
                    END,
                    updated_at = NOW()
              WHERE id = $2::uuid AND tenant_id = $3`,
            existingAppliedCredits + applyAmt,
            String(targetInv.id),
            tenantId,
          );
        }

        return NextResponse.json(row);
      }

      switch (action) {
        case 'issue':
          if (currentStatus !== 'DRAFT') {
            return NextResponse.json(
              { error: `Cannot issue credit note in status ${currentStatus}` },
              { status: 409 },
            );
          }
          sql = `UPDATE finance_credit_notes SET status='ISSUED', issued_by=$2, updated_at=$3::timestamptz WHERE id::text=$1 RETURNING *`;
          sqlParams = [params.id, body.issuedBy ?? 'Finance', now];
          break;
        case 'refund':
          if (currentStatus !== 'DRAFT' && currentStatus !== 'ISSUED') {
            return NextResponse.json(
              { error: `Cannot refund credit note in status ${currentStatus}` },
              { status: 409 },
            );
          }
          sql = `UPDATE finance_credit_notes SET status='REFUNDED', refunded_at=$2::timestamptz, refund_method=$3, updated_at=$4::timestamptz, notes=COALESCE($5,notes) WHERE id::text=$1 RETURNING *`;
          sqlParams = [params.id, now, body.refundMethod ?? 'Bank Transfer', now, body.notes ?? null];
          break;
        case 'void':
          if (currentStatus === 'APPLIED' || currentStatus === 'REFUNDED' || currentStatus === 'VOIDED') {
            return NextResponse.json(
              { error: `Cannot void credit note in status ${currentStatus}` },
              { status: 409 },
            );
          }
          sql = `UPDATE finance_credit_notes SET status='VOIDED', updated_at=$2::timestamptz, notes=COALESCE($3,notes) WHERE id::text=$1 RETURNING *`;
          sqlParams = [params.id, now, body.notes ?? null];
          break;
        default:
          return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
      }

      sqlParams.push(tenantId);
      sql = sql.replace('WHERE id::text=$1', () => `WHERE id::text=$1 AND tenant_id=$${sqlParams.length}`);

      const [row] = await tx.$queryRawUnsafe<CnRow[]>(sql, ...sqlParams);
      if (!row) return NextResponse.json({ error: 'Update failed' }, { status: 500 });

      return NextResponse.json(row);
    });
  } catch (err) {
    console.error('[finance/credit-notes/[id] PATCH]', err);
    return NextResponse.json({ error: 'Failed to update credit note' }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _.headers, nextUrl: _.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    return await withTenantRls(prisma, tenantId, async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE finance_credit_notes SET deleted_at=NOW() WHERE id::text=$1 AND tenant_id=$2`, params.id, tenantId
      );
      return NextResponse.json({ ok: true });
    });
  } catch (err) {
    console.error('[finance/credit-notes/[id] DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete credit note' }, { status: 500 });
  }
}
