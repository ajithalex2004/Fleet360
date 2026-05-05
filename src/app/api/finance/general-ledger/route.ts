/**
 * General Ledger API — /api/finance/general-ledger
 * Account statement, Trial Balance, account balances from posted journal lines
 * Multi-tenant: pass ?tenantId= to scope journal entries to a single tenant
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type GlRow = Record<string, unknown>;

export async function GET(req: NextRequest) {
  const sp   = req.nextUrl.searchParams;
  const type = sp.get('type'); // trial_balance | account_statement | account_balances

  // ── Tenant scoping ────────────────────────────────────────────────────────
  const rawTenantId = sp.get('tenantId');
  const tenantId    = rawTenantId ? rawTenantId.replace(/[^a-zA-Z0-9_-]/g, '') : null;

  /** Returns a tenant filter clause for finance_journal_entries aliased as `je` or standalone */
  function jeTenantClause(paramIndex: number, alias: 'je' | '' = 'je'): string {
    if (!tenantId) return '';
    const col = alias ? `${alias}.tenant_id` : 'tenant_id';
    return ` AND ${col} = $${paramIndex}`;
  }

  /** Appends tenantId to a params array if tenantId is set */
  function withTenant(base: unknown[]): unknown[] {
    return tenantId ? [...base, tenantId] : base;
  }

  // ── Trial Balance ─────────────────────────────────────────────────────────
  if (type === 'trial_balance') {
    const from  = sp.get('from') ?? `${new Date().getFullYear()}-01-01`;
    const to    = sp.get('to')   ?? new Date().toISOString().slice(0, 10);

    // base params: $1=from, $2=to  →  tenant at $3 if needed
    const params = withTenant([from, to]);
    const tenantFilter = jeTenantClause(params.length, '');

    const rows = await (prisma.$queryRawUnsafe as (...a: unknown[]) => Promise<GlRow[]>)(
      `SELECT
         c.account_code, c.account_name, c.account_type, c.account_subtype,
         c.normal_balance, c.is_header, c.parent_code, c.sort_order,
         COALESCE(SUM(jl.debit_amount),0)::numeric(15,2) as total_debit,
         COALESCE(SUM(jl.credit_amount),0)::numeric(15,2) as total_credit,
         CASE
           WHEN c.normal_balance = 'DEBIT'
             THEN (COALESCE(SUM(jl.debit_amount),0) - COALESCE(SUM(jl.credit_amount),0))
           ELSE
             (COALESCE(SUM(jl.credit_amount),0) - COALESCE(SUM(jl.debit_amount),0))
         END::numeric(15,2) as balance
       FROM finance_chart_of_accounts c
       LEFT JOIN finance_journal_lines jl
         ON jl.account_code = c.account_code
         AND jl.journal_entry_id IN (
           SELECT id::text FROM finance_journal_entries
           WHERE status = 'POSTED' AND entry_date BETWEEN $1 AND $2 AND deleted_at IS NULL${tenantFilter}
         )
       WHERE c.deleted_at IS NULL AND c.is_active = TRUE AND c.is_header = FALSE
       GROUP BY c.account_code, c.account_name, c.account_type, c.account_subtype,
                c.normal_balance, c.is_header, c.parent_code, c.sort_order
       ORDER BY c.sort_order, c.account_code`,
      ...params
    ).catch(() => []);

    // Aggregate totals
    const totalDr   = rows.reduce((s, r) => s + parseFloat(String(r.total_debit  ?? 0)), 0);
    const totalCr   = rows.reduce((s, r) => s + parseFloat(String(r.total_credit ?? 0)), 0);
    const isBalanced = Math.abs(totalDr - totalCr) < 0.01;

    return NextResponse.json({
      rows,
      period: { from, to },
      tenantId: tenantId ?? null,
      totals: {
        totalDebit:  Math.round(totalDr * 100) / 100,
        totalCredit: Math.round(totalCr * 100) / 100,
        isBalanced,
        difference:  Math.round((totalDr - totalCr) * 100) / 100,
      },
    });
  }

  // ── Account Statement ─────────────────────────────────────────────────────
  if (type === 'account_statement') {
    const accountCode = sp.get('accountCode');
    const from = sp.get('from') ?? `${new Date().getFullYear()}-01-01`;
    const to   = sp.get('to')  ?? new Date().toISOString().slice(0, 10);

    if (!accountCode) return NextResponse.json({ error: 'accountCode required' }, { status: 400 });

    // Opening balance — all posted JEs before 'from'
    // base params for ob: $1=accountCode, $2=from  → tenant at $3
    const obParams = withTenant([accountCode, from]);
    const obTenantFilter = jeTenantClause(obParams.length, 'je');

    const [obRow] = await (prisma.$queryRawUnsafe as (...a: unknown[]) => Promise<{debit: string; credit: string}[]>)(
      `SELECT COALESCE(SUM(jl.debit_amount),0)::text as debit,
              COALESCE(SUM(jl.credit_amount),0)::text as credit
         FROM finance_journal_lines jl
         JOIN finance_journal_entries je ON je.id::text = jl.journal_entry_id
        WHERE jl.account_code = $1 AND je.status = 'POSTED'
          AND je.entry_date < $2 AND je.deleted_at IS NULL${obTenantFilter}`,
      ...obParams
    ).catch(() => [{ debit: '0', credit: '0' }]);

    const [accInfo] = await (prisma.$queryRawUnsafe as (...a: unknown[]) => Promise<{account_name: string; account_type: string; normal_balance: string}[]>)(
      `SELECT account_name, account_type, normal_balance FROM finance_chart_of_accounts WHERE account_code = $1`, accountCode
    ).catch(() => [] as {account_name: string; account_type: string; normal_balance: string}[]);

    const openingDebit  = parseFloat(obRow?.debit  ?? '0');
    const openingCredit = parseFloat(obRow?.credit ?? '0');
    const normalBal     = accInfo?.normal_balance ?? 'DEBIT';
    const openingBal    = normalBal === 'DEBIT' ? openingDebit - openingCredit : openingCredit - openingDebit;

    // Period transactions
    // base params: $1=accountCode, $2=from, $3=to  → tenant at $4
    const lineParams = withTenant([accountCode, from, to]);
    const lineTenantFilter = jeTenantClause(lineParams.length, 'je');

    const lines = await (prisma.$queryRawUnsafe as (...a: unknown[]) => Promise<GlRow[]>)(
      `SELECT jl.*, je.je_number, je.entry_date, je.narration, je.reference, je.status as je_status
         FROM finance_journal_lines jl
         JOIN finance_journal_entries je ON je.id::text = jl.journal_entry_id
        WHERE jl.account_code = $1 AND je.status = 'POSTED'
          AND je.entry_date BETWEEN $2 AND $3 AND je.deleted_at IS NULL${lineTenantFilter}
        ORDER BY je.entry_date ASC, je.je_number ASC, jl.line_number ASC`,
      ...lineParams
    ).catch(() => []);

    // Running balance
    let runningBalance = openingBal;
    const linesWithBalance = lines.map(l => {
      const dr = parseFloat(String(l.debit_amount  ?? 0));
      const cr = parseFloat(String(l.credit_amount ?? 0));
      runningBalance += normalBal === 'DEBIT' ? (dr - cr) : (cr - dr);
      return { ...l, runningBalance: Math.round(runningBalance * 100) / 100 };
    });

    const totalDebit  = lines.reduce((s, l) => s + parseFloat(String(l.debit_amount  ?? 0)), 0);
    const totalCredit = lines.reduce((s, l) => s + parseFloat(String(l.credit_amount ?? 0)), 0);
    const closingBal  = normalBal === 'DEBIT'
      ? openingBal + totalDebit - totalCredit
      : openingBal + totalCredit - totalDebit;

    return NextResponse.json({
      account:        { code: accountCode, ...accInfo },
      period:         { from, to },
      tenantId:       tenantId ?? null,
      openingBalance: Math.round(openingBal   * 100) / 100,
      closingBalance: Math.round(closingBal   * 100) / 100,
      totalDebit:     Math.round(totalDebit  * 100) / 100,
      totalCredit:    Math.round(totalCredit * 100) / 100,
      lines:          linesWithBalance,
    });
  }

  // ── Account Balances (all accounts with current balances) ─────────────────
  const asOf = sp.get('asOf') ?? new Date().toISOString().slice(0, 10);

  // base params: $1=asOf  → tenant at $2
  const balParams = withTenant([asOf]);
  const balTenantFilter = jeTenantClause(balParams.length, '');

  const balances = await (prisma.$queryRawUnsafe as (...a: unknown[]) => Promise<GlRow[]>)(
    `SELECT
       c.account_code, c.account_name, c.account_type, c.account_subtype,
       c.normal_balance, c.parent_code, c.sort_order,
       COALESCE(SUM(jl.debit_amount),0)::numeric(15,2) as total_debit,
       COALESCE(SUM(jl.credit_amount),0)::numeric(15,2) as total_credit,
       CASE
         WHEN c.normal_balance = 'DEBIT'
           THEN (COALESCE(SUM(jl.debit_amount),0) - COALESCE(SUM(jl.credit_amount),0))
         ELSE
           (COALESCE(SUM(jl.credit_amount),0) - COALESCE(SUM(jl.debit_amount),0))
       END::numeric(15,2) as balance
     FROM finance_chart_of_accounts c
     LEFT JOIN finance_journal_lines jl
       ON jl.account_code = c.account_code
       AND jl.journal_entry_id IN (
         SELECT id::text FROM finance_journal_entries
         WHERE status='POSTED' AND entry_date <= $1 AND deleted_at IS NULL${balTenantFilter}
       )
     WHERE c.deleted_at IS NULL AND c.is_active=TRUE
     GROUP BY c.account_code, c.account_name, c.account_type, c.account_subtype,
              c.normal_balance, c.parent_code, c.sort_order
     ORDER BY c.sort_order, c.account_code`,
    ...balParams
  ).catch(() => []);

  return NextResponse.json({ data: balances, asOf, tenantId: tenantId ?? null });
}
