import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

async function bootstrap() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS finance_recurring_schedules (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      schedule_no      TEXT UNIQUE NOT NULL,
      contract_id      TEXT NOT NULL,
      contract_type    TEXT NOT NULL DEFAULT 'LEASE',
      customer_name    TEXT NOT NULL,
      customer_trn     TEXT,
      vehicle_no       TEXT NOT NULL,
      branch           TEXT NOT NULL DEFAULT 'Dubai',
      billing_cycle    TEXT NOT NULL DEFAULT 'MONTHLY',
      amount           NUMERIC(14,2) NOT NULL,
      vat_rate         NUMERIC(5,2)  NOT NULL DEFAULT 5,
      vat_amount       NUMERIC(14,2) GENERATED ALWAYS AS (ROUND(amount * vat_rate / 100, 2)) STORED,
      grand_total      NUMERIC(14,2) GENERATED ALWAYS AS (amount + ROUND(amount * vat_rate / 100, 2)) STORED,
      start_date       DATE NOT NULL,
      end_date         DATE,
      next_invoice_date DATE NOT NULL,
      last_invoice_date DATE,
      invoices_generated INTEGER NOT NULL DEFAULT 0,
      auto_approve     BOOLEAN NOT NULL DEFAULT FALSE,
      status           TEXT NOT NULL DEFAULT 'ACTIVE',
      description      TEXT,
      notes            TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS finance_recurring_log (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      schedule_id     UUID NOT NULL REFERENCES finance_recurring_schedules(id) ON DELETE CASCADE,
      invoice_id      TEXT,
      invoice_no      TEXT,
      period_start    DATE NOT NULL,
      period_end      DATE NOT NULL,
      amount          NUMERIC(14,2) NOT NULL,
      vat_amount      NUMERIC(14,2) NOT NULL,
      grand_total     NUMERIC(14,2) NOT NULL,
      status          TEXT NOT NULL DEFAULT 'DRAFT',
      triggered_by    TEXT NOT NULL DEFAULT 'MANUAL',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_frs_next_date ON finance_recurring_schedules(next_invoice_date);
    CREATE INDEX IF NOT EXISTS idx_frs_status    ON finance_recurring_schedules(status);
    CREATE INDEX IF NOT EXISTS idx_frl_schedule  ON finance_recurring_log(schedule_id);
  `).catch(() => {});
}

function toStr(v: unknown) {
  if (v instanceof Buffer) return v.toString('hex');
  return String(v ?? '');
}

function scheduleRow(r: Record<string, unknown>) {
  return {
    id:               toStr(r.id),
    schedule_no:      r.schedule_no,
    contract_id:      r.contract_id,
    contract_type:    r.contract_type,
    customer_name:    r.customer_name,
    customer_trn:     r.customer_trn,
    vehicle_no:       r.vehicle_no,
    branch:           r.branch,
    billing_cycle:    r.billing_cycle,
    amount:           Number(r.amount),
    vat_rate:         Number(r.vat_rate),
    vat_amount:       Number(r.vat_amount),
    grand_total:      Number(r.grand_total),
    start_date:       r.start_date,
    end_date:         r.end_date,
    next_invoice_date: r.next_invoice_date,
    last_invoice_date: r.last_invoice_date,
    invoices_generated: Number(r.invoices_generated),
    auto_approve:     r.auto_approve,
    status:           r.status,
    description:      r.description,
    notes:            r.notes,
    created_at:       r.created_at,
    updated_at:       r.updated_at,
  };
}

function logRow(r: Record<string, unknown>) {
  return {
    id:           toStr(r.id),
    schedule_id:  toStr(r.schedule_id),
    invoice_id:   r.invoice_id,
    invoice_no:   r.invoice_no,
    period_start: r.period_start,
    period_end:   r.period_end,
    amount:       Number(r.amount),
    vat_amount:   Number(r.vat_amount),
    grand_total:  Number(r.grand_total),
    status:       r.status,
    triggered_by: r.triggered_by,
    created_at:   r.created_at,
  };
}

function nextDateAfter(current: Date, cycle: string): Date {
  const d = new Date(current);
  switch (cycle) {
    case 'WEEKLY':      d.setDate(d.getDate() + 7);     break;
    case 'MONTHLY':     d.setMonth(d.getMonth() + 1);   break;
    case 'QUARTERLY':   d.setMonth(d.getMonth() + 3);   break;
    case 'ANNUAL':      d.setFullYear(d.getFullYear() + 1); break;
    default:            d.setMonth(d.getMonth() + 1);
  }
  return d;
}

export async function GET(req: NextRequest) {
  await bootstrap();
  const p = req.nextUrl.searchParams;
  const status        = p.get('status');
  const billing_cycle = p.get('billing_cycle');
  const due_today     = p.get('due_today') === 'true';
  const schedule_id   = p.get('schedule_id'); // fetch log for a schedule
  const search        = p.get('search');

  if (schedule_id) {
    const logs = await prisma.$queryRawUnsafe(
      `SELECT * FROM finance_recurring_log WHERE schedule_id = $1::uuid ORDER BY created_at DESC`,
      schedule_id
    ) as Record<string, unknown>[];
    return NextResponse.json({ logs: logs.map(logRow) });
  }

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let idx = 1;

  if (status)        { where += ` AND status = $${idx++}`;         params.push(status); }
  if (billing_cycle) { where += ` AND billing_cycle = $${idx++}`;  params.push(billing_cycle); }
  if (due_today)     { where += ` AND next_invoice_date <= CURRENT_DATE AND status = 'ACTIVE'`; }
  if (search) {
    where += ` AND (customer_name ILIKE $${idx} OR vehicle_no ILIKE $${idx} OR schedule_no ILIKE $${idx} OR contract_id ILIKE $${idx})`;
    params.push(`%${search}%`); idx++;
  }

  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM finance_recurring_schedules ${where} ORDER BY next_invoice_date ASC`,
    ...params
  ) as Record<string, unknown>[];

  // KPIs
  const kpi = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)                                              AS total,
      COUNT(*) FILTER (WHERE status = 'ACTIVE')            AS active_count,
      COUNT(*) FILTER (WHERE status = 'PAUSED')            AS paused_count,
      COUNT(*) FILTER (WHERE status = 'CANCELLED')         AS cancelled_count,
      COUNT(*) FILTER (WHERE next_invoice_date <= CURRENT_DATE AND status = 'ACTIVE') AS due_today,
      COALESCE(SUM(grand_total) FILTER (WHERE status = 'ACTIVE'), 0) AS monthly_value,
      COALESCE(SUM(invoices_generated), 0)                 AS total_invoices_generated
    FROM finance_recurring_schedules
  `) as Record<string, unknown>[];

  return NextResponse.json({ schedules: rows.map(scheduleRow), kpi: kpi[0] });
}

export async function POST(req: NextRequest) {
  await bootstrap();
  const b = await req.json();

  if (b.action === 'generate') {
    // ── Generate Now ─────────────────────────────────────────────────────────
    const id = b.schedule_id;
    const schRows = await prisma.$queryRawUnsafe(
      `SELECT * FROM finance_recurring_schedules WHERE id = $1::uuid AND status = 'ACTIVE'`, id
    ) as Record<string, unknown>[];
    if (!schRows.length) return NextResponse.json({ error: 'schedule not found or not active' }, { status: 404 });
    const sch = schRows[0];

    const now    = new Date();
    const ym     = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const invCnt = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS c FROM finance_invoices WHERE invoice_no LIKE $1`,
      `INV-${ym}-%`
    ).catch(() => [{ c: 0 }]) as { c: bigint | number }[];
    const invSeq    = String(Number(invCnt[0].c) + 1).padStart(4, '0');
    const invoice_no = `INV-${ym}-${invSeq}`;

    const periodStart = new Date(sch.next_invoice_date as string);
    const periodEnd   = nextDateAfter(periodStart, sch.billing_cycle as string);
    periodEnd.setDate(periodEnd.getDate() - 1);

    const triggered_by = b.triggered_by ?? 'MANUAL';
    const draftStatus  = (sch.auto_approve as boolean) ? 'APPROVED' : 'DRAFT';

    // Insert into finance_invoices (graceful if table doesn't exist yet)
    let invoice_id: string | null = null;
    try {
      const invRows = await prisma.$queryRawUnsafe(`
        INSERT INTO finance_invoices
          (invoice_no, customer_name, customer_trn, branch, invoice_date, due_date,
           subtotal, vat_amount, total_amount, status, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id
      `,
        invoice_no, sch.customer_name, sch.customer_trn ?? null, sch.branch,
        periodStart.toISOString().split('T')[0],
        periodEnd.toISOString().split('T')[0],
        Number(sch.amount), Number(sch.vat_amount), Number(sch.grand_total),
        draftStatus,
        `Auto-generated by recurring schedule ${sch.schedule_no}`
      ) as { id: Buffer | string }[];
      invoice_id = invRows[0]?.id ? toStr(invRows[0].id) : null;
    } catch {
      // finance_invoices may not exist — log only
    }

    // Log entry
    await prisma.$executeRawUnsafe(`
      INSERT INTO finance_recurring_log
        (schedule_id, invoice_id, invoice_no, period_start, period_end,
         amount, vat_amount, grand_total, status, triggered_by)
      VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `,
      id, invoice_id, invoice_no,
      periodStart.toISOString().split('T')[0],
      periodEnd.toISOString().split('T')[0],
      Number(sch.amount), Number(sch.vat_amount), Number(sch.grand_total),
      draftStatus, triggered_by
    );

    // Advance schedule
    const nextDate = nextDateAfter(periodStart, sch.billing_cycle as string);
    await prisma.$executeRawUnsafe(`
      UPDATE finance_recurring_schedules
      SET
        last_invoice_date  = $2,
        next_invoice_date  = $3,
        invoices_generated = invoices_generated + 1,
        updated_at         = NOW()
      WHERE id = $1::uuid
    `, id, periodStart.toISOString().split('T')[0], nextDate.toISOString().split('T')[0]);

    return NextResponse.json({ invoice_no, invoice_id, period_start: periodStart, period_end: periodEnd, status: draftStatus });
  }

  // ── Create new schedule ───────────────────────────────────────────────────
  const now = new Date();
  const ym  = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const cnt = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM finance_recurring_schedules WHERE schedule_no LIKE $1`,
    `FRS-${ym}-%`
  ) as { c: bigint | number }[];
  const seq         = String(Number(cnt[0].c) + 1).padStart(4, '0');
  const schedule_no = `FRS-${ym}-${seq}`;

  const rows = await prisma.$queryRawUnsafe(`
    INSERT INTO finance_recurring_schedules
      (schedule_no, contract_id, contract_type, customer_name, customer_trn,
       vehicle_no, branch, billing_cycle, amount, vat_rate,
       start_date, end_date, next_invoice_date, auto_approve, description, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING *
  `,
    schedule_no,
    b.contract_id,
    b.contract_type ?? 'LEASE',
    b.customer_name,
    b.customer_trn ?? null,
    b.vehicle_no,
    b.branch ?? 'Dubai',
    b.billing_cycle ?? 'MONTHLY',
    b.amount,
    b.vat_rate ?? 5,
    b.start_date,
    b.end_date ?? null,
    b.next_invoice_date ?? b.start_date,
    b.auto_approve ?? false,
    b.description ?? null,
    b.notes ?? null,
  ) as Record<string, unknown>[];

  return NextResponse.json(scheduleRow(rows[0]), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  await bootstrap();
  const b = await req.json();
  const { id, action } = b;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  if (action === 'pause') {
    const rows = await prisma.$queryRawUnsafe(
      `UPDATE finance_recurring_schedules SET status='PAUSED', updated_at=NOW() WHERE id=$1::uuid RETURNING *`, id
    ) as Record<string, unknown>[];
    return NextResponse.json(scheduleRow(rows[0]));
  }
  if (action === 'resume') {
    const rows = await prisma.$queryRawUnsafe(
      `UPDATE finance_recurring_schedules SET status='ACTIVE', updated_at=NOW() WHERE id=$1::uuid RETURNING *`, id
    ) as Record<string, unknown>[];
    return NextResponse.json(scheduleRow(rows[0]));
  }
  if (action === 'cancel') {
    const rows = await prisma.$queryRawUnsafe(
      `UPDATE finance_recurring_schedules SET status='CANCELLED', updated_at=NOW() WHERE id=$1::uuid RETURNING *`, id
    ) as Record<string, unknown>[];
    return NextResponse.json(scheduleRow(rows[0]));
  }

  const allowed = ['contract_id','contract_type','customer_name','customer_trn','vehicle_no',
    'branch','billing_cycle','amount','vat_rate','start_date','end_date',
    'next_invoice_date','auto_approve','description','notes'];
  const updates: string[] = [];
  const vals: unknown[]   = [id];
  let pi = 2;
  for (const key of allowed) {
    if (key in b) { updates.push(`${key} = $${pi++}`); vals.push(b[key]); }
  }
  if (!updates.length) return NextResponse.json({ error: 'no fields' }, { status: 400 });
  updates.push('updated_at = NOW()');

  const rows = await prisma.$queryRawUnsafe(
    `UPDATE finance_recurring_schedules SET ${updates.join(', ')} WHERE id = $1::uuid RETURNING *`,
    ...vals
  ) as Record<string, unknown>[];
  if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(scheduleRow(rows[0]));
}
