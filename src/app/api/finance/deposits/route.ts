export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { nextDocumentNumber } from '@/lib/finance/document-number';
import { addDeduction, forfeitDeposit, recordRefundDetails, executeRefund, cancelRefundRequest, requestRefund, SecurityDepositError } from '@/lib/finance/security-deposit';
import { approvalGate, approvalInProgress, approvalRequired, withApprovalStart, withdrawApproval } from '@/lib/workflow/approvals';
import { sessionUser } from '@/lib/session-user';
function toStr(v: unknown) {
  if (v instanceof Buffer) return v.toString('hex');
  if (typeof v === 'string') return v;
  return String(v ?? '');
}

function row(r: Record<string, unknown>) {
  return {
    id:               toStr(r.id),
    deposit_no:       r.deposit_no,
    contract_id:      r.contract_id,
    contract_type:    r.contract_type,
    customer_name:    r.customer_name,
    customer_trn:     r.customer_trn,
    vehicle_no:       r.vehicle_no,
    vehicle_type:     r.vehicle_type,
    branch:           r.branch,
    collected_amount: Number(r.collected_amount),
    collection_date:  r.collection_date,
    collection_method: r.collection_method,
    cheque_no:        r.cheque_no,
    bank_name:        r.bank_name,
    status:           r.status,
    deductions:       typeof r.deductions === 'string' ? JSON.parse(r.deductions) : (r.deductions ?? []),
    total_deducted:   Number(r.total_deducted ?? 0),
    refund_amount:    r.refund_amount != null ? Number(r.refund_amount) : null,
    refund_date:      r.refund_date,
    refund_method:    r.refund_method,
    refund_reference: r.refund_reference,
    reserved_amount:  Number(r.reserved_amount ?? 0),
    refunded_amount:  Number(r.refunded_amount ?? 0),
    refund_status:    r.refund_status,
    refund_requested_amount: r.refund_requested_amount != null ? Number(r.refund_requested_amount) : null,
    refund_requested_by:     r.refund_requested_by,
    refund_requested_at:     r.refund_requested_at,
    refund_recorded_by:      r.refund_recorded_by,
    refund_recorded_at:      r.refund_recorded_at,
    held_days:        Number(r.held_days ?? 0),
    forfeiture_reason: r.forfeiture_reason,
    notes:            r.notes,
    created_at:       r.created_at,
    updated_at:       r.updated_at,
  };
}

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const p = req.nextUrl.searchParams;
      const status       = p.get('status');
      const contract_type = p.get('contract_type');
      const branch       = p.get('branch');
      const search       = p.get('search');
      const aging_only   = p.get('aging_only') === 'true'; // held > 365 days

      let where = 'WHERE tenant_id = $1';
      const params: unknown[] = [tenantId];
      let idx = 2;

      if (status)        { where += ` AND status = $${idx++}`;         params.push(status); }
      if (contract_type) { where += ` AND contract_type = $${idx++}`;  params.push(contract_type); }
      if (branch)        { where += ` AND branch = $${idx++}`;         params.push(branch); }
      if (aging_only)    { where += ` AND (CURRENT_DATE - collection_date) > 365`; }
      if (search) {
        where += ` AND (customer_name ILIKE $${idx} OR vehicle_no ILIKE $${idx} OR deposit_no ILIKE $${idx} OR contract_id ILIKE $${idx})`;
        params.push(`%${search}%`); idx++;
      }

      const rows = await tx.$queryRawUnsafe(
        `SELECT *, (CURRENT_DATE - collection_date) AS held_days FROM finance_security_deposits ${where} ORDER BY created_at DESC`,
        ...params
      ) as Record<string, unknown>[];

      // KPI summary
      const kpi = await tx.$queryRawUnsafe(`
        SELECT
          COUNT(*)                                          AS total,
          COUNT(*) FILTER (WHERE status = 'HELD')          AS held_count,
          COUNT(*) FILTER (WHERE status LIKE '%REFUNDED%') AS refunded_count,
          COUNT(*) FILTER (WHERE status = 'FORFEITED')     AS forfeited_count,
          COALESCE(SUM(collected_amount) FILTER (WHERE status = 'HELD'), 0)        AS total_held_amount,
          COALESCE(SUM(collected_amount) FILTER (WHERE status = 'FORFEITED'), 0)   AS total_forfeited,
          COALESCE(SUM(refund_amount)    FILTER (WHERE refund_amount IS NOT NULL), 0) AS total_refunded,
          COUNT(*) FILTER (WHERE (CURRENT_DATE - collection_date) > 365) AS overdue_count
        FROM finance_security_deposits
        WHERE tenant_id = $1
      `, tenantId) as Record<string, unknown>[];

      return NextResponse.json({ deposits: rows.map(row), kpi: kpi[0] });
  });
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const bRaw = await req.json();
  const b = stripTenantOwnershipFields(bRaw);

      const deposit_no = await nextDocumentNumber(tx, tenantId, 'FSD');

      const rows = await tx.$queryRawUnsafe(`
        INSERT INTO finance_security_deposits
          (tenant_id, deposit_no, contract_id, contract_type, customer_name, customer_trn,
           vehicle_no, vehicle_type, branch, collected_amount, collection_date,
           collection_method, cheque_no, bank_name, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::numeric,$11::date,$12,$13,$14,$15)
        RETURNING *
      `,
        tenantId,
        deposit_no,
        b.contract_id,
        b.contract_type ?? 'LEASE',
        b.customer_name,
        b.customer_trn ?? null,
        b.vehicle_no,
        b.vehicle_type ?? null,
        b.branch ?? 'Dubai',
        b.collected_amount,
        b.collection_date,
        b.collection_method ?? 'BANK_TRANSFER',
        b.cheque_no ?? null,
        b.bank_name ?? null,
        b.notes ?? null,
      ) as Record<string, unknown>[];

      return NextResponse.json(row(rows[0]), { status: 201 });
  });
}


