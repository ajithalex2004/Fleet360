export const dynamic = 'force-dynamic';

/**
 * Credit Note individual operations — status lifecycle
 * DRAFT → ISSUED → APPLIED | REFUNDED | VOIDED
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
// Tables come from migrations (the last: 20261005090000_finance_tenant_tables).
// A request runs no DDL: the runtime role may not create tables, and the
// failed statement aborted the request's transaction, so every query after
// it failed too.

type CnRow = Record<string, unknown>;

export async function GET(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _.headers, nextUrl: _.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const [row] = await tx.$queryRawUnsafe<CnRow[]>(
        `SELECT * FROM finance_credit_notes WHERE id::text=$1 AND deleted_at IS NULL AND tenant_id=$2`, params.id, tenantId
      ).catch(() => [] as CnRow[]);
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
      const { action } = body;
      const now = new Date().toISOString();

      let sql = '';
      let sqlParams: unknown[] = [];

      switch (action) {
        case 'issue':
          sql = `UPDATE finance_credit_notes SET status='ISSUED', issued_by=$2, updated_at=$3::timestamptz WHERE id::text=$1 RETURNING *`;
          sqlParams = [params.id, body.issuedBy ?? 'Finance', now];
          break;
        case 'apply':
          sql = `UPDATE finance_credit_notes SET status='APPLIED', applied_amount=$2, updated_at=$3::timestamptz, notes=COALESCE($4,notes) WHERE id::text=$1 RETURNING *`;
          sqlParams = [params.id, body.appliedAmount, now, body.notes ?? null];
          break;
        case 'refund':
          sql = `UPDATE finance_credit_notes SET status='REFUNDED', refunded_at=$2::timestamptz, refund_method=$3, updated_at=$4::timestamptz, notes=COALESCE($5,notes) WHERE id::text=$1 RETURNING *`;
          sqlParams = [params.id, now, body.refundMethod ?? 'Bank Transfer', now, body.notes ?? null];
          break;
        case 'void':
          sql = `UPDATE finance_credit_notes SET status='VOIDED', updated_at=$2::timestamptz, notes=COALESCE($3,notes) WHERE id::text=$1 RETURNING *`;
          sqlParams = [params.id, now, body.notes ?? null];
          break;
        default:
          return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
      }

      // Each statement above targets `WHERE id::text=$1`: narrow it to the tenant.

      sqlParams.push(tenantId);

      sql = sql.replace('WHERE id::text=$1', () => `WHERE id::text=$1 AND tenant_id=$${sqlParams.length}`);

      const [row] = await tx.$queryRawUnsafe<CnRow[]>(sql, ...sqlParams).catch(() => [] as CnRow[]);
      if (!row) return NextResponse.json({ error: 'Update failed' }, { status: 500 });
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
        `UPDATE finance_credit_notes SET deleted_at=NOW() WHERE id::text=$1 AND tenant_id=$2`, params.id, tenantId
      ).catch(() => {});
      return NextResponse.json({ ok: true });
  });
}

