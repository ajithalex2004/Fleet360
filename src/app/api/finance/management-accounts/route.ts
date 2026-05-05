/**
 * Management Accounts API — /api/finance/management-accounts
 *
 * type=income_statement   Income Statement (P&L) with optional comparison period
 * type=cash_flow          Cash Flow Statement (Indirect Method)
 * type=module_breakdown   Revenue breakdown by business module
 *
 * Query params:
 *   from, to            Current period dates (YYYY-MM-DD)
 *   compFrom, compTo    Comparison period dates (enables side-by-side comparison)
 *   tenantId            Scope to tenant
 *   modules             Comma-separated module filter (RAC,LEASING,LOGISTICS,SCHOOL_BUS)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function toN(v: unknown): number { return parseFloat(String(v ?? 0)) || 0; }

// ── Core query helpers (param-based so they can run for two periods) ──────────

async function queryGL(from: string, to: string, tenantId: string | null) {
  const params: unknown[] = [from, to];
  const tenantFilter = tenantId ? ` AND je.tenant_id = $3` : '';
  if (tenantId) params.push(tenantId);

  const [glCheck] = await (prisma.$queryRawUnsafe as (...a: unknown[]) => Promise<{ count: string }[]>)(
    `SELECT COUNT(*)::text AS count FROM finance_journal_entries
     WHERE status='POSTED' AND entry_date BETWEEN $1 AND $2${tenantId ? ` AND tenant_id = $3` : ''}`,
    ...(tenantId ? [from, to, tenantId] : [from, to])
  ).catch(() => [{ count: '0' }]);
  const hasGlData = parseInt(glCheck?.count ?? '0') > 0;

  if (!hasGlData) return { revenues: null, expenses: null };

  const revRows = await (prisma.$queryRawUnsafe as (...a: unknown[]) => Promise<{
    account_code: string; account_name: string; account_subtype: string; amount: string
  }[]>)(
    `SELECT jl.account_code, c.account_name, COALESCE(c.account_subtype,'REVENUE') AS account_subtype,
       COALESCE(SUM(jl.credit_amount - jl.debit_amount),0)::text AS amount
     FROM finance_journal_lines jl
     JOIN finance_journal_entries je ON je.id::text = jl.journal_entry_id
     JOIN finance_chart_of_accounts c ON c.account_code = jl.account_code
     WHERE je.status='POSTED' AND je.entry_date BETWEEN $1 AND $2
       AND jl.account_code LIKE '4%'${tenantFilter}
     GROUP BY jl.account_code, c.account_name, c.account_subtype
     ORDER BY jl.account_code`,
    ...params
  ).catch(() => []);

  const expRows = await (prisma.$queryRawUnsafe as (...a: unknown[]) => Promise<{
    account_code: string; account_name: string; account_subtype: string; amount: string
  }[]>)(
    `SELECT jl.account_code, c.account_name, COALESCE(c.account_subtype,'OPEX') AS account_subtype,
       COALESCE(SUM(jl.debit_amount - jl.credit_amount),0)::text AS amount
     FROM finance_journal_lines jl
     JOIN finance_journal_entries je ON je.id::text = jl.journal_entry_id
     JOIN finance_chart_of_accounts c ON c.account_code = jl.account_code
     WHERE je.status='POSTED' AND je.entry_date BETWEEN $1 AND $2
       AND jl.account_code LIKE '5%'${tenantFilter}
     GROUP BY jl.account_code, c.account_name, c.account_subtype
     ORDER BY jl.account_code`,
    ...params
  ).catch(() => []);

  return {
    revenues: revRows.map(r => ({ label: r.account_name, code: r.account_code, amount: toN(r.amount) })),
    expenses: expRows.map(r => ({ label: r.account_name, code: r.account_code, amount: toN(r.amount), subtype: r.account_subtype })),
  };
}

async function getRevenue(
  from: string, to: string, tenantId: string | null,
  activeModules: string[], glRevenues: { label: string; code: string; amount: number }[] | null
) {
  if (glRevenues !== null) return glRevenues;

  const q = async (sql: string, ...p: unknown[]): Promise<number> => {
    const [r] = await (prisma.$queryRawUnsafe as (...a: unknown[]) => Promise<{ t: string }[]>)(sql, ...p).catch(() => [{ t: '0' }]);
    return toN(r?.t);
  };

  const tp = (extra: unknown[] = []) => tenantId ? [...extra, tenantId] : extra;
  const tc = (len: number) => tenantId ? ` AND tenant_id = $${len + 1}` : '';
  const enabled = (m: string) => !activeModules.length || activeModules.includes(m);

  const [racAmt, lsAmt, lgAmt, fiAmt] = await Promise.all([
    enabled('RAC')
      ? q(`SELECT COALESCE(SUM(total_amount),0)::text AS t FROM rental_invoices WHERE deleted_at IS NULL AND created_at::date BETWEEN $1 AND $2${tc(2)}`, ...tp([from, to]))
      : Promise.resolve(0),
    enabled('LEASING')
      ? q(`SELECT COALESCE(SUM(total_amount),0)::text AS t FROM lease_invoices WHERE deleted_at IS NULL AND created_at::date BETWEEN $1 AND $2${tc(2)}`, ...tp([from, to]))
      : Promise.resolve(0),
    enabled('LOGISTICS')
      ? q(`SELECT COALESCE(SUM(total_amount),0)::text AS t FROM logistics_bookings WHERE deleted_at IS NULL AND status IN ('DELIVERED','CLOSED') AND created_at::date BETWEEN $1 AND $2${tc(2)}`, ...tp([from, to]))
      : Promise.resolve(0),
    q(`SELECT COALESCE(SUM(total_amount),0)::text AS t FROM finance_invoices WHERE deleted_at IS NULL AND payment_status NOT IN ('DRAFT','CANCELLED') AND invoice_number NOT LIKE 'SUB-%' AND issue_date BETWEEN $1 AND $2${tc(2)}`, ...tp([from, to])),
  ]);

  return [
    { label: 'Rent-A-Car (RAC) Revenue',   code: '4100', amount: racAmt },
    { label: 'Vehicle Leasing Revenue',      code: '4200', amount: lsAmt },
    { label: 'Logistics & Freight Revenue',  code: '4300', amount: lgAmt },
    { label: 'Other Service Revenue',        code: '4700', amount: fiAmt },
  ].filter(r => r.amount > 0);
}

async function getExpenses(
  from: string, to: string, tenantId: string | null,
  glExpenses: { label: string; code: string; amount: number; subtype: string }[] | null
): Promise<{ label: string; code: string; amount: number; subtype: string }[]> {
  if (glExpenses !== null) return glExpenses;

  const q = async (sql: string, ...p: unknown[]): Promise<number> => {
    const [r] = await (prisma.$queryRawUnsafe as (...a: unknown[]) => Promise<{ t: string }[]>)(sql, ...p).catch(() => [{ t: '0' }]);
    return toN(r?.t);
  };
  const tp = (extra: unknown[] = []) => tenantId ? [...extra, tenantId] : extra;
  const tc = (len: number) => tenantId ? ` AND tenant_id = $${len + 1}` : '';

  const [fuelAmt, maintAmt, expAmt] = await Promise.all([
    q(`SELECT COALESCE(SUM(total_cost),0)::text AS t FROM fuel_logs WHERE created_at::date BETWEEN $1 AND $2${tc(2)}`, ...tp([from, to])),
    q(`SELECT COALESCE(SUM(total_cost),0)::text AS t FROM maintenance_requests WHERE deleted_at IS NULL AND status='COMPLETED' AND created_at::date BETWEEN $1 AND $2${tc(2)}`, ...tp([from, to])),
    q(`SELECT COALESCE(SUM(total_amount),0)::text AS t FROM finance_expenses WHERE deleted_at IS NULL AND status IN ('APPROVED','PAID') AND expense_date BETWEEN $1 AND $2${tc(2)}`, ...tp([from, to])),
  ]);

  let depAmt = 0;
  if (!tenantId) {
    depAmt = await q(
      `SELECT COALESCE(SUM(depreciation),0)::text AS t FROM finance_depreciation_schedule WHERE period_year || '-' || LPAD(period_month::text,2,'0') || '-01' BETWEEN $1 AND $2`,
      from, to
    );
  } else {
    depAmt = await q(
      `SELECT COALESCE(SUM(ds.depreciation),0)::text AS t
       FROM finance_depreciation_schedule ds
       JOIN finance_fixed_assets fa ON fa.id = ds.asset_id
       WHERE fa.tenant_id = $1 AND ds.period_year || '-' || LPAD(ds.period_month::text,2,'0') || '-01' BETWEEN $2 AND $3`,
      tenantId, from, to
    );
  }

  return [
    { label: 'Fuel & Lubricants',            code: '5110', amount: fuelAmt,  subtype: 'COGS' },
    { label: 'Vehicle Maintenance & Repairs', code: '5120', amount: maintAmt, subtype: 'COGS' },
    { label: 'Fleet Depreciation',            code: '5150', amount: depAmt,   subtype: 'COGS' },
    { label: 'Operating Expenses',            code: '5300', amount: expAmt,   subtype: 'OPEX' },
  ].filter(r => r.amount > 0);
}

type RevLine  = { label: string; code: string; amount: number };
type ExpLine  = { label: string; code: string; amount: number; subtype: string };

function computeIncomeSummary(revenues: RevLine[], expenses: ExpLine[]) {
  const totalRevenue    = revenues.reduce((s, r) => s + r.amount, 0);
  const cogsExpenses    = expenses.filter(e => e.subtype === 'COGS');
  const opexExpenses    = expenses.filter(e => e.subtype === 'OPEX');
  const financeExpenses = expenses.filter(e => e.subtype === 'FINANCE');
  const taxExpenses     = expenses.filter(e => e.subtype === 'TAX');
  const totalCOGS       = cogsExpenses.reduce((s, e) => s + e.amount, 0);
  const grossProfit     = totalRevenue - totalCOGS;
  const totalOPEX       = opexExpenses.reduce((s, e) => s + e.amount, 0);
  const ebitda          = grossProfit - totalOPEX;
  const depreciation    = expenses.find(e => e.code === '5150')?.amount ?? 0;
  const ebit            = ebitda - depreciation;
  const totalFinance    = financeExpenses.reduce((s, e) => s + e.amount, 0);
  const ebt             = ebit - totalFinance;
  const totalTax        = taxExpenses.reduce((s, e) => s + e.amount, 0);
  const netProfit       = ebt - totalTax;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
  return {
    revenues, expenses: { cogs: cogsExpenses, opex: opexExpenses, finance: financeExpenses, tax: taxExpenses },
    summary: {
      totalRevenue:      r2(totalRevenue),
      totalCOGS:         r2(totalCOGS),
      grossProfit:       r2(grossProfit),
      grossMarginPct:    pct(grossProfit, totalRevenue),
      totalOPEX:         r2(totalOPEX),
      ebitda:            r2(ebitda),
      ebitdaMarginPct:   pct(ebitda, totalRevenue),
      depreciation:      r2(depreciation),
      ebit:              r2(ebit),
      totalFinanceCosts: r2(totalFinance),
      ebt:               r2(ebt),
      totalTax:          r2(totalTax),
      netProfit:         r2(netProfit),
      netMarginPct:      pct(netProfit, totalRevenue),
    },
    vat: {
      outputVat: r2(totalRevenue * 0.05),
      inputVat:  r2((expenses.find(e => e.code === '5110')?.amount ?? 0) * 0.05 + (expenses.find(e => e.code === '5120')?.amount ?? 0) * 0.05),
      netVat:    r2(totalRevenue * 0.05 - ((expenses.find(e => e.code === '5110')?.amount ?? 0) + (expenses.find(e => e.code === '5120')?.amount ?? 0)) * 0.05),
    },
  };
}

async function buildPeriod(
  from: string, to: string, tenantId: string | null, activeModules: string[]
) {
  const gl = await queryGL(from, to, tenantId);
  const [revenues, expenses] = await Promise.all([
    getRevenue(from, to, tenantId, activeModules, gl.revenues ?? null),
    getExpenses(from, to, tenantId, gl.expenses ?? null),
  ]);
  return { revenues, expenses, source: gl.revenues !== null ? 'GL' : 'MODULE_DATA' as const };
}

export async function GET(req: NextRequest) {
  const sp   = req.nextUrl.searchParams;
  const type = sp.get('type') ?? 'income_statement';
  const from = sp.get('from') ?? `${new Date().getFullYear()}-01-01`;
  const to   = sp.get('to')   ?? new Date().toISOString().slice(0, 10);
  const compFrom = sp.get('compFrom');
  const compTo   = sp.get('compTo');

  const rawTenantId  = sp.get('tenantId');
  const tenantId     = rawTenantId ? rawTenantId.replace(/[^a-zA-Z0-9_-]/g, '') : null;
  const modulesParam = sp.get('modules');
  const activeModules = modulesParam
    ? modulesParam.split(',').map(m => m.trim().toUpperCase()).filter(Boolean)
    : [];

  // ── Module Breakdown ───────────────────────────────────────────────────────
  if (type === 'module_breakdown') {
    const q = async (sql: string, ...p: unknown[]): Promise<number> => {
      const [r] = await (prisma.$queryRawUnsafe as (...a: unknown[]) => Promise<{ t: string }[]>)(sql, ...p).catch(() => [{ t: '0' }]);
      return toN(r?.t);
    };
    const tp = (extra: unknown[] = []) => tenantId ? [...extra, tenantId] : extra;
    const tc = (len: number) => tenantId ? ` AND tenant_id = $${len + 1}` : '';

    const [racAmt, lsAmt, lgAmt, fiAmt, schoolAmt] = await Promise.all([
      q(`SELECT COALESCE(SUM(total_amount),0)::text AS t FROM rental_invoices WHERE deleted_at IS NULL AND created_at::date BETWEEN $1 AND $2${tc(2)}`, ...tp([from, to])),
      q(`SELECT COALESCE(SUM(total_amount),0)::text AS t FROM lease_invoices WHERE deleted_at IS NULL AND created_at::date BETWEEN $1 AND $2${tc(2)}`, ...tp([from, to])),
      q(`SELECT COALESCE(SUM(total_amount),0)::text AS t FROM logistics_bookings WHERE deleted_at IS NULL AND status IN ('DELIVERED','CLOSED') AND created_at::date BETWEEN $1 AND $2${tc(2)}`, ...tp([from, to])),
      q(`SELECT COALESCE(SUM(total_amount),0)::text AS t FROM finance_invoices WHERE deleted_at IS NULL AND payment_status NOT IN ('DRAFT','CANCELLED') AND invoice_number NOT LIKE 'SUB-%' AND module NOT IN ('RAC','LEASING','LOGISTICS','SCHOOL_BUS') AND issue_date BETWEEN $1 AND $2${tc(2)}`, ...tp([from, to])),
      q(`SELECT COALESCE(SUM(total_amount),0)::text AS t FROM finance_invoices WHERE deleted_at IS NULL AND payment_status NOT IN ('DRAFT','CANCELLED') AND module = 'SCHOOL_BUS' AND issue_date BETWEEN $1 AND $2${tc(2)}`, ...tp([from, to])),
    ]);

    const modules = [
      { module: 'RAC',        label: 'Rent-A-Car',        amount: racAmt,    color: '#6366f1' },
      { module: 'LEASING',    label: 'Vehicle Leasing',   amount: lsAmt,     color: '#8b5cf6' },
      { module: 'LOGISTICS',  label: 'Logistics & Freight', amount: lgAmt,   color: '#06b6d4' },
      { module: 'SCHOOL_BUS', label: 'School Bus Fees',   amount: schoolAmt, color: '#f59e0b' },
      { module: 'OTHER',      label: 'Other Services',    amount: fiAmt,     color: '#10b981' },
    ].filter(m => m.amount > 0);

    const total = modules.reduce((s, m) => s + m.amount, 0);
    return NextResponse.json({
      type: 'module_breakdown',
      period: { from, to },
      total,
      modules: modules.map(m => ({
        ...m,
        pct: total > 0 ? Math.round((m.amount / total) * 1000) / 10 : 0,
      })),
    });
  }

  // ── Income Statement ───────────────────────────────────────────────────────
  if (type === 'income_statement') {
    const current = await buildPeriod(from, to, tenantId, activeModules);
    const currentResult = computeIncomeSummary(current.revenues, current.expenses);

    let comparisonResult = null;
    if (compFrom && compTo) {
      const comp = await buildPeriod(compFrom, compTo, tenantId, activeModules);
      comparisonResult = computeIncomeSummary(comp.revenues, comp.expenses);
    }

    return NextResponse.json({
      type: 'income_statement',
      period: { from, to },
      compPeriod: compFrom && compTo ? { from: compFrom, to: compTo } : null,
      source: current.source,
      tenantId: tenantId ?? null,
      modules: activeModules.length > 0 ? activeModules : null,
      ...currentResult,
      comparison: comparisonResult,
    });
  }

  // ── Cash Flow Statement (Indirect Method) ─────────────────────────────────
  const current = await buildPeriod(from, to, tenantId, activeModules);
  const revenues = current.revenues;
  const expenses = current.expenses;
  const totalRevenue  = revenues.reduce((s, r) => s + r.amount, 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const depreciation  = expenses.find(e => e.code === '5150')?.amount ?? 0;
  const netProfit     = totalRevenue - totalExpenses;
  const r2 = (n: number) => Math.round(n * 100) / 100;

  const q = async (sql: string, ...p: unknown[]): Promise<number> => {
    const [r] = await (prisma.$queryRawUnsafe as (...a: unknown[]) => Promise<{ t: string }[]>)(sql, ...p).catch(() => [{ t: '0' }]);
    return toN(r?.t);
  };
  const tp = (extra: unknown[] = []) => tenantId ? [...extra, tenantId] : extra;
  const tc = (len: number) => tenantId ? ` AND tenant_id = $${len + 1}` : '';

  // Working capital
  const [arChange, expPayable] = await Promise.all([
    q(`SELECT COALESCE(SUM(total_amount - paid_amount),0)::text AS t FROM finance_invoices WHERE deleted_at IS NULL AND invoice_number NOT LIKE 'SUB-%' AND issue_date BETWEEN $1 AND $2${tc(2)}`, ...tp([from, to])),
    q(`SELECT COALESCE(SUM(total_amount),0)::text AS t FROM finance_expenses WHERE deleted_at IS NULL AND status='APPROVED' AND expense_date BETWEEN $1 AND $2${tc(2)}`, ...tp([from, to])),
  ]);

  // CapEx & disposals
  let capexAmount = 0;
  let disposalAmount = 0;
  if (!tenantId) {
    [capexAmount, disposalAmount] = await Promise.all([
      q(`SELECT COALESCE(SUM(acquisition_cost),0)::text AS t FROM finance_fixed_assets WHERE deleted_at IS NULL AND acquisition_date BETWEEN $1 AND $2`, from, to),
      q(`SELECT COALESCE(SUM(disposal_proceeds),0)::text AS t FROM finance_fixed_assets WHERE deleted_at IS NULL AND disposal_date BETWEEN $1 AND $2`, from, to),
    ]);
  } else {
    [capexAmount, disposalAmount] = await Promise.all([
      q(`SELECT COALESCE(SUM(acquisition_cost),0)::text AS t FROM finance_fixed_assets WHERE deleted_at IS NULL AND tenant_id = $1 AND acquisition_date BETWEEN $2 AND $3`, tenantId, from, to),
      q(`SELECT COALESCE(SUM(disposal_proceeds),0)::text AS t FROM finance_fixed_assets WHERE deleted_at IS NULL AND tenant_id = $1 AND disposal_date BETWEEN $2 AND $3`, tenantId, from, to),
    ]);
  }

  // Financing — pull from leasing (loan drawdowns and repayments)
  const [leasingDrawdowns, leasingRepayments] = await Promise.all([
    q(`SELECT COALESCE(SUM(financed_amount),0)::text AS t FROM lease_contracts WHERE deleted_at IS NULL AND start_date BETWEEN $1 AND $2${tc(2)}`, ...tp([from, to])),
    q(`SELECT COALESCE(SUM(total_amount),0)::text AS t FROM lease_invoices WHERE deleted_at IS NULL AND status='PAID' AND created_at::date BETWEEN $1 AND $2${tc(2)}`, ...tp([from, to])),
  ]);

  const operatingCashFlow  = netProfit + depreciation - arChange + expPayable;
  const investingCashFlow  = disposalAmount - capexAmount;
  const financingCashFlow  = leasingDrawdowns - leasingRepayments;
  const netCashFlow        = operatingCashFlow + investingCashFlow + financingCashFlow;

  return NextResponse.json({
    type: 'cash_flow',
    period: { from, to },
    source: current.source,
    tenantId: tenantId ?? null,
    modules: activeModules.length > 0 ? activeModules : null,
    operating: {
      netProfit:            r2(netProfit),
      addDepreciation:      r2(depreciation),
      changeInReceivables:  r2(-arChange),
      changeInPayables:     r2(expPayable),
      netOperatingCashFlow: r2(operatingCashFlow),
    },
    investing: {
      capitalExpenditures:  r2(-capexAmount),
      assetDisposals:       r2(disposalAmount),
      netInvestingCashFlow: r2(investingCashFlow),
    },
    financing: {
      newBorrowings:        r2(leasingDrawdowns),
      loanRepayments:       r2(-leasingRepayments),
      dividendsPaid:        0,
      netFinancingCashFlow: r2(financingCashFlow),
    },
    summary: { netCashFlow: r2(netCashFlow) },
  });
}
