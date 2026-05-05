import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/finance/branch-pl
 * Branch-level P&L segmented by cost center / emirate
 *
 * Query params:
 *   tenantId   — required
 *   branchId   — optional; if omitted returns all branches consolidated
 *   startDate  — YYYY-MM-DD (default: first day of current month)
 *   endDate    — YYYY-MM-DD (default: today)
 */

type Row = Record<string, unknown>;

function fmtDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().split('T')[0];
  return String(v).split('T')[0];
}

function num(v: unknown): number {
  return v === null || v === undefined ? 0 : parseFloat(String(v));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantId  = searchParams.get('tenantId') ?? '';
  const branchId  = searchParams.get('branchId') ?? '';
  const startDate = searchParams.get('startDate') ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const endDate   = searchParams.get('endDate')   ?? new Date().toISOString().split('T')[0];

  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  // ── Revenue by branch ────────────────────────────────────────────────────
  type RevRow = {
    branch_id: string | null;
    branch_name: string | null;
    emirate: string | null;
    cost_center_code: string | null;
    trade_license_no: string | null;
    total_invoiced: string | number;
    total_paid: string | number;
    outstanding: string | number;
    vat_collected: string | number;
    invoice_count: bigint;
  };

  const branchFilter = branchId ? `AND i.branch_id = '${branchId}'::uuid` : '';

  const revenueByBranch = await prisma.$queryRawUnsafe<RevRow[]>(
    `SELECT
       b.id                AS branch_id,
       b.branch_name,
       b.emirate,
       b.cost_center_code,
       b.trade_license_no,
       COALESCE(SUM(i.total_amount),   0) AS total_invoiced,
       COALESCE(SUM(i.paid_amount),    0) AS total_paid,
       COALESCE(SUM(i.total_amount - i.paid_amount), 0) AS outstanding,
       COALESCE(SUM(i.vat_amount),     0) AS vat_collected,
       COUNT(i.id)                        AS invoice_count
     FROM tenant_branches b
     LEFT JOIN finance_invoices i
       ON i.branch_id = b.id
       AND i.deleted_at IS NULL
       AND i.payment_status != 'DRAFT'
       AND i.issue_date BETWEEN $1::date AND $2::date
     WHERE b.tenant_id = $3
       AND b.deleted_at IS NULL
       ${branchFilter}
     GROUP BY b.id, b.branch_name, b.emirate, b.cost_center_code, b.trade_license_no
     ORDER BY total_invoiced DESC`,
    startDate, endDate, tenantId
  ).catch(err => { console.error('[branch-pl revenue]', err); return [] as RevRow[]; });

  // Also include invoices not yet assigned to a branch (NULL branch_id)
  type NoBranchRow = {
    total_invoiced: string | number;
    total_paid: string | number;
    vat_collected: string | number;
    invoice_count: bigint;
  };
  const unassigned = await prisma.$queryRawUnsafe<NoBranchRow[]>(
    `SELECT
       COALESCE(SUM(total_amount), 0) AS total_invoiced,
       COALESCE(SUM(paid_amount),  0) AS total_paid,
       COALESCE(SUM(vat_amount),   0) AS vat_collected,
       COUNT(id) AS invoice_count
     FROM finance_invoices
     WHERE tenant_id = $1
       AND branch_id IS NULL
       AND deleted_at IS NULL
       AND payment_status != 'DRAFT'
       AND issue_date BETWEEN $2::date AND $3::date`,
    tenantId, startDate, endDate
  ).catch(() => [] as NoBranchRow[]);

  // ── Expenses by branch (from finance_expenses if table exists) ───────────
  type ExpRow = {
    branch_id: string | null;
    branch_name: string | null;
    total_expenses: string | number;
    expense_count: bigint;
  };
  const expensesByBranch = await prisma.$queryRawUnsafe<ExpRow[]>(
    `SELECT
       b.id          AS branch_id,
       b.branch_name,
       COALESCE(SUM(e.amount), 0) AS total_expenses,
       COUNT(e.id)                AS expense_count
     FROM tenant_branches b
     LEFT JOIN finance_expenses e
       ON e.branch_id = b.id
       AND e.deleted_at IS NULL
       AND e.expense_date BETWEEN $1::date AND $2::date
     WHERE b.tenant_id = $3
       AND b.deleted_at IS NULL
       ${branchFilter}
     GROUP BY b.id, b.branch_name
     ORDER BY total_expenses DESC`,
    startDate, endDate, tenantId
  ).catch(() => [] as ExpRow[]);

  // ── Tenant info ──────────────────────────────────────────────────────────
  type TenantRow = { name: string; trn?: string; code?: string };
  const [tenant] = await prisma.$queryRawUnsafe<TenantRow[]>(
    `SELECT name, trn, code FROM tenants WHERE id = $1`,
    tenantId
  ).catch(() => [] as TenantRow[]);

  // ── Merge into branch P&L rows ───────────────────────────────────────────
  const expMap: Record<string, number> = {};
  for (const e of expensesByBranch) {
    if (e.branch_id) expMap[String(e.branch_id)] = num(e.total_expenses);
  }

  const branches = revenueByBranch.map(r => {
    const revenue   = num(r.total_invoiced);
    const expenses  = expMap[String(r.branch_id)] ?? 0;
    const grossProfit = revenue - expenses;
    const margin    = revenue > 0 ? Math.round((grossProfit / revenue) * 10000) / 100 : 0;
    return {
      branch_id:        r.branch_id ? String(r.branch_id) : null,
      branch_name:      r.branch_name ?? 'Unassigned',
      emirate:          r.emirate ?? null,
      cost_center_code: r.cost_center_code ?? null,
      trade_license_no: r.trade_license_no ?? null,
      revenue:          Math.round(revenue * 100) / 100,
      paid:             Math.round(num(r.total_paid) * 100) / 100,
      outstanding:      Math.round(num(r.outstanding) * 100) / 100,
      vat_collected:    Math.round(num(r.vat_collected) * 100) / 100,
      invoice_count:    Number(r.invoice_count),
      expenses:         Math.round(expenses * 100) / 100,
      gross_profit:     Math.round(grossProfit * 100) / 100,
      margin_pct:       margin,
    };
  });

  // Unassigned row
  const ua = unassigned[0];
  if (ua && num(ua.total_invoiced) > 0) {
    const revenue  = num(ua.total_invoiced);
    branches.push({
      branch_id: null,
      branch_name: 'Unassigned (No Branch)',
      emirate: null,
      cost_center_code: null,
      trade_license_no: null,
      revenue:       Math.round(revenue * 100) / 100,
      paid:          Math.round(num(ua.total_paid) * 100) / 100,
      outstanding:   Math.round((revenue - num(ua.total_paid)) * 100) / 100,
      vat_collected: Math.round(num(ua.vat_collected) * 100) / 100,
      invoice_count: Number(ua.invoice_count),
      expenses:      0,
      gross_profit:  Math.round(revenue * 100) / 100,
      margin_pct:    100,
    });
  }

  // ── Consolidated totals ──────────────────────────────────────────────────
  const totals = branches.reduce((acc, b) => ({
    revenue:       acc.revenue       + b.revenue,
    paid:          acc.paid          + b.paid,
    outstanding:   acc.outstanding   + b.outstanding,
    vat_collected: acc.vat_collected + b.vat_collected,
    expenses:      acc.expenses      + b.expenses,
    gross_profit:  acc.gross_profit  + b.gross_profit,
    invoice_count: acc.invoice_count + b.invoice_count,
  }), { revenue: 0, paid: 0, outstanding: 0, vat_collected: 0, expenses: 0, gross_profit: 0, invoice_count: 0 });

  return NextResponse.json({
    tenant: {
      id:   tenantId,
      name: tenant?.name ?? tenantId,
      trn:  tenant?.trn ?? null,
      code: tenant?.code ?? null,
    },
    period: { start: startDate, end: endDate },
    branches,
    totals: {
      ...totals,
      revenue:       Math.round(totals.revenue       * 100) / 100,
      paid:          Math.round(totals.paid           * 100) / 100,
      outstanding:   Math.round(totals.outstanding    * 100) / 100,
      vat_collected: Math.round(totals.vat_collected  * 100) / 100,
      expenses:      Math.round(totals.expenses       * 100) / 100,
      gross_profit:  Math.round(totals.gross_profit   * 100) / 100,
      margin_pct:    totals.revenue > 0
        ? Math.round((totals.gross_profit / totals.revenue) * 10000) / 100
        : 0,
    },
  });
}
