/**
 * Profit Centres API — /api/finance/profit-centres
 *
 * Master table for profit centre codes. Separate from cost_centre (operational
 * cost tracking dimension) — profit centres track P&L by business unit.
 *
 * Seeded with 7 standard entries by migration 20260810000006.
 * Supports a P&L query: ?type=pl&code=PC-RENTAL&from=2026-01-01&to=2026-12-31
 *
 * Tables owned by migration 20260810000006_finance_ap_debit_notes_payment_alloc_profit_centres.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
type Row = Record<string, unknown>;

// ── GET /api/finance/profit-centres ──────────────────────────────────────────

export async function GET(req: NextRequest) {
  const sp   = req.nextUrl.searchParams;
  const type = sp.get('type'); // list | pl
  const code = sp.get('code');
  const from = sp.get('from') ?? `${new Date().getFullYear()}-01-01`;
  const to   = sp.get('to')   ?? new Date().toISOString().slice(0, 10);

  // ── P&L by profit centre ───────────────────────────────────────────────────
  if (type === 'pl') {
    // Aggregate posted journal lines by profit_centre and account type
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT
         COALESCE(jl.profit_centre, 'UNASSIGNED')   AS profit_centre,
         c.account_type,
         c.account_subtype,
         c.account_code,
         c.account_name,
         COALESCE(SUM(jl.debit_amount),0)::numeric(15,2)  AS total_debit,
         COALESCE(SUM(jl.credit_amount),0)::numeric(15,2) AS total_credit,
         CASE
           WHEN c.normal_balance = 'DEBIT'
             THEN COALESCE(SUM(jl.debit_amount - jl.credit_amount),0)
           ELSE
             COALESCE(SUM(jl.credit_amount - jl.debit_amount),0)
         END::numeric(15,2) AS balance
       FROM finance_journal_lines jl
       JOIN finance_journal_entries je ON je.id::text = jl.journal_entry_id
       JOIN finance_chart_of_accounts c ON c.account_code = jl.account_code
      WHERE je.status = 'POSTED'
        AND je.entry_date BETWEEN $1 AND $2
        AND je.deleted_at IS NULL
        AND c.is_header = FALSE
        ${code ? `AND jl.profit_centre = $3` : ''}
      GROUP BY jl.profit_centre, c.account_type, c.account_subtype,
               c.account_code, c.account_name, c.normal_balance
      ORDER BY jl.profit_centre NULLS LAST, c.account_type, c.account_code`,
      ...(code ? [from, to, code] : [from, to]),
    ).catch(() => []);

    // Roll up income vs expense per profit centre
    type PcMap = { income: number; expense: number; grossProfit?: number };
    const summary = new Map<string, PcMap>();
    for (const r of rows) {
      const pc   = String(r.profit_centre ?? 'UNASSIGNED');
      const bal  = parseFloat(String(r.balance ?? 0));
      const type = String(r.account_type ?? '');
      const entry = summary.get(pc) ?? { income: 0, expense: 0 };
      if (type === 'INCOME')  entry.income  += bal;
      if (type === 'EXPENSE') entry.expense += bal;
      summary.set(pc, entry);
    }
    const summaryRows = Array.from(summary.entries()).map(([pc, s]) => ({
      profitCentre: pc,
      totalIncome:  Math.round(s.income  * 100) / 100,
      totalExpense: Math.round(s.expense * 100) / 100,
      grossProfit:  Math.round((s.income - s.expense) * 100) / 100,
    }));

    return NextResponse.json({
      type: 'pl',
      period: { from, to },
      code: code ?? null,
      rows,
      summary: summaryRows,
    });
  }

  // ── List / master table ────────────────────────────────────────────────────
  let where = `WHERE 1=1`;
  const params: unknown[] = [];
  let pi = 1;
  const activeOnly = sp.get('activeOnly');
  const module     = sp.get('module');
  if (activeOnly === 'true') { where += ` AND is_active = TRUE`; }
  if (module)                { where += ` AND module = $${pi++}`; params.push(module); }

  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT * FROM finance_profit_centres ${where} ORDER BY module, code`,
    ...params,
  ).catch(() => []);

  return NextResponse.json({ data: rows, count: rows.length });
}

// ── POST /api/finance/profit-centres ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.code || !body.name) {
    return NextResponse.json({ error: 'code and name are required' }, { status: 400 });
  }

  const [row] = await prisma.$queryRawUnsafe<Row[]>(
    `INSERT INTO finance_profit_centres
       (code, name, description, parent_code, module, is_active, budget, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    body.code,
    body.name,
    body.description  ?? null,
    body.parentCode   ?? null,
    body.module       ?? null,
    body.isActive     ?? true,
    body.budget       ?? null,
    body.tenantId     ?? null,
  ).catch(() => []);

  if (!row) return NextResponse.json({ error: 'Failed to create profit centre' }, { status: 500 });
  return NextResponse.json(row, { status: 201 });
}

// ── PATCH /api/finance/profit-centres?code=PC-RENTAL ─────────────────────────

export async function PATCH(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (!code) return NextResponse.json({ error: 'code query param required' }, { status: 400 });

  const body    = await req.json();
  const allowed = ['name','description','parentCode','module','isActive','budget'];
  const sets: string[] = [];
  const vals: unknown[] = [];
  let pi = 1;

  for (const key of allowed) {
    if (!(key in body)) continue;
    const col = key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
    sets.push(`${col} = $${pi++}`);
    vals.push(body[key]);
  }
  if (!sets.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  sets.push(`updated_at = NOW()`);
  vals.push(code);

  await prisma.$executeRawUnsafe(
    `UPDATE finance_profit_centres SET ${sets.join(', ')} WHERE code = $${pi}`,
    ...vals,
  );
  const [updated] = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT * FROM finance_profit_centres WHERE code=$1`, code,
  ).catch(() => []);

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(updated);
}
