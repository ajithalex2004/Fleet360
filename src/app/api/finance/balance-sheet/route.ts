/**
 * Balance Sheet API — /api/finance/balance-sheet
 * Full Balance Sheet: Assets = Liabilities + Equity
 * Reads from GL (posted JE lines) when available; falls back to module tables
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function toN(v: unknown): number { return parseFloat(String(v ?? 0)) || 0; }

interface BSLine { code: string; label: string; amount: number; subtype?: string | null; }

export async function GET(req: NextRequest) {
  const sp  = req.nextUrl.searchParams;
  const asOf = sp.get('asOf') ?? new Date().toISOString().slice(0, 10);

  // ── Check GL availability ────────────────────────────────────────────────
  const [glCheck] = await prisma.$queryRawUnsafe<{ count: string }[]>(
    `SELECT COUNT(*)::text as count FROM finance_journal_entries WHERE status='POSTED' AND entry_date <= $1`, asOf
  ).catch(() => [{ count: '0' }]);
  const hasGl = parseInt(glCheck?.count ?? '0') > 0;

  // ── Helper: balance for an account range from GL ─────────────────────────
  async function glBalance(like: string, normalBalance: 'DEBIT' | 'CREDIT'): Promise<BSLine[]> {
    const rows = await prisma.$queryRawUnsafe<{ account_code: string; account_name: string; account_subtype: string | null; balance: string }[]>(
      `SELECT jl.account_code, c.account_name, c.account_subtype,
         COALESCE(SUM(jl.debit_amount - jl.credit_amount),0)::text as balance
       FROM finance_journal_lines jl
       JOIN finance_journal_entries je ON je.id::text = jl.journal_entry_id
       JOIN finance_chart_of_accounts c ON c.account_code = jl.account_code
       WHERE je.status='POSTED' AND je.entry_date <= $1
         AND jl.account_code LIKE $2
         AND c.is_header = FALSE
       GROUP BY jl.account_code, c.account_name, c.account_subtype
       HAVING COALESCE(SUM(jl.debit_amount - jl.credit_amount),0) != 0
       ORDER BY jl.account_code`, asOf, like
    ).catch(() => []);

    return rows.map(r => {
      const raw = toN(r.balance);
      // For CREDIT normal (liabilities, equity, income): flip sign so amounts are positive
      const amount = normalBalance === 'CREDIT' ? -raw : raw;
      return { code: r.account_code, label: r.account_name, amount, subtype: r.account_subtype };
    }).filter(r => r.amount !== 0);
  }

  // ── Asset sections from GL or module fallback ────────────────────────────
  async function getAssets(): Promise<{ current: BSLine[]; fixed: BSLine[]; other: BSLine[] }> {
    if (hasGl) {
      const rows = await glBalance('1%', 'DEBIT');
      return {
        current: rows.filter(r => r.subtype === 'CURRENT' || r.code.startsWith('11')),
        fixed:   rows.filter(r => r.subtype === 'FIXED'   || r.code.startsWith('12')),
        other:   rows.filter(r => !['CURRENT','FIXED'].includes(r.subtype ?? '') && !r.code.startsWith('11') && !r.code.startsWith('12')),
      };
    }
    // Module fallback
    const [cash]    = await prisma.$queryRawUnsafe<{t:string}[]>(`SELECT COALESCE(SUM(amount),0)::text as t FROM finance_payments WHERE deleted_at IS NULL AND status='RECONCILED' AND payment_date <= $1`, asOf).catch(()=>[{t:'0'}]);
    const [ar]      = await prisma.$queryRawUnsafe<{t:string}[]>(`SELECT COALESCE(SUM(total_amount - paid_amount),0)::text as t FROM finance_invoices WHERE deleted_at IS NULL AND issue_date <= $1 AND payment_status NOT IN ('PAID','CANCELLED','DRAFT')`, asOf).catch(()=>[{t:'0'}]);
    const [pdc]     = await prisma.$queryRawUnsafe<{t:string}[]>(`SELECT COALESCE(SUM(amount),0)::text as t FROM finance_pdc_cheques WHERE deleted_at IS NULL AND direction='INWARD' AND status IN ('HELD','DEPOSITED') AND cheque_date <= $1`, asOf).catch(()=>[{t:'0'}]);
    const [nbv]     = await prisma.$queryRawUnsafe<{t:string}[]>(`SELECT COALESCE(SUM(net_book_value),0)::text as t FROM finance_fixed_assets WHERE deleted_at IS NULL AND acquisition_date <= $1 AND status != 'DISPOSED'`, asOf).catch(()=>[{t:'0'}]);
    const [accDep]  = await prisma.$queryRawUnsafe<{t:string}[]>(`SELECT COALESCE(SUM(accumulated_depreciation),0)::text as t FROM finance_fixed_assets WHERE deleted_at IS NULL AND acquisition_date <= $1 AND status != 'DISPOSED'`, asOf).catch(()=>[{t:'0'}]);
    return {
      current: [
        { code: '1110', label: 'Cash & Cash Equivalents',   amount: toN(cash?.t)  },
        { code: '1131', label: 'Trade Receivables (AR)',     amount: toN(ar?.t)    },
        { code: '1160', label: 'PDC Cheques Receivable',     amount: toN(pdc?.t)   },
      ].filter(r => r.amount > 0),
      fixed: [
        { code: '1210', label: 'Fleet & Vehicles (at cost)', amount: toN(nbv?.t) + toN(accDep?.t) },
        { code: '1290', label: 'Less: Accumulated Depreciation', amount: -toN(accDep?.t) },
      ].filter(r => r.amount !== 0),
      other: [],
    };
  }

  // ── Liability sections ───────────────────────────────────────────────────
  async function getLiabilities(): Promise<{ current: BSLine[]; nonCurrent: BSLine[] }> {
    if (hasGl) {
      const rows = await glBalance('2%', 'CREDIT');
      return {
        current:    rows.filter(r => r.subtype === 'CURRENT' || r.code.startsWith('21')),
        nonCurrent: rows.filter(r => r.subtype !== 'CURRENT' && !r.code.startsWith('21')),
      };
    }
    const [vat]     = await prisma.$queryRawUnsafe<{t:string}[]>(`SELECT COALESCE(SUM(vat_amount),0)::text as t FROM finance_invoices WHERE deleted_at IS NULL AND issue_date <= $1 AND payment_status NOT IN ('PAID','CANCELLED','DRAFT')`, asOf).catch(()=>[{t:'0'}]);
    const [expPay]  = await prisma.$queryRawUnsafe<{t:string}[]>(`SELECT COALESCE(SUM(total_amount),0)::text as t FROM finance_expenses WHERE deleted_at IS NULL AND status='APPROVED' AND expense_date <= $1`, asOf).catch(()=>[{t:'0'}]);
    const [pdcOut]  = await prisma.$queryRawUnsafe<{t:string}[]>(`SELECT COALESCE(SUM(amount),0)::text as t FROM finance_pdc_cheques WHERE deleted_at IS NULL AND direction='OUTWARD' AND status IN ('HELD','DEPOSITED') AND cheque_date <= $1`, asOf).catch(()=>[{t:'0'}]);
    return {
      current: [
        { code: '2120', label: 'VAT Payable (FTA)',          amount: toN(vat?.t)    },
        { code: '2130', label: 'Accrued Expenses Payable',   amount: toN(expPay?.t) },
        { code: '2160', label: 'PDC Cheques Payable',        amount: toN(pdcOut?.t) },
      ].filter(r => r.amount > 0),
      nonCurrent: [],
    };
  }

  // ── Equity sections ──────────────────────────────────────────────────────
  async function getEquity(): Promise<BSLine[]> {
    if (hasGl) {
      const [eq]  = await glBalance('3%', 'CREDIT');
      const rows  = await glBalance('3%', 'CREDIT');
      // Retained earnings = all income - all expense posted to date
      const [pl] = await prisma.$queryRawUnsafe<{net:string}[]>(
        `SELECT COALESCE(SUM(CASE WHEN c.account_type='INCOME' THEN jl.credit_amount - jl.debit_amount
                               WHEN c.account_type='EXPENSE' THEN jl.debit_amount - jl.credit_amount
                               ELSE 0 END),0)::text as net
         FROM finance_journal_lines jl
         JOIN finance_journal_entries je ON je.id::text = jl.journal_entry_id
         JOIN finance_chart_of_accounts c ON c.account_code = jl.account_code
         WHERE je.status='POSTED' AND je.entry_date <= $1
           AND c.account_type IN ('INCOME','EXPENSE')`, asOf
      ).catch(() => [{ net: '0' }]);
      const retainedEarnings = toN(pl?.net ?? '0');
      return [
        ...rows,
        { code: '3200', label: 'Retained Earnings (Current Year P&L)', amount: retainedEarnings },
      ];
    }
    // Module fallback: estimate retained earnings from revenue - expenses
    const [rev]  = await prisma.$queryRawUnsafe<{t:string}[]>(`SELECT COALESCE(SUM(subtotal_amount),0)::text as t FROM finance_invoices WHERE deleted_at IS NULL AND issue_date <= $1 AND payment_status NOT IN ('DRAFT','CANCELLED')`, asOf).catch(()=>[{t:'0'}]);
    const [exp]  = await prisma.$queryRawUnsafe<{t:string}[]>(`SELECT COALESCE(SUM(total_amount),0)::text as t FROM finance_expenses WHERE deleted_at IS NULL AND status IN ('APPROVED','PAID') AND expense_date <= $1`, asOf).catch(()=>[{t:'0'}]);
    return [
      { code: '3100', label: 'Share Capital',                       amount: 0 },
      { code: '3200', label: 'Retained Earnings (Estimated P&L)',   amount: Math.max(0, toN(rev?.t) - toN(exp?.t)) },
    ].filter(r => r.amount !== 0);
  }

  const [{ current: currentAssets, fixed: fixedAssets, other: otherAssets }, { current: currentLiabilities, nonCurrent: ncLiabilities }, equityLines] =
    await Promise.all([getAssets(), getLiabilities(), getEquity()]);

  const totalCurrentAssets  = currentAssets.reduce((s, r) => s + r.amount, 0);
  const totalFixedAssets    = fixedAssets.reduce((s, r) => s + r.amount, 0);
  const totalOtherAssets    = otherAssets.reduce((s, r) => s + r.amount, 0);
  const totalAssets         = totalCurrentAssets + totalFixedAssets + totalOtherAssets;

  const totalCurrentLiab   = currentLiabilities.reduce((s, r) => s + r.amount, 0);
  const totalNCLiab        = ncLiabilities.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities   = totalCurrentLiab + totalNCLiab;

  const totalEquity        = equityLines.reduce((s, r) => s + r.amount, 0);
  const totalLiabEquity    = totalLiabilities + totalEquity;
  const isBalanced         = Math.abs(totalAssets - totalLiabEquity) < 1;

  return NextResponse.json({
    asOf,
    source: hasGl ? 'GL' : 'MODULE_DATA',
    assets: {
      current:     currentAssets,
      fixed:       fixedAssets,
      other:       otherAssets,
      totalCurrent: Math.round(totalCurrentAssets  * 100) / 100,
      totalFixed:   Math.round(totalFixedAssets    * 100) / 100,
      totalOther:   Math.round(totalOtherAssets    * 100) / 100,
      totalAssets:  Math.round(totalAssets         * 100) / 100,
    },
    liabilities: {
      current:       currentLiabilities,
      nonCurrent:    ncLiabilities,
      totalCurrent:  Math.round(totalCurrentLiab * 100) / 100,
      totalNC:       Math.round(totalNCLiab       * 100) / 100,
      totalLiabilities: Math.round(totalLiabilities * 100) / 100,
    },
    equity: {
      lines:         equityLines,
      totalEquity:   Math.round(totalEquity * 100) / 100,
    },
    summary: {
      totalAssets:      Math.round(totalAssets       * 100) / 100,
      totalLiabEquity:  Math.round(totalLiabEquity   * 100) / 100,
      isBalanced,
      difference:       Math.round(Math.abs(totalAssets - totalLiabEquity) * 100) / 100,
    },
  });
}
