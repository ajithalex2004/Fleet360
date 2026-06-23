import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertCanWrite } from '@/lib/access-control';
import { requireOperationalContext } from '@/lib/cross-module-governance';

async function bootstrap() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS finance_security_deposits (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      deposit_no       TEXT UNIQUE NOT NULL,
      contract_id      TEXT NOT NULL,
      contract_type    TEXT NOT NULL DEFAULT 'LEASE',
      customer_name    TEXT NOT NULL,
      customer_trn     TEXT,
      vehicle_no       TEXT NOT NULL,
      vehicle_type     TEXT,
      branch           TEXT NOT NULL DEFAULT 'Dubai',
      collected_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      collection_date  DATE NOT NULL,
      collection_method TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
      cheque_no        TEXT,
      bank_name        TEXT,
      status           TEXT NOT NULL DEFAULT 'HELD',
      deductions       JSONB NOT NULL DEFAULT '[]',
      total_deducted   NUMERIC(14,2) NOT NULL DEFAULT 0,
      refund_amount    NUMERIC(14,2),
      refund_date      DATE,
      refund_method    TEXT,
      refund_reference TEXT,
      held_days        INTEGER GENERATED ALWAYS AS (
        CASE WHEN refund_date IS NOT NULL
          THEN (refund_date - collection_date)
          ELSE (CURRENT_DATE - collection_date)
        END
      ) STORED,
      forfeiture_reason TEXT,
      notes            TEXT,
      tenant_id        TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_security_deposits ADD COLUMN IF NOT EXISTS tenant_id TEXT
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_fsd_contract ON finance_security_deposits(contract_id);
    CREATE INDEX IF NOT EXISTS idx_fsd_status   ON finance_security_deposits(status);
    CREATE INDEX IF NOT EXISTS idx_fsd_branch   ON finance_security_deposits(branch);
  `).catch(() => {});
}

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
    held_days:        Number(r.held_days ?? 0),
    forfeiture_reason: r.forfeiture_reason,
    notes:            r.notes,
    created_at:       r.created_at,
    updated_at:       r.updated_at,
  };
}

export async function GET(req: NextRequest) {
  await bootstrap();
  const ctx = requireOperationalContext(req, 'finance', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;
  const p = req.nextUrl.searchParams;
  const status       = p.get('status');
  const contract_type = p.get('contract_type');
  const branch       = p.get('branch');
  const search       = p.get('search');
  const aging_only   = p.get('aging_only') === 'true'; // held > 365 days

  let where = 'WHERE tenant_id::text = $1';
  const params: unknown[] = [ctx.tenantId];
  let idx = 2;

  if (status)        { where += ` AND status = $${idx++}`;         params.push(status); }
  if (contract_type) { where += ` AND contract_type = $${idx++}`;  params.push(contract_type); }
  if (branch)        { where += ` AND branch = $${idx++}`;         params.push(branch); }
  if (aging_only)    { where += ` AND held_days > 365`; }
  if (search) {
    where += ` AND (customer_name ILIKE $${idx} OR vehicle_no ILIKE $${idx} OR deposit_no ILIKE $${idx} OR contract_id ILIKE $${idx})`;
    params.push(`%${search}%`); idx++;
  }

  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM finance_security_deposits ${where} ORDER BY created_at DESC`,
    ...params
  ) as Record<string, unknown>[];

  // KPI summary
  const kpi = await prisma.$queryRawUnsafe(`
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
    WHERE tenant_id::text = $1
  `, ctx.tenantId) as Record<string, unknown>[];

  return NextResponse.json({ deposits: rows.map(row), kpi: kpi[0] });
}

