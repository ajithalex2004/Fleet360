/**
 * Finance Reporting Layer — /api/finance/summary
 *
 * READ-ONLY aggregation endpoint.
 * Consolidates financial data from all operational modules.
 * Every query has a .catch() fallback — the dashboard NEVER hard-errors.
 *
 * Query params:
 *   from  — ISO date string (optional)
 *   to    — ISO date string (optional)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function toNum(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'number') return val;
  return parseFloat(String(val)) || 0;
}

type AggRow  = { total: unknown; count: unknown };
type MonthRow = { month: string; total: unknown; count: unknown };

const zeroAgg  = () => Promise.resolve([{ total: 0, count: 0 }] as AggRow[]);
const zeroMonth = () => Promise.resolve([] as MonthRow[]);

export async function GET(request: NextRequest) {
  const sp   = request.nextUrl.searchParams;
  const from = sp.get('from') ? new Date(sp.get('from')!) : null;
  const to   = sp.get('to')   ? new Date(sp.get('to')!)   : null;

  const fromTs = from ?? new Date(0);
  const toTs   = to   ?? new Date('2099-01-01');

  const [
    maintenanceCosts,
    rentalRevenue,
    leaseRevenue,
    generalInvoices,
    financeInvoicesRev,
    payments,
    financePayments,
    maintenanceByMonth,
    rentalByMonth,
    financeInvByMonth,
  ] = await Promise.all([

    // ── Maintenance: approved quotation costs ─────────────────────────────────
    prisma.$queryRawUnsafe<AggRow[]>(
      `SELECT COALESCE(SUM(total_amount),0) as total, COUNT(*) as count
         FROM quotations
        WHERE status = 'APPROVED' AND deleted_at IS NULL
          AND created_at BETWEEN $1 AND $2`,
      fromTs, toTs,
    ).catch(zeroAgg),

    // ── Rental (RAC): rental invoice revenue ──────────────────────────────────
    prisma.$queryRawUnsafe<AggRow[]>(
      `SELECT COALESCE(SUM(total_amount),0) as total, COUNT(*) as count
         FROM rental_invoices WHERE deleted_at IS NULL AND created_at BETWEEN $1 AND $2`,
      fromTs, toTs,
    ).catch(zeroAgg),

    // ── Leasing: lease invoice revenue ───────────────────────────────────────
    prisma.$queryRawUnsafe<AggRow[]>(
      `SELECT COALESCE(SUM(total_amount),0) as total, COUNT(*) as count
         FROM lease_invoices WHERE deleted_at IS NULL AND created_at BETWEEN $1 AND $2`,
      fromTs, toTs,
    ).catch(zeroAgg),

    // ── General invoices (legacy Prisma-managed) ──────────────────────────────
    prisma.$queryRawUnsafe<AggRow[]>(
      `SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count
         FROM invoices WHERE deleted_at IS NULL AND created_at BETWEEN $1 AND $2`,
      fromTs, toTs,
    ).catch(zeroAgg),

    // ── Finance invoices (new module) ─────────────────────────────────────────
    prisma.$queryRawUnsafe<AggRow[]>(
      `SELECT COALESCE(SUM(total_amount),0) as total, COUNT(*) as count
         FROM finance_invoices
        WHERE deleted_at IS NULL
          AND payment_status NOT IN ('DRAFT','CANCELLED')
          AND issue_date BETWEEN $1::date AND $2::date`,
      fromTs, toTs,
    ).catch(zeroAgg),

    // ── Legacy payment_transactions (cash received) ───────────────────────────
    prisma.$queryRawUnsafe<AggRow[]>(
      `SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count
         FROM payment_transactions
        WHERE deleted_at IS NULL AND status = 'COMPLETED'
          AND created_at BETWEEN $1 AND $2`,
      fromTs, toTs,
    ).catch(zeroAgg),

    // ── Finance payments (new reconciliation table) ───────────────────────────
    prisma.$queryRawUnsafe<AggRow[]>(
      `SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count
         FROM finance_payments
        WHERE payment_date BETWEEN $1::date AND $2::date`,
      fromTs, toTs,
    ).catch(zeroAgg),

    // ── Maintenance monthly trend ─────────────────────────────────────────────
    prisma.$queryRawUnsafe<MonthRow[]>(
      `SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') as month,
              COALESCE(SUM(total_amount),0) as total, COUNT(*) as count
         FROM quotations
        WHERE status = 'APPROVED' AND deleted_at IS NULL
          AND created_at BETWEEN $1 AND $2
        GROUP BY DATE_TRUNC('month', created_at) ORDER BY month`,
      fromTs, toTs,
    ).catch(zeroMonth),

    // ── Rental monthly trend ──────────────────────────────────────────────────
    prisma.$queryRawUnsafe<MonthRow[]>(
      `SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') as month,
              COALESCE(SUM(total_amount),0) as total, COUNT(*) as count
         FROM rental_invoices WHERE deleted_at IS NULL
          AND created_at BETWEEN $1 AND $2
        GROUP BY DATE_TRUNC('month', created_at) ORDER BY month`,
      fromTs, toTs,
    ).catch(zeroMonth),

    // ── Finance invoices monthly trend ────────────────────────────────────────
    prisma.$queryRawUnsafe<MonthRow[]>(
      `SELECT TO_CHAR(DATE_TRUNC('month', issue_date), 'YYYY-MM') as month,
              COALESCE(SUM(total_amount),0) as total, COUNT(*) as count
         FROM finance_invoices
        WHERE deleted_at IS NULL AND payment_status NOT IN ('DRAFT','CANCELLED')
          AND issue_date BETWEEN $1::date AND $2::date
        GROUP BY DATE_TRUNC('month', issue_date) ORDER BY month`,
      fromTs, toTs,
    ).catch(zeroMonth),
  ]);

  // ── Aggregate ──────────────────────────────────────────────────────────────
  const mc  = { total: toNum(maintenanceCosts[0]?.total),      count: toNum(maintenanceCosts[0]?.count) };
  const rr  = { total: toNum(rentalRevenue[0]?.total),         count: toNum(rentalRevenue[0]?.count) };
  const lr  = { total: toNum(leaseRevenue[0]?.total),          count: toNum(leaseRevenue[0]?.count) };
  const gi  = { total: toNum(generalInvoices[0]?.total),       count: toNum(generalInvoices[0]?.count) };
  const fi  = { total: toNum(financeInvoicesRev[0]?.total),    count: toNum(financeInvoicesRev[0]?.count) };
  const pm  = { total: toNum(payments[0]?.total)      + toNum(financePayments[0]?.total),
                count: toNum(payments[0]?.count)       + toNum(financePayments[0]?.count) };

  const totalRevenue = rr.total + lr.total + gi.total + fi.total;
  const totalCosts   = mc.total;
  const grossProfit  = totalRevenue - totalCosts;

  return NextResponse.json({
    period: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },

    modules: {
      maintenance: { label: 'Vehicle Maintenance', type: 'cost',    total: mc.total, invoiceCount: mc.count, currency: 'AED' },
      rental:      { label: 'Rent-A-Car (RAC)',    type: 'revenue', total: rr.total, invoiceCount: rr.count, currency: 'AED' },
      leasing:     { label: 'Vehicle Leasing',     type: 'revenue', total: lr.total, invoiceCount: lr.count, currency: 'AED' },
      general:     { label: 'General Invoicing',   type: 'revenue', total: gi.total, invoiceCount: gi.count, currency: 'AED' },
      financeInv:  { label: 'Finance Invoices',    type: 'revenue', total: fi.total, invoiceCount: fi.count, currency: 'AED' },
      payments:    { label: 'Received Payments',   type: 'cash',    total: pm.total, transactionCount: pm.count, currency: 'AED' },
    },

    summary: {
      totalRevenue,
      totalCosts,
      grossProfit,
      grossMarginPct: totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 1000) / 10 : 0,
      currency: 'AED',
    },

    trends: {
      maintenance: maintenanceByMonth.map(r => ({ month: r.month, total: toNum(r.total), count: toNum(r.count) })),
      rental:      rentalByMonth.map(r      => ({ month: r.month, total: toNum(r.total), count: toNum(r.count) })),
      invoices:    financeInvByMonth.map(r  => ({ month: r.month, total: toNum(r.total), count: toNum(r.count) })),
    },
  });
}
