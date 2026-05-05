/**
 * Bank Reconciliation API — /api/finance/bank-reconciliation
 * CSV statement import, match/unmatch workflow
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const INIT_STATEMENTS = `
  CREATE TABLE IF NOT EXISTS finance_bank_statements (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    bank_account_id  TEXT NOT NULL,
    statement_date   DATE NOT NULL,
    period_start     DATE NOT NULL,
    period_end       DATE NOT NULL,
    opening_balance  NUMERIC(15,2) NOT NULL DEFAULT 0,
    closing_balance  NUMERIC(15,2) NOT NULL DEFAULT 0,
    imported_by      TEXT,
    notes            TEXT
  );
`;

const INIT_LINES = `
  CREATE TABLE IF NOT EXISTS finance_bank_statement_lines (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    statement_id        TEXT NOT NULL,
    txn_date            DATE NOT NULL,
    value_date          DATE,
    description         TEXT NOT NULL,
    reference           TEXT,
    debit               NUMERIC(15,2),
    credit              NUMERIC(15,2),
    balance             NUMERIC(15,2),
    match_status        TEXT DEFAULT 'UNMATCHED',
    matched_payment_id  TEXT,
    matched_at          TIMESTAMPTZ,
    matched_by          TEXT,
    notes               TEXT
  );
`;

type StmtRow = Record<string, unknown>;
type LineRow  = Record<string, unknown>;

export async function GET(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT_STATEMENTS).catch(() => {});
  await prisma.$executeRawUnsafe(INIT_LINES).catch(() => {});

  const sp            = req.nextUrl.searchParams;
  const bankAccountId = sp.get('bankAccountId');
  const statementId   = sp.get('statementId');
  const matchStatus   = sp.get('matchStatus');

  if (statementId) {
    // Return lines for a specific statement
    let where = `WHERE statement_id = $1`;
    const params: unknown[] = [statementId];
    if (matchStatus) { where += ` AND match_status = $2`; params.push(matchStatus); }
    const lines = await prisma.$queryRawUnsafe<LineRow[]>(
      `SELECT * FROM finance_bank_statement_lines ${where} ORDER BY txn_date ASC`, ...params
    ).catch(() => []);

    const [stats] = await prisma.$queryRawUnsafe<{total: string; matched: string; unmatched: string; excluded: string}[]>(
      `SELECT COUNT(*)::text as total,
              SUM(CASE WHEN match_status='MATCHED'   THEN 1 ELSE 0 END)::text as matched,
              SUM(CASE WHEN match_status='UNMATCHED' THEN 1 ELSE 0 END)::text as unmatched,
              SUM(CASE WHEN match_status='EXCLUDED'  THEN 1 ELSE 0 END)::text as excluded
       FROM finance_bank_statement_lines WHERE statement_id=$1`, statementId
    ).catch(() => [{ total: '0', matched: '0', unmatched: '0', excluded: '0' }]);

    return NextResponse.json({ lines, stats });
  }

  // Return statements list
  let where = `WHERE 1=1`;
  const params: unknown[] = [];
  let pi = 1;
  if (bankAccountId) { where += ` AND bank_account_id = $${pi++}`; params.push(bankAccountId); }

  const statements = await prisma.$queryRawUnsafe<StmtRow[]>(
    `SELECT s.*,
            COUNT(l.id)::text as total_lines,
            SUM(CASE WHEN l.match_status='MATCHED' THEN 1 ELSE 0 END)::text as matched_lines,
            SUM(CASE WHEN l.match_status='UNMATCHED' THEN 1 ELSE 0 END)::text as unmatched_lines
     FROM finance_bank_statements s
     LEFT JOIN finance_bank_statement_lines l ON l.statement_id = s.id::text
     ${where} GROUP BY s.id ORDER BY s.statement_date DESC`, ...params
  ).catch(() => []);

  return NextResponse.json({ data: statements });
}

export async function POST(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT_STATEMENTS).catch(() => {});
  await prisma.$executeRawUnsafe(INIT_LINES).catch(() => {});
  const body = await req.json();

  if (body.action === 'import') {
    // body.lines: [{txnDate, valueDate?, description, reference?, debit?, credit?, balance?}]
    const [stmt] = await prisma.$queryRawUnsafe<StmtRow[]>(
      `INSERT INTO finance_bank_statements
         (bank_account_id, statement_date, period_start, period_end, opening_balance, closing_balance, imported_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      body.bankAccountId, body.statementDate ?? new Date().toISOString().slice(0,10),
      body.periodStart, body.periodEnd,
      body.openingBalance ?? 0, body.closingBalance ?? 0,
      body.importedBy ?? null, body.notes ?? null,
    ).catch(() => []);

    if (!stmt) return NextResponse.json({ error: 'Failed to create statement' }, { status: 500 });
    const stmtId = (stmt as Record<string, string>).id;

    // Insert lines
    let inserted = 0;
    for (const line of (body.lines ?? []) as Record<string,string>[]) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO finance_bank_statement_lines
           (statement_id, txn_date, value_date, description, reference, debit, credit, balance)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        stmtId, line.txnDate, line.valueDate ?? null, line.description,
        line.reference ?? null, line.debit ?? null, line.credit ?? null, line.balance ?? null,
      ).catch(() => {});
      inserted++;
    }

    return NextResponse.json({ statement: stmt, linesInserted: inserted }, { status: 201 });
  }

  if (body.action === 'match_line') {
    // Match a statement line to a payment
    const now = new Date().toISOString();
    await prisma.$executeRawUnsafe(
      `UPDATE finance_bank_statement_lines
       SET match_status='MATCHED', matched_payment_id=$2, matched_at=$3, matched_by=$4
       WHERE id=$1`,
      body.lineId, body.paymentId, now, body.matchedBy ?? 'System'
    ).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'unmatch_line') {
    await prisma.$executeRawUnsafe(
      `UPDATE finance_bank_statement_lines
       SET match_status='UNMATCHED', matched_payment_id=NULL, matched_at=NULL, matched_by=NULL
       WHERE id=$1`, body.lineId
    ).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'exclude_line') {
    await prisma.$executeRawUnsafe(
      `UPDATE finance_bank_statement_lines SET match_status='EXCLUDED', notes=$2 WHERE id=$1`,
      body.lineId, body.reason ?? 'Excluded'
    ).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  // Auto-match: try to match unmatched lines to finance_payments by amount + date
  if (body.action === 'auto_match') {
    const statementId = body.statementId;
    const unmatched = await prisma.$queryRawUnsafe<{id: string; credit: string; txn_date: string}[]>(
      `SELECT id, credit::text, txn_date FROM finance_bank_statement_lines
       WHERE statement_id=$1 AND match_status='UNMATCHED' AND credit IS NOT NULL`, statementId
    ).catch(() => []);

    let matched = 0;
    for (const line of unmatched) {
      const [payment] = await prisma.$queryRawUnsafe<{id: string}[]>(
        `SELECT id FROM finance_payments
         WHERE amount::numeric = $1::numeric
           AND payment_date::date BETWEEN ($2::date - INTERVAL '3 days') AND ($2::date + INTERVAL '3 days')
           AND id NOT IN (SELECT matched_payment_id FROM finance_bank_statement_lines WHERE matched_payment_id IS NOT NULL)
         LIMIT 1`, line.credit, line.txn_date
      ).catch(() => []);

      if (payment) {
        await prisma.$executeRawUnsafe(
          `UPDATE finance_bank_statement_lines
           SET match_status='MATCHED', matched_payment_id=$2, matched_at=NOW(), matched_by='Auto'
           WHERE id=$1`, line.id, payment.id
        ).catch(() => {});
        matched++;
      }
    }

    return NextResponse.json({ autoMatched: matched });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
