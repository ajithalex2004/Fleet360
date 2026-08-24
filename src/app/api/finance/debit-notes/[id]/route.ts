/**
 * Debit Note detail — /api/finance/debit-notes/[id]
 *
 * GET    — fetch debit note
 * PATCH  — issue | apply | void
 * DELETE — soft-delete (DRAFT only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
type Row = Record<string, unknown>;

function getTenant(req: NextRequest): string | null {
  return req.headers.get('x-tenant-id');
}

// ── GET /api/finance/debit-notes/[id] ─────────────────────────────────────────

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const tenantId = getTenant(req);
      if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const tenantClause = tenantId === '*' ? '' : `AND tenant_id = '${tenantId}'`;
      const [row] = await tx.$queryRawUnsafe<Row[]>(
        `SELECT * FROM finance_debit_notes
          WHERE id = $1 AND deleted_at IS NULL ${tenantClause}`,
        params.id,
      ).catch(() => []);

      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(row);
  });
}


// ── PATCH /api/finance/debit-notes/[id] ───────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const tenantId = getTenant(req);
      if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const action = body.action as string | undefined; // issue | apply | void
      const now    = new Date().toISOString();

      const [current] = await tx.$queryRawUnsafe<
        (Row & { status: string; total_amount: string; applied_amount: string; tenant_id: string })[]
      >(
        `SELECT * FROM finance_debit_notes WHERE id=$1 AND deleted_at IS NULL`,
        params.id,
      ).catch(() => []);

      if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (tenantId !== '*' && current.tenant_id !== tenantId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      if (action === 'issue') {
        if (current.status !== 'DRAFT') {
          return NextResponse.json({ error: 'Only DRAFT debit notes can be issued' }, { status: 400 });
        }
        const issuedBy = body.issuedBy ?? req.headers.get('x-user-id') ?? 'Finance Manager';
        await tx.$executeRawUnsafe(
          `UPDATE finance_debit_notes
              SET status='ISSUED', issued_by=$1, updated_at=$2
            WHERE id=$3`,
          issuedBy, now, params.id,
        );
      } else if (action === 'apply') {
        if (current.status !== 'ISSUED') {
          return NextResponse.json({ error: 'Only ISSUED debit notes can be applied' }, { status: 400 });
        }
        const applyAmount = parseFloat(body.applyAmount ?? String(current.total_amount ?? 0));
        const newApplied  = parseFloat(String(current.applied_amount ?? 0)) + applyAmount;
        const total       = parseFloat(String(current.total_amount ?? 0));
        const newStatus   = newApplied >= total ? 'APPLIED' : 'ISSUED';
        await tx.$executeRawUnsafe(
          `UPDATE finance_debit_notes
              SET applied_amount=$1, status=$2, updated_at=$3
            WHERE id=$4`,
          newApplied, newStatus, now, params.id,
        );
      } else if (action === 'void') {
        if (current.status === 'APPLIED') {
          return NextResponse.json({ error: 'Cannot void a fully-applied debit note' }, { status: 400 });
        }
        await tx.$executeRawUnsafe(
          `UPDATE finance_debit_notes SET status='VOIDED', updated_at=$1 WHERE id=$2`,
          now, params.id,
        );
      } else {
        // Field-level patch
        const allowed = ['vendorName','vendorEmail','module','reasonCode','reasonDetail',
                         'lineItems','notes','approvedBy'];
        const sets: string[] = [];
        const vals: unknown[] = [];
        let pi = 1;
        for (const key of allowed) {
          if (!(key in body)) continue;
          const col = key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
          if (key === 'lineItems') {
            sets.push(`${col} = $${pi++}::jsonb`);
            vals.push(JSON.stringify(body[key]));
          } else {
            sets.push(`${col} = $${pi++}`);
            vals.push(body[key]);
          }
        }
        if (!sets.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        sets.push(`updated_at = $${pi++}`);
        vals.push(now, params.id);
        await tx.$executeRawUnsafe(
          `UPDATE finance_debit_notes SET ${sets.join(', ')} WHERE id = $${pi}`,
          ...vals,
        );
      }

      const [updated] = await tx.$queryRawUnsafe<Row[]>(
        `SELECT * FROM finance_debit_notes WHERE id=$1`, params.id,
      ).catch(() => []);
      return NextResponse.json(updated);
  });
}


// ── DELETE /api/finance/debit-notes/[id] ──────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const tenantId = getTenant(req);
      if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const [current] = await tx.$queryRawUnsafe<{ status: string; tenant_id: string }[]>(
        `SELECT status, tenant_id FROM finance_debit_notes WHERE id=$1 AND deleted_at IS NULL`,
        params.id,
      ).catch(() => []);

      if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (tenantId !== '*' && current.tenant_id !== tenantId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (current.status !== 'DRAFT') {
        return NextResponse.json({ error: 'Only DRAFT debit notes can be deleted' }, { status: 400 });
      }

      await tx.$executeRawUnsafe(
        `UPDATE finance_debit_notes SET deleted_at=NOW() WHERE id=$1`, params.id,
      );
      return NextResponse.json({ deleted: true });
  });
}