export async function POST(req: NextRequest) {
  const guard = assertCanWrite(req, 'finance');
  if (guard) return guard;
  await bootstrap();
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const b = await req.json();

  // Auto-number
  const now = new Date();
  const ym  = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const cnt = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM finance_security_deposits WHERE deposit_no LIKE $1`,
    `FSD-${ym}-%`
  ) as { c: bigint | number }[];
  const seq = String(Number(cnt[0].c) + 1).padStart(4, '0');
  const deposit_no = `FSD-${ym}-${seq}`;

  const rows = await prisma.$queryRawUnsafe(`
    INSERT INTO finance_security_deposits
      (deposit_no, contract_id, contract_type, customer_name, customer_trn,
       vehicle_no, vehicle_type, branch, collected_amount, collection_date,
       collection_method, cheque_no, bank_name, notes, tenant_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *
  `,
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
    ctx.tenantId,
  ) as Record<string, unknown>[];

  return NextResponse.json(row(rows[0]), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const guard = assertCanWrite(req, 'finance');
  if (guard) return guard;
  await bootstrap();
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const b = await req.json();
  const { id, action } = b;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // ── Add Deduction ─────────────────────────────────────────────────────────
  if (action === 'add_deduction') {
    const deduction = {
      id:          crypto.randomUUID(),
      description: b.description,
      amount:      Number(b.amount),
      date:        b.date ?? new Date().toISOString().split('T')[0],
      category:    b.category ?? 'DAMAGE',
    };
    const rows = await prisma.$queryRawUnsafe(`
      UPDATE finance_security_deposits
      SET
        deductions     = deductions || $2::jsonb,
        total_deducted = total_deducted + $3,
        status         = CASE
          WHEN (collected_amount - total_deducted - $3) <= 0 THEN 'FORFEITED'
          ELSE 'PARTIALLY_REFUNDED'
        END,
        updated_at     = NOW()
      WHERE id = $1::uuid
        AND tenant_id::text = $4
      RETURNING *
    `, id, JSON.stringify([deduction]), Number(b.amount), ctx.tenantId) as Record<string, unknown>[];
    if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(row(rows[0]));
  }

  // ── Process Refund ────────────────────────────────────────────────────────
  if (action === 'refund') {
    const current = await prisma.$queryRawUnsafe(
      `SELECT * FROM finance_security_deposits WHERE id = $1::uuid AND tenant_id::text = $2`, id, ctx.tenantId
    ) as Record<string, unknown>[];
    if (!current.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const dep = current[0];
    const refundAmt = Number(b.refund_amount ?? (Number(dep.collected_amount) - Number(dep.total_deducted)));
    const newStatus = refundAmt >= (Number(dep.collected_amount) - Number(dep.total_deducted))
      ? 'FULLY_REFUNDED' : 'PARTIALLY_REFUNDED';

    const rows = await prisma.$queryRawUnsafe(`
      UPDATE finance_security_deposits
      SET
        refund_amount    = $2,
        refund_date      = $3,
        refund_method    = $4,
        refund_reference = $5,
        status           = $6,
        updated_at       = NOW()
      WHERE id = $1::uuid
        AND tenant_id::text = $7
      RETURNING *
    `, id, refundAmt, b.refund_date ?? new Date().toISOString().split('T')[0],
       b.refund_method ?? 'BANK_TRANSFER', b.refund_reference ?? null, newStatus, ctx.tenantId
    ) as Record<string, unknown>[];
    return NextResponse.json(row(rows[0]));
  }

  // ── Forfeit ───────────────────────────────────────────────────────────────
  if (action === 'forfeit') {
    const rows = await prisma.$queryRawUnsafe(`
      UPDATE finance_security_deposits
      SET status = 'FORFEITED', forfeiture_reason = $2, updated_at = NOW()
      WHERE id = $1::uuid AND tenant_id::text = $3
      RETURNING *
    `, id, b.forfeiture_reason ?? 'Contract default', ctx.tenantId) as Record<string, unknown>[];
    return NextResponse.json(row(rows[0]));
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

  const rows = await prisma.$queryRawUnsafe(
    `UPDATE finance_security_deposits SET ${updates.join(', ')} WHERE id = $1::uuid AND tenant_id::text = $${pi} RETURNING *`,
    ...vals,
    ctx.tenantId,
  ) as Record<string, unknown>[];
  if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(row(rows[0]));
}
