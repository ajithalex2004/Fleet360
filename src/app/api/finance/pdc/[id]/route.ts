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
        `SELECT * FROM finance_pdc_cheques WHERE id = $1 AND deleted_at IS NULL`, params.id
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
        sql = `UPDATE finance_pdc_cheques SET status='DEPOSITED', deposited_at=$2, updated_at=$3, notes=COALESCE($4,notes) WHERE id=$1 RETURNING *`;
        sqlParams = [params.id, now, now, notes ?? null];
      } else if (action === 'clear') {
        sql = `UPDATE finance_pdc_cheques SET status='CLEARED', cleared_at=$2, updated_at=$3, notes=COALESCE($4,notes) WHERE id=$1 RETURNING *`;
        sqlParams = [params.id, now, now, notes ?? null];
      } else if (action === 'bounce') {
        sql = `UPDATE finance_pdc_cheques SET status='BOUNCED', bounced_at=$2, bounce_reason=$3, updated_at=$4, notes=COALESCE($5,notes) WHERE id=$1 RETURNING *`;
        sqlParams = [params.id, now, bounceReason ?? 'Insufficient funds', now, notes ?? null];
      } else if (action === 'cancel') {
        sql = `UPDATE finance_pdc_cheques SET status='CANCELLED', updated_at=$2, notes=COALESCE($3,notes) WHERE id=$1 RETURNING *`;
        sqlParams = [params.id, now, notes ?? null];
      } else if (action === 'return') {
        sql = `UPDATE finance_pdc_cheques SET status='RETURNED', updated_at=$2, notes=COALESCE($3,notes) WHERE id=$1 RETURNING *`;
        sqlParams = [params.id, now, notes ?? null];
      } else {
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
      }

      const [row] = await tx.$queryRawUnsafe<PdcRow[]>(sql, ...sqlParams).catch(() => [] as PdcRow[]);
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
        `UPDATE finance_pdc_cheques SET deleted_at=NOW() WHERE id=$1`, params.id
      ).catch(() => {});
      return NextResponse.json({ ok: true });
  });
}

