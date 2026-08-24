/**
 * Journal Entries API — /api/finance/journal-entries
 *
 * Double-entry accounting: every entry must balance (total debits = total credits).
 * Lifecycle: DRAFT → SUBMITTED → APPROVED → POSTED → REVERSED
 *
 * Schema is owned by migration 20260809000000_adopt_finance_tables_with_rls.
 * Runtime CREATE TABLE DDL removed — tables are guaranteed present at boot.
 *
 * All queries are scoped to the tenant from the x-tenant-id header set by
 * middleware. Platform admins (x-tenant-id = '*') see all tenants.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
type JeRow   = Record<string, unknown>;

// ── helpers ───────────────────────────────────────────────────────────────────

function getTenant(req: NextRequest): string | null {
  return req.headers.get('x-tenant-id');
}

async function nextJeNumber(): Promise<string> {
  const [row] = await prisma.$queryRawUnsafe<{ count: string }[]>(
    `SELECT COUNT(*)::text AS count FROM finance_journal_entries WHERE deleted_at IS NULL`,
  ).catch(() => [{ count: '0' }]);
  const now = new Date();
  const ym  = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const seq = (parseInt(row?.count ?? '0') + 1).toString().padStart(5, '0');
  return `JE-${ym}-${seq}`;
}

// ── GET /api/finance/journal-entries ─────────────────────────────────────────

export async function GET(req: NextRequest) {
  const tenantId = getTenant(req);
  if (!tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp     = req.nextUrl.searchParams;
  const status = sp.get('status');
  const source = sp.get('source');
  const from   = sp.get('from');
  const to     = sp.get('to');
  const page   = Math.max(1, parseInt(sp.get('page')  ?? '1'));
  const limit  = Math.min(100, parseInt(sp.get('limit') ?? '50'));
  const offset = (page - 1) * limit;

  // Build WHERE clause — always scope by tenant unless platform admin.
  let where = `WHERE je.deleted_at IS NULL`;
  const params: unknown[] = [];
  let pi = 1;

  if (tenantId !== '*') {
    where += ` AND je.tenant_id = $${pi++}`;
    params.push(tenantId);
  }
  if (status) { where += ` AND je.status = $${pi++}`;      params.push(status); }
  if (source) { where += ` AND je.source_type = $${pi++}`; params.push(source); }
  if (from)   { where += ` AND je.entry_date >= $${pi++}`; params.push(from); }
  if (to)     { where += ` AND je.entry_date <= $${pi++}`; params.push(to); }

  const [entries, counts] = await Promise.all([
    prisma.$queryRawUnsafe<JeRow[]>(
      `SELECT je.*,
         COALESCE(
           json_agg(json_build_object(
             'id',          jl.id,
             'lineNumber',  jl.line_number,
             'accountCode', jl.account_code,
             'accountName', jl.account_name,
             'description', jl.description,
             'debitAmount', jl.debit_amount,
             'creditAmount',jl.credit_amount,
             'costCentre',  jl.cost_centre
           ) ORDER BY jl.line_number) FILTER (WHERE jl.id IS NOT NULL),
           '[]'::json
         ) AS lines
       FROM finance_journal_entries je
       LEFT JOIN finance_journal_lines jl ON jl.journal_entry_id = je.id
       ${where}
       GROUP BY je.id
       ORDER BY je.entry_date DESC, je.je_number DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      ...params, limit, offset,
    ).catch(() => [] as JeRow[]),

    prisma.$queryRawUnsafe<{ status: string; count: string; total_debit: string }[]>(
      tenantId === '*'
        ? `SELECT status, COUNT(*)::text AS count,
                  COALESCE(SUM(total_debit), 0)::text AS total_debit
             FROM finance_journal_entries
            WHERE deleted_at IS NULL
            GROUP BY status`
        : `SELECT status, COUNT(*)::text AS count,
                  COALESCE(SUM(total_debit), 0)::text AS total_debit
             FROM finance_journal_entries
            WHERE deleted_at IS NULL AND tenant_id = $1
            GROUP BY status`,
      ...(tenantId !== '*' ? [tenantId] : []),
    ).catch(() => []),
  ]);

  return NextResponse.json({ data: entries, counts, page, limit });
}

// ── POST /api/finance/journal-entries ────────────────────────────────────────

export async function POST(req: NextRequest) {
  const tenantId = getTenant(req);
  if (!tenantId || tenantId === '*') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();

  const lines: {
    accountCode: string;
    accountName?: string;
    description?: string;
    debitAmount: number;
    creditAmount: number;
    costCentre?: string;
  }[] = body.lines ?? [];

  if (lines.length < 2) {
    return NextResponse.json(
      { error: 'Journal entry must have at least 2 lines' },
      { status: 400 },
    );
  }

  const totalDebit  = lines.reduce((s, l) => s + (parseFloat(String(l.debitAmount))  || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(String(l.creditAmount)) || 0), 0);
  const isBalanced  = Math.abs(totalDebit - totalCredit) < 0.01;

  if (!isBalanced) {
    return NextResponse.json(
      {
        error: `Journal entry is not balanced. Debits: ${totalDebit.toFixed(2)}, ` +
               `Credits: ${totalCredit.toFixed(2)}, ` +
               `Difference: ${(totalDebit - totalCredit).toFixed(2)}`,
      },
      { status: 400 },
    );
  }

  // Resolve account names from Chart of Accounts.
  const accountCodes = lines.map(l => l.accountCode);
  const accounts = await prisma.$queryRawUnsafe<
    { account_code: string; account_name: string; normal_balance: string }[]
  >(
    `SELECT account_code, account_name, normal_balance
       FROM finance_chart_of_accounts
      WHERE account_code = ANY($1::text[]) AND tenant_id = $2`,
    accountCodes, tenantId,
  ).catch(() => []);
  const accMap = new Map(accounts.map(a => [a.account_code, a]));

  const jeNumber  = await nextJeNumber();
  const entryDate = body.entryDate ?? new Date().toISOString().slice(0, 10);
  const d         = new Date(entryDate);

  const [je] = await prisma.$queryRawUnsafe<JeRow[]>(
    `INSERT INTO finance_journal_entries
       (je_number, entry_date, period_year, period_month,
        narration, reference, source_type, source_id, status,
        total_debit, total_credit, is_balanced,
        prepared_by, notes, currency, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'DRAFT',$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    jeNumber,
    entryDate,
    d.getFullYear(),
    d.getMonth() + 1,
    body.narration,
    body.reference  ?? null,
    body.sourceType ?? 'MANUAL',
    body.sourceId   ?? null,
    totalDebit,
    totalCredit,
    isBalanced,
    body.preparedBy ?? req.headers.get('x-user-id') ?? null,
    body.notes      ?? null,
    body.currency   ?? 'AED',
    tenantId,
  ).catch(() => []);

  if (!je) {
    return NextResponse.json({ error: 'Failed to create journal entry' }, { status: 500 });
  }
  const jeId = (je as Record<string, string>).id;

  for (let i = 0; i < lines.length; i++) {
    const l   = lines[i];
    const acc = accMap.get(l.accountCode);
    await prisma.$executeRawUnsafe(
      `INSERT INTO finance_journal_lines
         (journal_entry_id, line_number, account_code, account_name,
          description, debit_amount, credit_amount, normal_balance, cost_centre)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      jeId,
      i + 1,
      l.accountCode,
      acc?.account_name ?? l.accountName ?? null,
      l.description ?? null,
      parseFloat(String(l.debitAmount))  || 0,
      parseFloat(String(l.creditAmount)) || 0,
      acc?.normal_balance ?? 'DEBIT',
      l.costCentre ?? null,
    ).catch(() => {});
  }

  const [result] = await prisma.$queryRawUnsafe<JeRow[]>(
    `SELECT je.*,
       COALESCE(
         json_agg(json_build_object(
           'id',          jl.id,
           'lineNumber',  jl.line_number,
           'accountCode', jl.account_code,
           'accountName', jl.account_name,
           'description', jl.description,
           'debitAmount', jl.debit_amount,
           'creditAmount',jl.credit_amount
         ) ORDER BY jl.line_number),
         '[]'::json
       ) AS lines
     FROM finance_journal_entries je
     LEFT JOIN finance_journal_lines jl ON jl.journal_entry_id = je.id
     WHERE je.id = $1 GROUP BY je.id`,
    jeId,
  ).catch(() => []);

  return NextResponse.json(result ?? je, { status: 201 });
}
