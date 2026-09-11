export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { addDeduction, forfeitDeposit, recordRefundDetails, executeRefund, cancelRefundRequest, SecurityDepositError } from '@/lib/finance/security-deposit';
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

      let where = 'WHERE 1=1';
      const params: unknown[] = [];
      let idx = 1;

      if (status)        { where += ` AND status = $${idx++}`;         params.push(status); }
      if (contract_type) { where += ` AND contract_type = $${idx++}`;  params.push(contract_type); }
      if (branch)        { where += ` AND branch = $${idx++}`;         params.push(branch); }
      if (aging_only)    { where += ` AND held_days > 365`; }
      if (search) {
        where += ` AND (customer_name ILIKE $${idx} OR vehicle_no ILIKE $${idx} OR deposit_no ILIKE $${idx} OR contract_id ILIKE $${idx})`;
        params.push(`%${search}%`); idx++;
      }

      const rows = await tx.$queryRawUnsafe(
        `SELECT * FROM finance_security_deposits ${where} ORDER BY created_at DESC`,
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
          COUNT(*) FILTER (WHERE held_days > 365)           AS overdue_count
        FROM finance_security_deposits
      `) as Record<string, unknown>[];

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

      // Auto-number
      const now = new Date();
      const ym  = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
      const cnt = await tx.$queryRawUnsafe(
        `SELECT COUNT(*) AS c FROM finance_security_deposits WHERE deposit_no LIKE $1`,
        `FSD-${ym}-%`
      ) as { c: bigint | number }[];
      const seq = String(Number(cnt[0].c) + 1).padStart(4, '0');
      const deposit_no = `FSD-${ym}-${seq}`;

      const rows = await tx.$queryRawUnsafe(`
        INSERT INTO finance_security_deposits
          (tenant_id, deposit_no, contract_id, contract_type, customer_name, customer_trn,
           vehicle_no, vehicle_type, branch, collected_amount, collection_date,
           collection_method, cheque_no, bank_name, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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

  return withTenantRls(prisma, tenantId, async (tx) => {
      const bRaw = await req.json();
  const b = stripTenantOwnershipFields(bRaw);
      const { id, action } = b;
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const actor = req.headers.get('x-user-id') ?? 'staff';

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
          `SELECT * FROM finance_security_deposits WHERE id = $1::uuid`, id
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
            refund_date      = $3,
            refund_method    = $4,
            refund_reference = $5,
            status           = $6,
            updated_at       = NOW()
          WHERE id = $1::uuid
          RETURNING *
        `, id, refundAmt, b.refund_date ?? new Date().toISOString().split('T')[0],
           b.refund_method ?? 'BANK_TRANSFER', b.refund_reference ?? null, newStatus
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

      const rows = await tx.$queryRawUnsafe(
        `UPDATE finance_security_deposits SET ${updates.join(', ')} WHERE id = $1::uuid RETURNING *`,
        ...vals
      ) as Record<string, unknown>[];
      if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
      return NextResponse.json(row(rows[0]));
  });
}

