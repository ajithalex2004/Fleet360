export const dynamic = 'force-dynamic';

/**
 * Journal Entries API — /api/finance/journal-entries
 *
 * Double-entry accounting: every entry must balance (total debits = total credits).
 * Lifecycle: DRAFT → SUBMITTED → APPROVED → POSTED → REVERSED
 *
 * Schema is owned by migration 20260809000000_adopt_finance_tables_with_rls.
 * Runtime CREATE TABLE DDL removed — tables are guaranteed present at boot.
 *
 * All queries are scoped to the tenantId returned by requireAuthorizedTenant,
 * never to the raw x-tenant-id header. There is no platform-admin ('*') bypass
 * on this route: sanitizeTenantId() strips the wildcard and an empty tenant is
 * rejected with a 403, so '*' can never reach a query.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
type JeRow   = Record<string, unknown>;

// ── helpers ───────────────────────────────────────────────────────────────────

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

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const sp     = req.nextUrl.searchParams;
      const status = sp.get('status');
      const source = sp.get('source');
      const from   = sp.get('from');
      const to     = sp.get('to');
      const page   = Math.max(1, parseInt(sp.get('page')  ?? '1'));
      const limit  = Math.min(100, parseInt(sp.get('limit') ?? '50'));
      const offset = (page - 1) * limit;

      // Always scope by tenant. requireAuthorizedTenant never yields '*' —
      // sanitizeTenantId() strips the wildcard, and an empty tenant is
      // rejected with a 403 — so there is no platform-admin bypass here.
      let where = `WHERE je.deleted_at IS NULL AND je.tenant_id = $1`;
      const params: unknown[] = [tenantId];
      let pi = 2;
      if (status) { where += ` AND je.status = $${pi++}`;      params.push(status); }
      if (source) { where += ` AND je.source_type = $${pi++}`; params.push(source); }
      // entry_date is a DATE column and these params arrive as text, so the
      // cast is required — without it Postgres raises 42883 (date >= text),
      // which the .catch() below would silently turn into an empty result.
      if (from)   { where += ` AND je.entry_date >= $${pi++}::date`; params.push(from); }
      if (to)     { where += ` AND je.entry_date <= $${pi++}::date`; params.push(to); }

      const [entries, counts] = await Promise.all([
        tx.$queryRawUnsafe<JeRow[]>(
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
           LEFT JOIN finance_journal_lines jl ON jl.journal_entry_id = je.id::text
           ${where}
           GROUP BY je.id
           ORDER BY je.entry_date DESC, je.je_number DESC
           LIMIT $${pi} OFFSET $${pi + 1}`,
          ...params, limit, offset,
        ).catch(() => [] as JeRow[]),

        tx.$queryRawUnsafe<{ status: string; count: string; total_debit: string }[]>(
          `SELECT status, COUNT(*)::text AS count,
                  COALESCE(SUM(total_debit), 0)::text AS total_debit
             FROM finance_journal_entries
            WHERE deleted_at IS NULL AND tenant_id = $1
            GROUP BY status`,
          tenantId,
        ).catch(() => []),
      ]);

      return NextResponse.json({ data: entries, counts, page, limit });
  });
}


// ── POST /api/finance/journal-entries ────────────────────────────────────────

export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

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
      const accounts = await tx.$queryRawUnsafe<
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

      const [je] = await tx.$queryRawUnsafe<JeRow[]>(
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
        await tx.$executeRawUnsafe(
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

      const [result] = await tx.$queryRawUnsafe<JeRow[]>(
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
         LEFT JOIN finance_journal_lines jl ON jl.journal_entry_id = je.id::text
         WHERE je.id::text = $1 GROUP BY je.id`,
        jeId,
      ).catch(() => []);

      return NextResponse.json(result ?? je, { status: 201 });
  });
}

