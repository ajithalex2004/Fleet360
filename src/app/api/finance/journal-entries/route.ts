/**
 * Journal Entries API — /api/finance/journal-entries
 * Double-entry accounting: every entry must balance (total debits = total credits)
 * Lifecycle: DRAFT → SUBMITTED → APPROVED → POSTED → REVERSED
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureOperationalTenantColumn, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

const INIT_JE = `
  CREATE TABLE IF NOT EXISTS finance_journal_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    je_number       TEXT UNIQUE NOT NULL,
    entry_date      DATE NOT NULL,
    period_year     INTEGER NOT NULL,
    period_month    INTEGER NOT NULL,
    narration       TEXT NOT NULL,
    reference       TEXT,
    source_type     TEXT DEFAULT 'MANUAL',  -- MANUAL | INVOICE | PAYMENT | DEPRECIATION | ADJUSTMENT | REVERSAL
    source_id       TEXT,
    status          TEXT DEFAULT 'DRAFT',   -- DRAFT | SUBMITTED | APPROVED | POSTED | REVERSED | VOID
    total_debit     NUMERIC(15,2) DEFAULT 0,
    total_credit    NUMERIC(15,2) DEFAULT 0,
    is_balanced     BOOLEAN DEFAULT FALSE,
    reversed_je_id  TEXT,       -- pointer to the JE this one reverses
    reversal_je_id  TEXT,       -- pointer to the reversal JE created from this one
    prepared_by     TEXT,
    approved_by     TEXT,
    posted_by       TEXT,
    approved_at     TIMESTAMPTZ,
    posted_at       TIMESTAMPTZ,
    notes           TEXT,
    currency        TEXT DEFAULT 'AED',
    tenant_id       TEXT
  );
`;

const INIT_LINES = `
  CREATE TABLE IF NOT EXISTS finance_journal_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    journal_entry_id TEXT NOT NULL,
    line_number     INTEGER NOT NULL,
    account_code    TEXT NOT NULL,
    account_name    TEXT,
    description     TEXT,
    debit_amount    NUMERIC(15,2) DEFAULT 0,
    credit_amount   NUMERIC(15,2) DEFAULT 0,
    normal_balance  TEXT DEFAULT 'DEBIT',
    cost_centre     TEXT,
    currency        TEXT DEFAULT 'AED'
  );
`;

type JeRow   = Record<string, unknown>;

async function nextJeNumber(): Promise<string> {
  const [row] = await prisma.$queryRawUnsafe<{count: string}[]>(
    `SELECT COUNT(*)::text as count FROM finance_journal_entries`
  ).catch(() => [{ count: '0' }]);
  const now = new Date();
  const ym  = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;
  const seq = (parseInt(row?.count ?? '0') + 1).toString().padStart(5, '0');
  return `JE-${ym}-${seq}`;
}

export async function GET(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT_JE).catch(() => {});
  await prisma.$executeRawUnsafe(INIT_LINES).catch(() => {});
  await ensureOperationalTenantColumn('finance_journal_entries').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;

  const sp     = req.nextUrl.searchParams;
  const status = sp.get('status');
  const source = sp.get('source');
  const from   = sp.get('from');
  const to     = sp.get('to');
  const page   = Math.max(1, parseInt(sp.get('page')  ?? '1'));
  const limit  = Math.min(100, parseInt(sp.get('limit') ?? '50'));
  const offset = (page - 1) * limit;

  let where = `WHERE deleted_at IS NULL AND tenant_id::text = $1`;
  const params: unknown[] = [ctx.tenantId];
  let pi = 2;
  if (status) { where += ` AND status = $${pi++}`; params.push(status); }
  if (source) { where += ` AND source_type = $${pi++}`; params.push(source); }
  if (from)   { where += ` AND entry_date >= $${pi++}`; params.push(from); }
  if (to)     { where += ` AND entry_date <= $${pi++}`; params.push(to); }

  const [entries, counts] = await Promise.all([
    prisma.$queryRawUnsafe<JeRow[]>(
      `SELECT je.*,
         json_agg(json_build_object(
           'id', jl.id, 'lineNumber', jl.line_number, 'accountCode', jl.account_code,
           'accountName', jl.account_name, 'description', jl.description,
           'debitAmount', jl.debit_amount, 'creditAmount', jl.credit_amount,
           'costCentre', jl.cost_centre
         ) ORDER BY jl.line_number) FILTER (WHERE jl.id IS NOT NULL) as lines
       FROM finance_journal_entries je
       LEFT JOIN finance_journal_lines jl ON jl.journal_entry_id = je.id::text
       ${where} GROUP BY je.id
       ORDER BY je.entry_date DESC, je.je_number DESC
       LIMIT $${pi} OFFSET $${pi+1}`,
      ...params, limit, offset
    ).catch(() => []),
    prisma.$queryRawUnsafe<{status: string; count: string; total_debit: string}[]>(
      `SELECT status, COUNT(*)::text as count, COALESCE(SUM(total_debit),0)::text as total_debit
         FROM finance_journal_entries WHERE deleted_at IS NULL AND tenant_id::text = $1 GROUP BY status`,
      ctx.tenantId
    ).catch(() => []),
  ]);

  return NextResponse.json({ data: entries, counts, page, limit });
}

export async function POST(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT_JE).catch(() => {});
  await prisma.$executeRawUnsafe(INIT_LINES).catch(() => {});
  await ensureOperationalTenantColumn('finance_journal_entries').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json();

  // Validate lines
  const lines: {accountCode: string; accountName?: string; description?: string; debitAmount: number; creditAmount: number; costCentre?: string}[] = body.lines ?? [];
  if (lines.length < 2) return NextResponse.json({ error: 'Journal entry must have at least 2 lines' }, { status: 400 });

  const totalDebit  = lines.reduce((s, l) => s + (parseFloat(String(l.debitAmount))  || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(String(l.creditAmount)) || 0), 0);
  const isBalanced  = Math.abs(totalDebit - totalCredit) < 0.01;

  if (!isBalanced) {
    return NextResponse.json({
      error: `Journal entry is not balanced. Total Debits: ${totalDebit.toFixed(2)}, Total Credits: ${totalCredit.toFixed(2)}, Difference: ${(totalDebit - totalCredit).toFixed(2)}`
    }, { status: 400 });
  }

  const jeNumber  = await nextJeNumber();
  const entryDate = body.entryDate ?? new Date().toISOString().slice(0, 10);
  const d         = new Date(entryDate);

  // Get account names for lines
  const accountCodes = lines.map(l => l.accountCode);
  const accounts = await prisma.$queryRawUnsafe<{account_code: string; account_name: string; normal_balance: string}[]>(
    `SELECT account_code, account_name, normal_balance FROM finance_chart_of_accounts WHERE account_code = ANY($1::text[])`,
    accountCodes
  ).catch(() => []);
  const accMap = new Map(accounts.map(a => [a.account_code, a]));

  const [je] = await prisma.$queryRawUnsafe<JeRow[]>(
    `INSERT INTO finance_journal_entries
       (je_number, entry_date, period_year, period_month, narration, reference,
        source_type, source_id, status, total_debit, total_credit, is_balanced,
        prepared_by, notes, currency, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'DRAFT',$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    jeNumber, entryDate, d.getFullYear(), d.getMonth() + 1,
    body.narration, body.reference ?? null,
    body.sourceType ?? 'MANUAL', body.sourceId ?? null,
    totalDebit, totalCredit, isBalanced,
    body.preparedBy ?? null, body.notes ?? null,
    body.currency ?? 'AED', ctx.tenantId,
  ).catch(() => []);

  if (!je) return NextResponse.json({ error: 'Failed to create journal entry' }, { status: 500 });
  const jeId = (je as Record<string, string>).id;

  // Insert lines
  for (let i = 0; i < lines.length; i++) {
    const l   = lines[i];
    const acc = accMap.get(l.accountCode);
    await prisma.$executeRawUnsafe(
      `INSERT INTO finance_journal_lines
         (journal_entry_id, line_number, account_code, account_name, description,
          debit_amount, credit_amount, normal_balance, cost_centre)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      jeId, i + 1, l.accountCode, acc?.account_name ?? l.accountName ?? null,
      l.description ?? null,
      parseFloat(String(l.debitAmount)) || 0,
      parseFloat(String(l.creditAmount)) || 0,
      acc?.normal_balance ?? 'DEBIT',
      l.costCentre ?? null,
    ).catch(() => {});
  }

  // Return JE with lines
  const [result] = await prisma.$queryRawUnsafe<JeRow[]>(
    `SELECT je.*,
       json_agg(json_build_object(
         'id', jl.id, 'lineNumber', jl.line_number, 'accountCode', jl.account_code,
         'accountName', jl.account_name, 'description', jl.description,
         'debitAmount', jl.debit_amount, 'creditAmount', jl.credit_amount
       ) ORDER BY jl.line_number) as lines
     FROM finance_journal_entries je
     LEFT JOIN finance_journal_lines jl ON jl.journal_entry_id = je.id::text
     WHERE je.id = $1 GROUP BY je.id`, jeId
  ).catch(() => []);

  const created = result ?? je;
  await recordOperationalChange({
    req,
    ctx,
    entityType: 'FinanceJournalEntry',
    entityId: String(created.id ?? jeId),
    action: 'CREATE',
    after: created,
    summary: `Created journal entry ${String(created.je_number ?? jeNumber)}.`,
  });
  const workflow = await triggerServiceWorkflow({
    req,
    ctx,
    serviceTypeKey: 'FINANCE_BILLING_EXCEPTION',
    referenceType: 'JournalEntry',
    referenceId: String(created.id ?? jeId),
    referenceNumber: String(created.je_number ?? jeNumber),
    contextData: {
      sourceType: body.sourceType ?? 'MANUAL',
      totalDebit,
      totalCredit,
      status: created.status ?? 'DRAFT',
      narration: body.narration,
    },
  });
  return NextResponse.json({ ...created, workflow }, { status: 201 });
}
