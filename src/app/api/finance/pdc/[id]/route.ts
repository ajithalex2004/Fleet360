export const dynamic = 'force-dynamic';

/**
 * PDC Register — individual cheque operations
 * Status transitions: HELD → DEPOSITED → CLEARED | BOUNCED
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
type PdcRow = Record<string, unknown>;

export async function GET(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _.headers, nextUrl: _.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const [row] = await tx.$queryRawUnsafe<PdcRow[]>(
        `SELECT * FROM finance_pdc_cheques WHERE id::text=$1 AND deleted_at IS NULL AND tenant_id=$2`, params.id, tenantId
      ).catch(() => [] as PdcRow[]);
      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(row);
  });
}


export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const { action, bounceReason, notes } = body;

      const now = new Date().toISOString();
      let sql = '';
      let sqlParams: unknown[] = [params.id];

      if (action === 'deposit') {
        sql = `UPDATE finance_pdc_cheques SET status='DEPOSITED', deposited_at=$2::timestamptz, updated_at=$3::timestamptz, notes=COALESCE($4,notes) WHERE id::text=$1 RETURNING *`;
        sqlParams = [params.id, now, now, notes ?? null];
      } else if (action === 'clear') {
        sql = `UPDATE finance_pdc_cheques SET status='CLEARED', cleared_at=$2::timestamptz, updated_at=$3::timestamptz, notes=COALESCE($4,notes) WHERE id::text=$1 RETURNING *`;
        sqlParams = [params.id, now, now, notes ?? null];
      } else if (action === 'bounce') {
        sql = `UPDATE finance_pdc_cheques SET status='BOUNCED', bounced_at=$2::timestamptz, bounce_reason=$3, updated_at=$4::timestamptz, notes=COALESCE($5,notes) WHERE id::text=$1 RETURNING *`;
        sqlParams = [params.id, now, bounceReason ?? 'Insufficient funds', now, notes ?? null];
      } else if (action === 'cancel') {
        sql = `UPDATE finance_pdc_cheques SET status='CANCELLED', updated_at=$2::timestamptz, notes=COALESCE($3,notes) WHERE id::text=$1 RETURNING *`;
        sqlParams = [params.id, now, notes ?? null];
      } else if (action === 'return') {
        sql = `UPDATE finance_pdc_cheques SET status='RETURNED', updated_at=$2::timestamptz, notes=COALESCE($3,notes) WHERE id::text=$1 RETURNING *`;
        sqlParams = [params.id, now, notes ?? null];
      } else {
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
      }

      sqlParams.push(tenantId);
      sql = sql.replace('WHERE id::text=$1', () => `WHERE id::text=$1 AND tenant_id=$${sqlParams.length}`);

      const [row] = await tx.$queryRawUnsafe<PdcRow[]>(sql, ...sqlParams).catch(() => [] as PdcRow[]);
      if (!row) return NextResponse.json({ error: 'Update failed' }, { status: 500 });

      if (action === 'clear') {
        const linkedInvoiceId = row.linked_invoice_id ?? row.invoice_id;
        const chequeAmount = Number(row.amount ?? 0);
        if (linkedInvoiceId && chequeAmount > 0) {
          await tx.$executeRawUnsafe('SAVEPOINT pdc_clear_payment').catch(() => {});
          try {
            await tx.$executeRawUnsafe(
              `INSERT INTO finance_payments
                 (id, tenant_id, invoice_id, amount, payment_date, payment_method, reference, notes)
               VALUES (gen_random_uuid(), $1, $2::uuid, $3::numeric, CURRENT_DATE, 'CHEQUE', $4, $5)`,
              tenantId,
              String(linkedInvoiceId),
              chequeAmount,
              String(row.cheque_no ?? row.cheque_number ?? 'PDC'),
              `PDC Cheque cleared (${row.cheque_no ?? row.cheque_number ?? params.id})`,
            );
            await tx.$executeRawUnsafe(
              `UPDATE finance_invoices
                  SET paid_amount = LEAST(total_amount, COALESCE(paid_amount, 0) + $1::numeric),
                      payment_status = CASE
                        WHEN COALESCE(paid_amount, 0) + $1::numeric >= total_amount THEN 'PAID'
                        ELSE 'PARTIALLY_PAID'
                      END,
                      updated_at = NOW()
                WHERE id::text = $2 AND tenant_id = $3`,
              chequeAmount,
              String(linkedInvoiceId),
              tenantId,
            );
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT pdc_clear_payment').catch(() => {});
          } catch {
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT pdc_clear_payment').catch(() => {});
          }
        }
      }

      return NextResponse.json(row);
  });
}


export async function DELETE(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _.headers, nextUrl: _.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    await tx.$executeRawUnsafe(
        `UPDATE finance_pdc_cheques SET deleted_at=NOW() WHERE id::text=$1 AND tenant_id=$2`, params.id, tenantId
      ).catch(() => {});
      return NextResponse.json({ ok: true });
  });
}
