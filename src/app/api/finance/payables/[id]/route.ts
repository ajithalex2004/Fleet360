export const dynamic = 'force-dynamic';

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
import { approvalGate, approvalInProgress, withApprovalStart } from '@/lib/workflow/approvals';
import { sessionUser } from '@/lib/session-user';
import { payableTotals } from '@/lib/finance/payable-totals';
type Row = Record<string, unknown>;


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
           LEFT JOIN finance_payment_allocations pa ON pa.payable_id = p.id AND pa.tenant_id = p.tenant_id
          WHERE p.id::text = $1 AND p.tenant_id = $2
            AND p.deleted_at IS NULL
          GROUP BY p.id`,
        params.id, tenantId,
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

  const body = stripTenantOwnershipFields(await req.json());
  const action = body.action as string | undefined; // submit | approve | reject | post | void
  // A company's purchase / payable approval workflow (Admin > Workflows)
  // decides submitted payables: approve / reject go to the level that is
  // waiting, and the payable can't be voided until the workflow has decided.
  if (action === 'approve' || action === 'reject') {
    const gated = await approvalGate({
      headers: req.headers, tenantId, referenceType: 'finance_payable', referenceId: params.id,
      action: action === 'reject' ? 'REJECT' : 'APPROVE',
      comments: String((action === 'reject' ? body.reason : body.notes) ?? ''),
    });
    if (gated) return gated;
  } else if (action === 'post' || action === 'void') {
    const busy = await approvalInProgress(tenantId, 'finance_payable', params.id);
    if (busy) return busy;
  }

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
      const now    = new Date().toISOString();

      // Fetch current row
      const [current] = await tx.$queryRawUnsafe<
        (Row & { status: string; total_amount: string; module: string; description: string; payable_number: string; tenant_id: string })[]
      >(
        `SELECT * FROM finance_payables WHERE id::text=$1 AND deleted_at IS NULL AND tenant_id=$2`,
        params.id, tenantId,
      ).catch(() => []);

      if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (current.tenant_id !== tenantId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      // ── Status transitions ──────────────────────────────────────────────────────
      if (action === 'submit') {
        if (current.status !== 'DRAFT') {
          return NextResponse.json({ error: 'Only DRAFT payables can be submitted' }, { status: 400 });
        }
        await tx.$executeRawUnsafe(
          `UPDATE finance_payables SET status='SUBMITTED', updated_at=$1::timestamptz WHERE id::text=$2 AND tenant_id=$3`,
          now, params.id, tenantId,
        );
        const [updated] = await tx.$queryRawUnsafe<Row[]>(
          `SELECT * FROM finance_payables WHERE id::text=$1 AND tenant_id=$2`, params.id, tenantId,
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
              SET status='APPROVED', approved_by=$1, approved_at=$2::timestamptz, updated_at=$2::timestamptz
            WHERE id::text=$3 AND tenant_id=$4`,
          approvedBy, now, params.id, tenantId,
        );
        const [updated] = await tx.$queryRawUnsafe<Row[]>(
          `SELECT * FROM finance_payables WHERE id::text=$1 AND tenant_id=$2`, params.id, tenantId,
        ).catch(() => []);
        return NextResponse.json(updated);
      }

      if (action === 'reject') {
        // Payables have no rejected state: back to draft for correction.
        if (current.status !== 'SUBMITTED') {
          return NextResponse.json({ error: 'Only SUBMITTED payables can be returned' }, { status: 400 });
        }
        const by = (await sessionUser(req.headers))?.email ?? 'Finance Manager';
        const reason = String(body.reason ?? '').trim() || 'No reason given';
        await tx.$executeRawUnsafe(
          `UPDATE finance_payables SET status='DRAFT', updated_at=$1::timestamptz,
                  notes = concat_ws(E'\n', NULLIF(notes, ''), $2::text)
            WHERE id::text=$3 AND tenant_id=$4`,
          now, `Returned by ${by}: ${reason}`, params.id, tenantId,
        );
        const [updated] = await tx.$queryRawUnsafe<Row[]>(
          `SELECT * FROM finance_payables WHERE id::text=$1 AND tenant_id=$2`, params.id, tenantId,
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
              SET status='POSTED', posted_by=$1, posted_at=$2::timestamptz, updated_at=$2::timestamptz,
                  journal_entry_id=$3
            WHERE id::text=$4 AND tenant_id=$5`,
          postedBy, now, je?.id ?? null, params.id, tenantId,
        );
        const [updated] = await tx.$queryRawUnsafe<Row[]>(
          `SELECT * FROM finance_payables WHERE id::text=$1 AND tenant_id=$2`, params.id, tenantId,
        ).catch(() => []);
        return NextResponse.json({ ...updated, journalEntry: je });
      }

      if (action === 'void') {
        if (['PAID'].includes(current.status)) {
          return NextResponse.json({ error: 'Cannot void a fully-paid payable' }, { status: 400 });
        }
        await tx.$executeRawUnsafe(
          `UPDATE finance_payables
              SET payment_status='VOID', status='VOID', updated_at=$1::timestamptz
            WHERE id::text=$2 AND tenant_id=$3`,
          now, params.id, tenantId,
        );
        const [updated] = await tx.$queryRawUnsafe<Row[]>(
          `SELECT * FROM finance_payables WHERE id::text=$1 AND tenant_id=$2`, params.id, tenantId,
        ).catch(() => []);
        return NextResponse.json(updated);
      }

      if (action) return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });

      // ── Field update (no action — patch fields directly) ──────────────────────
      // Only a draft can change: a submitted payable is what its approvers see.
      if (current.status !== 'DRAFT') {
        return NextResponse.json({ error: 'Only DRAFT payables can be edited' }, { status: 400 });
      }
      const allowed = ['vendorName','vendorEmail','vendorPhone','module','description','issueDate','dueDate',
                       'costCentre','profitCentre','notes','lineItems'];
      const sets: string[] = [];
      const vals: unknown[] = [];
      let pi = 1;

      for (const key of allowed) {
        if (!(key in body)) continue;
        const col = key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
        if (key === 'lineItems') {
          // New lines set the payable's amounts, VAT 5% unless given.
          const totals = payableTotals(body.lineItems, body.vatAmount);
          if (!totals) return NextResponse.json({ error: 'Add at least one line with an amount' }, { status: 400 });
          sets.push(`${col} = $${pi++}::jsonb`);
          vals.push(JSON.stringify(totals.lineItems));
          sets.push(`subtotal = $${pi++}::numeric`, `vat_amount = $${pi++}::numeric`, `total_amount = $${pi++}::numeric`);
          vals.push(totals.subtotal, totals.vatAmount, totals.total);
        } else if (key === 'vendorName' && !String(body[key] ?? '').trim()) {
          return NextResponse.json({ error: 'Vendor name is required' }, { status: 400 });
        } else {
          sets.push(`${col} = $${pi++}${key.endsWith('Date') ? '::date' : ''}`);
          vals.push(body[key] === '' ? null : body[key]);
        }
      }
      if (!sets.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
      sets.push(`updated_at = $${pi++}::timestamptz`);
      vals.push(now);
      vals.push(params.id, tenantId);

      await tx.$executeRawUnsafe(
        `UPDATE finance_payables SET ${sets.join(', ')} WHERE id::text = $${pi} AND tenant_id = $${pi + 1}`,
        ...vals,
      );
      const [updated] = await tx.$queryRawUnsafe<Row[]>(
        `SELECT * FROM finance_payables WHERE id::text=$1 AND tenant_id=$2`, params.id, tenantId,
      ).catch(() => []);
      return NextResponse.json(updated);
  });
  return action === 'submit'
    ? withApprovalStart(response, { headers: req.headers, tenantId, referenceType: 'finance_payable', referenceId: params.id })
    : response;
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

      const [current] = await tx.$queryRawUnsafe<{ status: string; tenant_id: string }[]>(
        `SELECT status, tenant_id FROM finance_payables WHERE id::text=$1 AND deleted_at IS NULL AND tenant_id=$2`,
        params.id, tenantId,
      ).catch(() => []);

      if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (current.tenant_id !== tenantId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (!['DRAFT', 'VOID'].includes(current.status)) {
        return NextResponse.json({ error: 'Only DRAFT or VOID payables can be deleted' }, { status: 400 });
      }

      await tx.$executeRawUnsafe(
        `UPDATE finance_payables SET deleted_at=NOW() WHERE id::text=$1 AND tenant_id=$2`, params.id, tenantId,
      );
      return NextResponse.json({ deleted: true });
  });
}

