import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureOperationalTenantColumn, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';

const VALID_STATUSES = ['DRAFT', 'SUBMITTED', 'PAID', 'CANCELLED'];
type VatReturnRow = Record<string, unknown>;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureOperationalTenantColumn('vat_returns').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', {
    requestedTenantId: req.nextUrl.searchParams.get('tenantId'),
  });
  if (ctx instanceof NextResponse) return ctx;

  try {
    const [vatReturn] = await prisma.$queryRawUnsafe<VatReturnRow[]>(
      `SELECT * FROM vat_returns WHERE id::text = $1 AND tenant_id::text = $2 LIMIT 1`,
      params.id,
      ctx.tenantId,
    ).catch(() => []);
    if (!vatReturn) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(vatReturn);
  } catch (err) {
    console.error('[finance/vat GET/:id]', err);
    return NextResponse.json({ error: 'Failed to fetch VAT return' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureOperationalTenantColumn('vat_returns').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;

  try {
    const body = await req.json();
    const { status, submissionDate, paymentDate, notes } = body;

    if (status && !VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }

    const [before] = await prisma.$queryRawUnsafe<VatReturnRow[]>(
      `SELECT * FROM vat_returns WHERE id::text = $1 AND tenant_id::text = $2 LIMIT 1`,
      params.id,
      ctx.tenantId,
    ).catch(() => []);
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const updates: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let pi = 1;

    if (status) {
      updates.push(`status = $${pi++}`);
      values.push(status);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${pi++}`);
      values.push(notes);
    }
    if (status === 'SUBMITTED' || submissionDate) {
      updates.push(`filed_at = $${pi++}`);
      values.push(submissionDate ? new Date(submissionDate) : new Date());
    }
    if (status === 'PAID' || paymentDate) {
      updates.push(`payment_date = $${pi++}`);
      values.push(paymentDate ? new Date(paymentDate) : new Date());
    }

    values.push(params.id, ctx.tenantId);
    const [updated] = await prisma.$queryRawUnsafe<VatReturnRow[]>(
      `UPDATE vat_returns
       SET ${updates.join(', ')}
       WHERE id::text = $${pi++} AND tenant_id::text = $${pi}
       RETURNING *`,
      ...values,
    ).catch(() => []);

    if (!updated) {
      return NextResponse.json({ error: 'Failed to update VAT return' }, { status: 500 });
    }

    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinanceVatReturn',
      entityId: String(updated.id ?? params.id),
      action: status ? 'STATUS_CHANGE' : 'UPDATE',
      before,
      after: updated,
      summary: `Updated VAT return ${String(updated.id ?? params.id)}.`,
      riskSeverity: 'medium',
    });

    return NextResponse.json({ success: true, ...updated });
  } catch (err) {
    console.error('[finance/vat PATCH/:id]', err);
    return NextResponse.json({ error: 'Failed to update VAT return' }, { status: 500 });
  }
}
