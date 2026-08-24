/**
 * AP Payable detail — /api/finance/payables/[id]
 *
 * GET    — fetch payable with allocations
 * PATCH  — status transitions + field updates
 * DELETE — soft-delete (DRAFT only)
 *
 * Status workflow: DRAFT → SUBMITTED → APPROVED → POSTED → (VOID via PATCH action=void)
 * When a payable is POSTED a DRAFT journal entry is auto-created (debit Expense, credit AP).
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { createDraftJournalEntry } from '@/lib/finance/journal-service';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
type Row = Record<string, unknown>;

function getTenant(req: NextRequest): string | null {
  return req.headers.get('x-tenant-id');
}

// ── GET /api/finance/payables/[id] ────────────────────────────────────────────

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

      const tenantClause = tenantId === '*' ? '' : `AND p.tenant_id = '${tenantId}'`;

      const [row] = await tx.$queryRawUnsafe<Row[]>(
        `SELECT p.*,
           COALESCE(
             json_agg(
               json_build_object(
                 'id',              pa.id,
                 'paymentId',       pa.payment_id,
                 'allocatedAmount', pa.allocated_amount,
                 'allocationDate',  pa.allocation_date,
                 'allocatedBy',     pa.allocated_by,
                 'notes',           pa.notes
               ) ORDER BY pa.created_at
             ) FILTER (WHERE pa.id IS NOT NULL),
             '[]'::json
           ) AS allocations
           FROM finance_payables p
           LEFT JOIN finance_payment_allocations pa ON pa.payable_id = p.id
          WHERE p.id = $1 ${tenantClause}
            AND p.deleted_at IS NULL
          GROUP BY p.id`,
        params.id,
      ).catch(() => []);

      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(row);
  });
}


// ── PATCH /api/finance/payables/[id] ─────────────────────────────────────────

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
      const action = body.action as string | undefined; // submit | approve | post | void
      const now    = new Date().toISOString();

      // Fetch current row
      const [current] = await tx.$queryRawUnsafe<
        (Row & { status: string; total_amount: string; module: string; description: string; payable_number: string; tenant_id: string })[]
      >(
        `SELECT * FROM finance_payables WHERE id = $1 AND deleted_at IS NULL`,
        params.id,
      ).catch(() => []);

      if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (tenantId !== '*' && current.tenant_id !== tenantId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      // ── Status transitions ──────────────────────────────────────────────────────
      if (action === 'submit') {
        if (current.status !== 'DRAFT') {
          return NextResponse.json({ error: 'Only DRAFT payables can be submitted' }, { status: 400 });
        }
        await tx.$executeRawUnsafe(
          `UPDATE finance_payables SET status='SUBMITTED', updated_at=$1 WHERE id=$2`,
          now, params.id,
        );
        const [updated] = await tx.$queryRawUnsafe<Row[]>(
          `SELECT * FROM finance_payables WHERE id=$1`, params.id,
        ).catch(() => []);
        return NextResponse.json(updated);
      }

      if (action === 'approve') {
        if (current.status !== 'SUBMITTED') {
          return NextResponse.json({ error: 'Only SUBMITTED payables can be approved' }, { status: 400 });
        }
        const approvedBy = body.approvedBy ?? req.headers.get('x-user-id') ?? 'Finance Manager';
        await tx.$executeRawUnsafe(
          `UPDATE finance_payables
              SET status='APPROVED', approved_by=$1, approved_at=$2, updated_at=$2
            WHERE id=$3`,
          approvedBy, now, params.id,
        );
        const [updated] = await tx.$queryRawUnsafe<Row[]>(
          `SELECT * FROM finance_payables WHERE id=$1`, params.id,
        ).catch(() => []);
        return NextResponse.json(updated);
      }

      if (action === 'post') {
        if (current.status !== 'APPROVED') {
          return NextResponse.json({ error: 'Only APPROVED payables can be posted' }, { status: 400 });
        }
        const postedBy = body.postedBy ?? req.headers.get('x-user-id') ?? 'Finance Manager';
        const amount   = parseFloat(String(current.total_amount ?? 0));
        const module   = (current.module as string) ?? 'GENERAL';
        const desc     = (current.description as string) ?? String(current.payable_number);

        // Auto-create a DRAFT journal entry: debit Expense account, credit AP control account
        const expenseCode = module === 'MAINTENANCE' ? '5100' :
                            module === 'LOGISTICS'    ? '5200' :
                            module === 'LEASING'      ? '5300' : '5900';
        let je: { id: string; number: string } | null = null;
        try {
          je = await createDraftJournalEntry({
            tenantId: current.tenant_id as string,
            narration: `AP Payable: ${desc}`,
            reference: String(current.payable_number),
            sourceType: 'AP_PAYABLE',
            sourceId:   params.id,
            amount,
            currency:   (current.currency as string) ?? 'AED',
            preparedBy: postedBy,
            costCentre: (current.cost_centre as string) ?? 'GENERAL',
            debit:  { code: expenseCode, name: 'Expense',             description: desc },
            credit: { code: '2100',      name: 'Accounts Payable',    description: desc },
          });
          } catch (e) { /* non-fatal — payable still posts */ }

        await tx.$executeRawUnsafe(
          `UPDATE finance_payables
              SET status='POSTED', posted_by=$1, posted_at=$2, updated_at=$2,
                  journal_entry_id=$3
            WHERE id=$4`,
          postedBy, now, je?.id ?? null, params.id,
        );
        const [updated] = await tx.$queryRawUnsafe<Row[]>(
          `SELECT * FROM finance_payables WHERE id=$1`, params.id,
        ).catch(() => []);
        return NextResponse.json({ ...updated, journalEntry: je });
      }

      if (action === 'void') {
        if (['PAID'].includes(current.status)) {
          return NextResponse.json({ error: 'Cannot void a fully-paid payable' }, { status: 400 });
        }
        await tx.$executeRawUnsafe(
          `UPDATE finance_payables
              SET payment_status='VOID', status='VOID', updated_at=$1
            WHERE id=$2`,
          now, params.id,
        );
        const [updated] = await tx.$queryRawUnsafe<Row[]>(
          `SELECT * FROM finance_payables WHERE id=$1`, params.id,
        ).catch(() => []);
        return NextResponse.json(updated);
      }

      // ── Field update (no action — patch fields directly) ──────────────────────
      const allowed = ['vendorName','vendorEmail','vendorPhone','description','dueDate',
                       'costCentre','profitCentre','notes','lineItems'];
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
      vals.push(now);
      vals.push(params.id);

      await tx.$executeRawUnsafe(
        `UPDATE finance_payables SET ${sets.join(', ')} WHERE id = $${pi}`,
        ...vals,
      );
      const [updated] = await tx.$queryRawUnsafe<Row[]>(
        `SELECT * FROM finance_payables WHERE id=$1`, params.id,
      ).catch(() => []);
      return NextResponse.json(updated);
  });
}


// ── DELETE /api/finance/payables/[id] ────────────────────────────────────────

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
        `SELECT status, tenant_id FROM finance_payables WHERE id=$1 AND deleted_at IS NULL`,
        params.id,
      ).catch(() => []);

      if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (tenantId !== '*' && current.tenant_id !== tenantId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (!['DRAFT', 'VOID'].includes(current.status)) {
        return NextResponse.json({ error: 'Only DRAFT or VOID payables can be deleted' }, { status: 400 });
      }

      await tx.$executeRawUnsafe(
        `UPDATE finance_payables SET deleted_at=NOW() WHERE id=$1`, params.id,
      );
      return NextResponse.json({ deleted: true });
  });
}