export async function PATCH(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const b = stripTenantOwnershipFields(await req.json());
  const { id, action } = b;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // A company's Refund Approval workflow (Admin > Workflows) decides refund
  // requests: approve / reject go to the level that is waiting, and the
  // refund can't be recorded, paid or cancelled here while it decides. With
  // a workflow, a refund starts as a request (request_refund); without one,
  // request_refund records and pays it at once, like the one-step refund.
  if (action === 'approve_refund' || action === 'reject_refund') {
    const gated = await approvalGate({
      headers: req.headers, tenantId, referenceType: 'finance_deposit_refund', referenceId: String(id),
      action: action === 'reject_refund' ? 'REJECT' : 'APPROVE', comments: String(b.reason ?? ''),
    });
    return gated ?? NextResponse.json({ error: 'This refund is not waiting for an approval' }, { status: 400 });
  }
  if (['record_refund_details', 'execute_refund', 'refund'].includes(action)) {
    const busy = await approvalInProgress(tenantId, 'finance_deposit_refund', String(id));
    if (busy) return busy;
  }
  const needsApproval = ['request_refund', 'refund'].includes(action)
    ? await approvalRequired(tenantId, 'finance_deposit_refund') : false;
  if (action === 'refund' && needsApproval) {
    return NextResponse.json({ error: 'Refunds need approval: request the refund instead' }, { status: 409 });
  }
  const actorEmail = action === 'request_refund' || action === 'cancel_refund_request'
    ? (await sessionUser(req.headers).catch(() => null))?.email : undefined;

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
      const actor = actorEmail ?? req.headers.get('x-user-id') ?? 'staff';

      // ── Request a refund (approval workflow), or refund at once ─────────────────
      if (action === 'request_refund') {
        try {
          const current = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
            `SELECT collected_amount, total_deducted, reserved_amount, refund_status FROM finance_security_deposits WHERE id = $1::uuid AND tenant_id = $2`,
            id, tenantId,
          );
          if (!current.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
          if (['REQUESTED', 'RECORDED'].includes(String(current[0].refund_status ?? ''))) {
            return NextResponse.json({ error: 'A refund is already in progress for this deposit' }, { status: 409 });
          }
          const available = Number(current[0].collected_amount) - Number(current[0].total_deducted) - Number(current[0].reserved_amount);
          const amount = b.refund_amount != null && b.refund_amount !== '' ? Number(b.refund_amount) : available;
          if (!(amount > 0)) return NextResponse.json({ error: 'Refund amount must be more than zero' }, { status: 400 });
          await requestRefund(tx, tenantId, id, amount, actor);
          // How it is to be paid, for recording once approved.
          await tx.$executeRawUnsafe(
            `UPDATE finance_security_deposits SET refund_method = $3, refund_reference = $4, refund_date = $5::date
              WHERE id = $1::uuid AND tenant_id = $2`,
            id, tenantId, b.refund_method ?? 'BANK_TRANSFER', b.refund_reference ?? null, b.refund_date ?? null,
          );
          if (!needsApproval) {
            await recordRefundDetails(tx, tenantId, id, { method: b.refund_method ?? 'BANK_TRANSFER', reference: b.refund_reference, recordedBy: actor });
            const paid = await executeRefund(tx, tenantId, id, actor);
            return NextResponse.json(row(paid));
          }
          const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
            `SELECT * FROM finance_security_deposits WHERE id = $1::uuid AND tenant_id = $2`, id, tenantId,
          );
          return NextResponse.json(row(rows[0]));
        } catch (e) {
          if (e instanceof SecurityDepositError) return NextResponse.json({ error: e.message }, { status: 400 });
          throw e;
        }
      }

      // ── Add Deduction ─────────────────────────────────────────────────────────
      if (action === 'add_deduction') {
        try {
          const updated = await addDeduction(tx, tenantId, id, {
            description: b.description,
            amount: Number(b.amount),
            category: b.category,
            date: b.date,
          });
          return NextResponse.json(row(updated));
        } catch (e) {
          if (e instanceof SecurityDepositError) return NextResponse.json({ error: e.message }, { status: 400 });
          throw e;
        }
      }

      // ── Record refund details (requested → recorded) ────────────────────────────
      if (action === 'record_refund_details') {
        try {
          const updated = await recordRefundDetails(tx, tenantId, id, {
            method: b.method ?? b.refund_method ?? 'BANK_TRANSFER',
            reference: b.reference ?? b.refund_reference,
            recordedBy: actor,
          });
          return NextResponse.json(row(updated));
        } catch (e) {
          if (e instanceof SecurityDepositError) return NextResponse.json({ error: e.message }, { status: 400 });
          throw e;
        }
      }

      // ── Execute refund (recorded → executed, idempotent) ────────────────────────
      if (action === 'execute_refund') {
        try {
          const updated = await executeRefund(tx, tenantId, id, actor);
          return NextResponse.json(row(updated));
        } catch (e) {
          if (e instanceof SecurityDepositError) return NextResponse.json({ error: e.message }, { status: 400 });
          throw e;
        }
      }

      // ── Cancel a refund request (pre-execution only) ─────────────────────────────
      if (action === 'cancel_refund_request') {
        try {
          const updated = await cancelRefundRequest(tx, tenantId, id, { reason: b.reason, cancelledBy: actor });
          return NextResponse.json(row(updated));
        } catch (e) {
          if (e instanceof SecurityDepositError) return NextResponse.json({ error: e.message }, { status: 400 });
          throw e;
        }
      }

      // ── Process Refund (legacy single-step — manual/non-workflow refunds) ───────
      if (action === 'refund') {
        const current = await tx.$queryRawUnsafe(
          `SELECT * FROM finance_security_deposits WHERE id = $1::uuid AND tenant_id = $2`, id, tenantId
        ) as Record<string, unknown>[];
        if (!current.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
        const dep = current[0];
        const refundAmt = Number(b.refund_amount ?? (Number(dep.collected_amount) - Number(dep.total_deducted)));
        const newStatus = refundAmt >= (Number(dep.collected_amount) - Number(dep.total_deducted))
          ? 'FULLY_REFUNDED' : 'PARTIALLY_REFUNDED';

        const rows = await tx.$queryRawUnsafe(`
          UPDATE finance_security_deposits
          SET
            refund_amount    = $2,
            refund_date      = $3::date,
            refund_method    = $4,
            refund_reference = $5,
            status           = $6,
            updated_at       = NOW()
          WHERE id = $1::uuid AND tenant_id = $7
          RETURNING *
        `, id, refundAmt, b.refund_date ?? new Date().toISOString().split('T')[0],
           b.refund_method ?? 'BANK_TRANSFER', b.refund_reference ?? null, newStatus, tenantId
        ) as Record<string, unknown>[];
        return NextResponse.json(row(rows[0]));
      }

      // ── Forfeit ───────────────────────────────────────────────────────────────
      if (action === 'forfeit') {
        const updated = await forfeitDeposit(tx, tenantId, id, { reason: b.forfeiture_reason });
        return NextResponse.json(row(updated));
      }

      // ── Generic field update ──────────────────────────────────────────────────
      const allowed = ['contract_id','contract_type','customer_name','customer_trn','vehicle_no',
        'vehicle_type','branch','collected_amount','collection_date','collection_method',
        'cheque_no','bank_name','notes'];
      const updates: string[] = [];
      const vals: unknown[]   = [id];
      let pi = 2;
      for (const key of allowed) {
        if (key in b) { updates.push(`${key} = $${pi++}`); vals.push(b[key]); }
      }
      if (!updates.length) return NextResponse.json({ error: 'no fields' }, { status: 400 });
      updates.push('updated_at = NOW()');
      vals.push(tenantId);

      const rows = await tx.$queryRawUnsafe(
        `UPDATE finance_security_deposits SET ${updates.join(', ')} WHERE id = $1::uuid AND tenant_id = $${pi} RETURNING *`,
        ...vals
      ) as Record<string, unknown>[];
      if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
      return NextResponse.json(row(rows[0]));
  });

  if (action === 'request_refund' && needsApproval) {
    return withApprovalStart(response, { headers: req.headers, tenantId, referenceType: 'finance_deposit_refund', referenceId: String(id) });
  }
  if (action === 'cancel_refund_request' && response.ok) {
    await withdrawApproval(tenantId, 'finance_deposit_refund', String(id), 'Refund request cancelled');
  }
  return response;
}

