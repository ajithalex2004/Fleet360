export const dynamic = 'force-dynamic';

/**
 * Bank Reconciliation API — /api/finance/bank-reconciliation
 * CSV statement import, match/unmatch workflow
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

type StmtRow = Record<string, unknown>;
type LineRow  = Record<string, unknown>;

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const sp            = req.nextUrl.searchParams;
      const bankAccountId = sp.get('bankAccountId');
      const statementId   = sp.get('statementId');
      const matchStatus   = sp.get('matchStatus');

      if (statementId) {
        // Return lines for a specific statement
        let where = `WHERE tenant_id = $1 AND statement_id = $2`;
        const params: unknown[] = [tenantId, statementId];
        if (matchStatus) { where += ` AND match_status = $3`; params.push(matchStatus); }
        const lines = await tx.$queryRawUnsafe<LineRow[]>(
          `SELECT * FROM finance_bank_statement_lines ${where} ORDER BY txn_date ASC`, ...params
        ).catch(() => []);

        const [stats] = await tx.$queryRawUnsafe<{total: string; matched: string; unmatched: string; excluded: string}[]>(
          `SELECT COUNT(*)::text as total,
                  SUM(CASE WHEN match_status='MATCHED'   THEN 1 ELSE 0 END)::text as matched,
                  SUM(CASE WHEN match_status='UNMATCHED' THEN 1 ELSE 0 END)::text as unmatched,
                  SUM(CASE WHEN match_status='EXCLUDED'  THEN 1 ELSE 0 END)::text as excluded
           FROM finance_bank_statement_lines WHERE tenant_id=$1 AND statement_id=$2`, tenantId, statementId
        ).catch(() => [{ total: '0', matched: '0', unmatched: '0', excluded: '0' }]);

        return NextResponse.json({ lines, stats });
      }

      // Return statements list
      let where = `WHERE s.tenant_id = $1`;
      const params: unknown[] = [tenantId];
      let pi = 2;
      if (bankAccountId) { where += ` AND bank_account_id = $${pi++}`; params.push(bankAccountId); }

      const statements = await tx.$queryRawUnsafe<StmtRow[]>(
        `SELECT s.*,
                COUNT(l.id)::text as total_lines,
                SUM(CASE WHEN l.match_status='MATCHED' THEN 1 ELSE 0 END)::text as matched_lines,
                SUM(CASE WHEN l.match_status='UNMATCHED' THEN 1 ELSE 0 END)::text as unmatched_lines
         FROM finance_bank_statements s
         LEFT JOIN finance_bank_statement_lines l ON l.statement_id = s.id::text AND l.tenant_id = s.tenant_id
         ${where} GROUP BY s.id ORDER BY s.statement_date DESC`, ...params
      ).catch(() => []);

      return NextResponse.json({ data: statements });
  });
}

export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

      if (body.action === 'import') {
        const [stmt] = await tx.$queryRawUnsafe<StmtRow[]>(
          `INSERT INTO finance_bank_statements
             (tenant_id, bank_account_id, statement_date, period_start, period_end, opening_balance, closing_balance, imported_by, notes)
           VALUES ($1,$2,$3::date,$4::date,$5::date,$6::numeric,$7::numeric,$8,$9) RETURNING *`,
          tenantId, body.bankAccountId, body.statementDate ?? new Date().toISOString().slice(0,10),
          body.periodStart, body.periodEnd,
          body.openingBalance ?? 0, body.closingBalance ?? 0,
          body.importedBy ?? null, body.notes ?? null,
        ).catch(() => []);

        if (!stmt) return NextResponse.json({ error: 'Failed to create statement' }, { status: 500 });
        const stmtId = (stmt as Record<string, string>).id;

        // Insert lines
        let inserted = 0;
        for (const line of (body.lines ?? []) as Record<string,string>[]) {
          await tx.$executeRawUnsafe(
            `INSERT INTO finance_bank_statement_lines
               (tenant_id, statement_id, txn_date, value_date, description, reference, debit, credit, balance)
             VALUES ($1,$2,$3::date,$4::date,$5,$6,$7::numeric,$8::numeric,$9::numeric)`,
            tenantId, stmtId, line.txnDate, line.valueDate ?? null, line.description,
            line.reference ?? null, line.debit ?? null, line.credit ?? null, line.balance ?? null,
          ).catch(() => {});
          inserted++;
        }

        return NextResponse.json({ statement: stmt, linesInserted: inserted }, { status: 201 });
      }

      if (body.action === 'match_line') {
        const now = new Date().toISOString();
        await tx.$executeRawUnsafe(
          `UPDATE finance_bank_statement_lines
           SET match_status='MATCHED', matched_payment_id=$2, matched_at=$3::timestamptz, matched_by=$4
           WHERE id::text=$1 AND tenant_id=$5`,
          body.lineId, body.paymentId, now, body.matchedBy ?? 'System', tenantId
        ).catch(() => {});
        return NextResponse.json({ ok: true });
      }

      if (body.action === 'unmatch_line') {
        await tx.$executeRawUnsafe(
          `UPDATE finance_bank_statement_lines
           SET match_status='UNMATCHED', matched_payment_id=NULL, matched_at=NULL, matched_by=NULL
           WHERE id::text=$1 AND tenant_id=$2`, body.lineId, tenantId
        ).catch(() => {});
        return NextResponse.json({ ok: true });
      }

      if (body.action === 'exclude_line') {
        await tx.$executeRawUnsafe(
          `UPDATE finance_bank_statement_lines SET match_status='EXCLUDED', notes=$2 WHERE id::text=$1 AND tenant_id=$3`,
          body.lineId, body.reason ?? 'Excluded', tenantId
        ).catch(() => {});
        return NextResponse.json({ ok: true });
      }

      // Auto-match: match unmatched lines against finance_payments, finance_invoices, finance_payables, and finance_expenses
      if (body.action === 'auto_match') {
        const statementId = body.statementId;
        const unmatched = await tx.$queryRawUnsafe<{id: string; credit: string | null; debit: string | null; txn_date: string}[]>(
          `SELECT id, credit::text, debit::text, txn_date FROM finance_bank_statement_lines
           WHERE tenant_id=$1 AND statement_id=$2 AND match_status='UNMATCHED'`, tenantId, statementId
        ).catch(() => []);

        let matched = 0;
        for (const line of unmatched) {
          let candidateId: string | null = null;

          if (line.credit && Number(line.credit) > 0) {
            // Check finance_payments or finance_invoices
            const [payment] = await tx.$queryRawUnsafe<{id: string}[]>(
              `SELECT id::text as id FROM finance_payments
               WHERE tenant_id = $3
                 AND amount::numeric = $1::numeric
                 AND payment_date::date BETWEEN ($2::date - INTERVAL '7 days') AND ($2::date + INTERVAL '7 days')
                 AND id::text NOT IN (SELECT matched_payment_id::text FROM finance_bank_statement_lines
                                WHERE tenant_id = $3 AND matched_payment_id IS NOT NULL)
               UNION ALL
               SELECT id::text as id FROM finance_invoices
               WHERE tenant_id = $3 AND deleted_at IS NULL
                 AND total_amount::numeric = $1::numeric
                 AND issue_date::date BETWEEN ($2::date - INTERVAL '14 days') AND ($2::date + INTERVAL '14 days')
                 AND id::text NOT IN (SELECT matched_payment_id::text FROM finance_bank_statement_lines
                                WHERE tenant_id = $3 AND matched_payment_id IS NOT NULL)
               LIMIT 1`, line.credit, line.txn_date, tenantId
            ).catch(() => []);
            candidateId = payment?.id ?? null;
          } else if (line.debit && Number(line.debit) > 0) {
            // Check finance_payables, finance_expenses, or finance_payments
            const [payableOrExp] = await tx.$queryRawUnsafe<{id: string}[]>(
              `SELECT id::text as id FROM finance_payables
               WHERE tenant_id = $3 AND deleted_at IS NULL
                 AND total_amount::numeric = $1::numeric
                 AND issue_date::date BETWEEN ($2::date - INTERVAL '14 days') AND ($2::date + INTERVAL '14 days')
                 AND id::text NOT IN (SELECT matched_payment_id::text FROM finance_bank_statement_lines
                                WHERE tenant_id = $3 AND matched_payment_id IS NOT NULL)
               UNION ALL
               SELECT id::text as id FROM finance_expenses
               WHERE tenant_id = $3 AND deleted_at IS NULL
                 AND total_amount::numeric = $1::numeric
                 AND expense_date::date BETWEEN ($2::date - INTERVAL '14 days') AND ($2::date + INTERVAL '14 days')
                 AND id::text NOT IN (SELECT matched_payment_id::text FROM finance_bank_statement_lines
                                WHERE tenant_id = $3 AND matched_payment_id IS NOT NULL)
               UNION ALL
               SELECT id::text as id FROM finance_payments
               WHERE tenant_id = $3
                 AND amount::numeric = $1::numeric
                 AND payment_date::date BETWEEN ($2::date - INTERVAL '7 days') AND ($2::date + INTERVAL '7 days')
                 AND id::text NOT IN (SELECT matched_payment_id::text FROM finance_bank_statement_lines
                                WHERE tenant_id = $3 AND matched_payment_id IS NOT NULL)
               LIMIT 1`, line.debit, line.txn_date, tenantId
            ).catch(() => []);
            candidateId = payableOrExp?.id ?? null;
          }

          if (candidateId) {
            await tx.$executeRawUnsafe(
              `UPDATE finance_bank_statement_lines
               SET match_status='MATCHED', matched_payment_id=$2, matched_at=NOW(), matched_by='Auto'
               WHERE id::text=$1 AND tenant_id=$3`, line.id, candidateId, tenantId
            ).catch(() => {});
            matched++;
          }
        }

        return NextResponse.json({ autoMatched: matched });
      }

      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  });
}
