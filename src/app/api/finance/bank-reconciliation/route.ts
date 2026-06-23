/**
 * Bank Reconciliation API — /api/finance/bank-reconciliation
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureOperationalTenantColumn, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { createCashReceipt, ensureCashAllocationTables } from '@/lib/finance/cash-allocation';

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
    notes            TEXT,
    tenant_id        TEXT
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
    notes               TEXT,
    tenant_id           TEXT
  );
`;

type StmtRow = Record<string, unknown>;
type LineRow = Record<string, unknown>;

async function ensureReconciliationSchema() {
  await ensureCashAllocationTables();
  await prisma.$executeRawUnsafe(INIT_STATEMENTS).catch(() => {});
  await prisma.$executeRawUnsafe(INIT_LINES).catch(() => {});
  await ensureOperationalTenantColumn('finance_bank_statements').catch(() => {});
  await ensureOperationalTenantColumn('finance_bank_statement_lines').catch(() => {});
}

export async function GET(req: NextRequest) {
  await ensureReconciliationSchema();
  const ctx = requireOperationalContext(req, 'finance', {
    requestedTenantId: req.nextUrl.searchParams.get('tenantId'),
  });
  if (ctx instanceof NextResponse) return ctx;

  const sp = req.nextUrl.searchParams;
  const bankAccountId = sp.get('bankAccountId');
  const statementId = sp.get('statementId');
  const matchStatus = sp.get('matchStatus');

  if (statementId) {
    let where = `WHERE statement_id = $1 AND tenant_id::text = $2`;
    const params: unknown[] = [statementId, ctx.tenantId];
    if (matchStatus) {
      where += ` AND match_status = $3`;
      params.push(matchStatus);
    }
    const lines = await prisma.$queryRawUnsafe<LineRow[]>(
      `SELECT * FROM finance_bank_statement_lines ${where} ORDER BY txn_date ASC`,
      ...params,
    ).catch(() => []);

    const [stats] = await prisma.$queryRawUnsafe<{ total: string; matched: string; unmatched: string; excluded: string }[]>(
      `SELECT COUNT(*)::text as total,
              SUM(CASE WHEN match_status='MATCHED' THEN 1 ELSE 0 END)::text as matched,
              SUM(CASE WHEN match_status='UNMATCHED' THEN 1 ELSE 0 END)::text as unmatched,
              SUM(CASE WHEN match_status='EXCLUDED' THEN 1 ELSE 0 END)::text as excluded
       FROM finance_bank_statement_lines
       WHERE statement_id=$1 AND tenant_id::text = $2`,
      statementId,
      ctx.tenantId,
    ).catch(() => [{ total: '0', matched: '0', unmatched: '0', excluded: '0' }]);

    return NextResponse.json({ lines, stats });
  }

  let where = `WHERE s.tenant_id::text = $1`;
  const params: unknown[] = [ctx.tenantId];
  if (bankAccountId) {
    where += ` AND s.bank_account_id = $2`;
    params.push(bankAccountId);
  }

  const statements = await prisma.$queryRawUnsafe<StmtRow[]>(
    `SELECT s.*,
            COUNT(l.id)::text as total_lines,
            SUM(CASE WHEN l.match_status='MATCHED' THEN 1 ELSE 0 END)::text as matched_lines,
            SUM(CASE WHEN l.match_status='UNMATCHED' THEN 1 ELSE 0 END)::text as unmatched_lines
     FROM finance_bank_statements s
     LEFT JOIN finance_bank_statement_lines l
       ON l.statement_id = s.id::text
      AND l.tenant_id::text = s.tenant_id::text
     ${where}
     GROUP BY s.id
     ORDER BY s.statement_date DESC`,
    ...params,
  ).catch(() => []);

  return NextResponse.json({ data: statements });
}

export async function POST(req: NextRequest) {
  await ensureReconciliationSchema();
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json();

  if (body.action === 'import') {
    const [bankAccount] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM finance_bank_accounts
       WHERE id::text = $1 AND deleted_at IS NULL AND tenant_id::text = $2
       LIMIT 1`,
      body.bankAccountId,
      ctx.tenantId,
    ).catch(() => []);
    if (!bankAccount) {
      return NextResponse.json({ error: 'Bank account not found' }, { status: 404 });
    }

    const [stmt] = await prisma.$queryRawUnsafe<StmtRow[]>(
      `INSERT INTO finance_bank_statements
         (bank_account_id, statement_date, period_start, period_end, opening_balance, closing_balance, imported_by, notes, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      body.bankAccountId,
      body.statementDate ?? new Date().toISOString().slice(0, 10),
      body.periodStart,
      body.periodEnd,
      body.openingBalance ?? 0,
      body.closingBalance ?? 0,
      body.importedBy ?? ctx.userId,
      body.notes ?? null,
      ctx.tenantId,
    ).catch(() => []);

    if (!stmt) return NextResponse.json({ error: 'Failed to create statement' }, { status: 500 });
    const stmtId = String(stmt.id ?? '');
    let inserted = 0;
    for (const line of (body.lines ?? []) as Record<string, string>[]) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO finance_bank_statement_lines
           (statement_id, txn_date, value_date, description, reference, debit, credit, balance, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        stmtId,
        line.txnDate,
        line.valueDate ?? null,
        line.description,
        line.reference ?? null,
        line.debit ?? null,
        line.credit ?? null,
        line.balance ?? null,
        ctx.tenantId,
      ).catch(() => {});
      inserted++;
    }

    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinanceBankStatement',
      entityId: stmtId,
      action: 'IMPORT',
      after: { statement: stmt, linesInserted: inserted },
      summary: `Imported bank statement with ${inserted} lines.`,
      riskSeverity: 'medium',
    });

    return NextResponse.json({ statement: stmt, linesInserted: inserted }, { status: 201 });
  }

  if (body.action === 'match_line') {
    const [before] = await prisma.$queryRawUnsafe<LineRow[]>(
      `SELECT * FROM finance_bank_statement_lines WHERE id::text = $1 AND tenant_id::text = $2 LIMIT 1`,
      body.lineId,
      ctx.tenantId,
    ).catch(() => []);
    await prisma.$executeRawUnsafe(
      `UPDATE finance_bank_statement_lines
       SET match_status='MATCHED', matched_payment_id=$2, matched_at=$3, matched_by=$4
       WHERE id::text=$1 AND tenant_id::text = $5`,
      body.lineId,
      body.paymentId,
      new Date().toISOString(),
      body.matchedBy ?? ctx.userId,
      ctx.tenantId,
    ).catch(() => {});
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinanceBankStatementLine',
      entityId: String(body.lineId),
      action: 'STATUS_CHANGE',
      before,
      after: { matchStatus: 'MATCHED', matchedPaymentId: body.paymentId },
      summary: `Matched bank statement line ${String(body.lineId)}.`,
      riskSeverity: 'medium',
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'unmatch_line') {
    const [before] = await prisma.$queryRawUnsafe<LineRow[]>(
      `SELECT * FROM finance_bank_statement_lines WHERE id::text = $1 AND tenant_id::text = $2 LIMIT 1`,
      body.lineId,
      ctx.tenantId,
    ).catch(() => []);
    await prisma.$executeRawUnsafe(
      `UPDATE finance_bank_statement_lines
       SET match_status='UNMATCHED', matched_payment_id=NULL, matched_at=NULL, matched_by=NULL
       WHERE id::text=$1 AND tenant_id::text = $2`,
      body.lineId,
      ctx.tenantId,
    ).catch(() => {});
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinanceBankStatementLine',
      entityId: String(body.lineId),
      action: 'STATUS_CHANGE',
      before,
      after: { matchStatus: 'UNMATCHED' },
      summary: `Unmatched bank statement line ${String(body.lineId)}.`,
      riskSeverity: 'medium',
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'exclude_line') {
    const [before] = await prisma.$queryRawUnsafe<LineRow[]>(
      `SELECT * FROM finance_bank_statement_lines WHERE id::text = $1 AND tenant_id::text = $2 LIMIT 1`,
      body.lineId,
      ctx.tenantId,
    ).catch(() => []);
    await prisma.$executeRawUnsafe(
      `UPDATE finance_bank_statement_lines
       SET match_status='EXCLUDED', notes=$2
       WHERE id::text=$1 AND tenant_id::text = $3`,
      body.lineId,
      body.reason ?? 'Excluded',
      ctx.tenantId,
    ).catch(() => {});
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinanceBankStatementLine',
      entityId: String(body.lineId),
      action: 'STATUS_CHANGE',
      before,
      after: { matchStatus: 'EXCLUDED', notes: body.reason ?? 'Excluded' },
      summary: `Excluded bank statement line ${String(body.lineId)} from reconciliation.`,
      riskSeverity: 'medium',
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'auto_match') {
    const statementId = body.statementId;
    const unmatched = await prisma.$queryRawUnsafe<{ id: string; credit: string; txn_date: string; description: string; reference: string | null }[]>(
      `SELECT id::text, credit::text, txn_date, description, reference FROM finance_bank_statement_lines
       WHERE statement_id=$1 AND tenant_id::text = $2
         AND match_status='UNMATCHED' AND credit IS NOT NULL`,
      statementId,
      ctx.tenantId,
    ).catch(() => []);

    let matched = 0;
    let receiptsCreated = 0;
    for (const line of unmatched) {
      const [payment] = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM finance_payments
         WHERE tenant_id::text = $3
           AND amount::numeric = $1::numeric
           AND payment_date::date BETWEEN ($2::date - INTERVAL '3 days') AND ($2::date + INTERVAL '3 days')
           AND id NOT IN (
             SELECT matched_payment_id
             FROM finance_bank_statement_lines
             WHERE tenant_id::text = $3 AND matched_payment_id IS NOT NULL
           )
         LIMIT 1`,
        line.credit,
        line.txn_date,
        ctx.tenantId,
      ).catch(() => []);

      if (payment) {
        await prisma.$executeRawUnsafe(
          `UPDATE finance_bank_statement_lines
           SET match_status='MATCHED', matched_payment_id=$2, matched_at=NOW(), matched_by='Auto'
           WHERE id=$1 AND tenant_id::text = $3`,
          line.id,
          payment.id,
          ctx.tenantId,
        ).catch(() => {});
        matched++;
        continue;
      }

      const [invoice] = await prisma.$queryRawUnsafe<{
        id: string;
        invoice_number: string;
        client_name: string;
        client_email: string | null;
        outstanding: string;
      }[]>(
        `SELECT id::text, invoice_number, client_name, client_email,
                GREATEST(0, total_amount - paid_amount)::text AS outstanding
           FROM finance_invoices
          WHERE tenant_id::text = $1
            AND deleted_at IS NULL
            AND payment_status NOT IN ('PAID','CANCELLED','DRAFT')
            AND GREATEST(0, total_amount - paid_amount)::numeric = $2::numeric
            AND (
              ($3 <> '%%' AND (invoice_number ILIKE $3 OR client_name ILIKE $3))
              OR ($4 <> '%%' AND (invoice_number ILIKE $4 OR client_name ILIKE $4))
            )
          ORDER BY due_date ASC NULLS LAST, issue_date ASC NULLS LAST
          LIMIT 1`,
        ctx.tenantId,
        line.credit,
        `%${line.reference ?? ''}%`,
        `%${line.description ?? ''}%`,
      ).catch(() => []);

      if (invoice) {
        await createCashReceipt(req, ctx, {
          customerName: invoice.client_name,
          customerEmail: invoice.client_email,
          amount: Number(line.credit),
          receiptDate: line.txn_date,
          paymentMethod: 'BANK_TRANSFER',
          reference: line.reference ?? `BANK-${line.id}`,
          notes: `Auto-created from bank statement line: ${line.description}`,
          allocations: [{ invoiceId: invoice.id, amount: Number(line.credit) }],
          bankStatementLineId: line.id,
          source: 'BANK_AUTO_MATCH',
        });
        matched++;
        receiptsCreated++;
      }
    }

    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinanceBankStatement',
      entityId: String(statementId),
      action: 'UPDATE',
      after: { autoMatched: matched, receiptsCreated },
      summary: `Auto-matched ${matched} bank statement lines and created ${receiptsCreated} receipt voucher(s).`,
      riskSeverity: 'medium',
    });

    return NextResponse.json({ autoMatched: matched, receiptsCreated });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
