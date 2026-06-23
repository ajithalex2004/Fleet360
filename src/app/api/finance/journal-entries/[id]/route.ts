/**
 * Journal Entry individual operations — status transitions + reversal
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureOperationalTenantColumn, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

type JeRow = Record<string, unknown>;

type CurrentJeRow = {
  status: string;
  je_number: string;
  entry_date: string;
  narration: string;
  total_debit: string;
  source_type?: string;
};

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureOperationalTenantColumn('finance_journal_entries').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;
  const [je] = await prisma.$queryRawUnsafe<JeRow[]>(
    `SELECT je.*,
       json_agg(json_build_object(
         'id', jl.id, 'lineNumber', jl.line_number, 'accountCode', jl.account_code,
         'accountName', jl.account_name, 'description', jl.description,
         'debitAmount', jl.debit_amount, 'creditAmount', jl.credit_amount, 'costCentre', jl.cost_centre
       ) ORDER BY jl.line_number) FILTER (WHERE jl.id IS NOT NULL) as lines
     FROM finance_journal_entries je
     LEFT JOIN finance_journal_lines jl ON jl.journal_entry_id = je.id::text
     WHERE je.id = $1 AND je.tenant_id::text = $2 AND je.deleted_at IS NULL GROUP BY je.id`, params.id, ctx.tenantId
  ).catch(() => [] as JeRow[]);
  if (!je) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(je);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureOperationalTenantColumn('finance_journal_entries').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json();
  const { action } = body;
  const now = new Date().toISOString();

  // Fetch current JE
  const [current] = await prisma.$queryRawUnsafe<CurrentJeRow[]>(
    `SELECT status, je_number, entry_date, narration, total_debit, source_type FROM finance_journal_entries WHERE id=$1 AND tenant_id::text = $2`,
    params.id,
    ctx.tenantId,
  ).catch(() => [] as CurrentJeRow[]);
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let sql = '';
  let sqlParams: unknown[] = [];

  switch (action) {
    case 'submit':
      if (current.status !== 'DRAFT') return NextResponse.json({ error: 'Only DRAFT entries can be submitted' }, { status: 400 });
      sql = `UPDATE finance_journal_entries SET status='SUBMITTED', updated_at=$2 WHERE id=$1 AND tenant_id::text = $3 RETURNING *`;
      sqlParams = [params.id, now, ctx.tenantId];
      break;

    case 'approve':
      if (current.status !== 'SUBMITTED') return NextResponse.json({ error: 'Only SUBMITTED entries can be approved' }, { status: 400 });
      sql = `UPDATE finance_journal_entries SET status='APPROVED', approved_by=$2, approved_at=$3, updated_at=$3 WHERE id=$1 AND tenant_id::text = $4 RETURNING *`;
      sqlParams = [params.id, body.approvedBy ?? 'Finance Manager', now, ctx.tenantId];
      break;

    case 'post':
      if (!['APPROVED', 'SUBMITTED'].includes(current.status)) return NextResponse.json({ error: 'Entry must be APPROVED before posting' }, { status: 400 });
      sql = `UPDATE finance_journal_entries SET status='POSTED', posted_by=$2, posted_at=$3, updated_at=$3 WHERE id=$1 AND tenant_id::text = $4 RETURNING *`;
      sqlParams = [params.id, body.postedBy ?? 'Finance Manager', now, ctx.tenantId];
      break;

    case 'void':
      if (current.status === 'POSTED') return NextResponse.json({ error: 'Posted entries cannot be voided — use Reverse instead' }, { status: 400 });
      sql = `UPDATE finance_journal_entries SET status='VOID', updated_at=$2, notes=COALESCE($3,notes) WHERE id=$1 AND tenant_id::text = $4 RETURNING *`;
      sqlParams = [params.id, now, body.notes ?? null, ctx.tenantId];
      break;

    case 'reverse': {
      if (current.status !== 'POSTED') return NextResponse.json({ error: 'Only POSTED entries can be reversed' }, { status: 400 });

      // Get lines
      const lines = await prisma.$queryRawUnsafe<{account_code: string; account_name: string; description: string; debit_amount: string; credit_amount: string; normal_balance: string; cost_centre: string}[]>(
        `SELECT * FROM finance_journal_lines WHERE journal_entry_id = $1 ORDER BY line_number`, params.id
      ).catch(() => []);

      // Generate reversal JE number
      const [{ count }] = await prisma.$queryRawUnsafe<{count: string}[]>(
        `SELECT COUNT(*)::text as count FROM finance_journal_entries`
      ).catch(() => [{ count: '0' }]);
      const ym  = new Date().toISOString().slice(0, 7).replace('-', '');
      const seq = (parseInt(count) + 1).toString().padStart(5, '0');
      const revJeNo = `JE-${ym}-${seq}-REV`;

      const revDate    = body.reversalDate ?? new Date().toISOString().slice(0, 10);
      const d          = new Date(revDate);
      const totalDebit = parseFloat(current.total_debit);

      const [revJe] = await prisma.$queryRawUnsafe<JeRow[]>(
        `INSERT INTO finance_journal_entries
           (je_number, entry_date, period_year, period_month, narration, source_type,
            source_id, status, total_debit, total_credit, is_balanced,
            reversed_je_id, prepared_by, currency, tenant_id)
         VALUES ($1,$2,$3,$4,$5,'REVERSAL',$6,'POSTED',$7,$7,TRUE,$8,$9,'AED',$10)
         RETURNING *`,
        revJeNo, revDate, d.getFullYear(), d.getMonth() + 1,
        `Reversal of ${current.je_number}: ${current.narration}`,
        params.id, totalDebit, params.id, body.reversedBy ?? 'Finance Manager', ctx.tenantId,
      ).catch(() => []);

      if (!revJe) return NextResponse.json({ error: 'Failed to create reversal JE' }, { status: 500 });
      const revId = (revJe as Record<string, string>).id;

      // Flip debit/credit for each line
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        await prisma.$executeRawUnsafe(
          `INSERT INTO finance_journal_lines
             (journal_entry_id, line_number, account_code, account_name, description,
              debit_amount, credit_amount, normal_balance, cost_centre)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          revId, i + 1, l.account_code, l.account_name,
          `Reversal: ${l.description ?? ''}`,
          l.credit_amount, // flip: credit becomes debit
          l.debit_amount,  // flip: debit becomes credit
          l.normal_balance, l.cost_centre,
        ).catch(() => {});
      }

      // Mark original as REVERSED, link reversal JE
      await prisma.$executeRawUnsafe(
        `UPDATE finance_journal_entries SET status='REVERSED', reversal_je_id=$2, updated_at=$3 WHERE id=$1 AND tenant_id::text = $4`,
        params.id, revId, now, ctx.tenantId
      ).catch(() => {});

      await recordOperationalChange({
        req,
        ctx,
        entityType: 'FinanceJournalEntry',
        entityId: params.id,
        action: 'STATUS_CHANGE',
        before: current,
        after: { status: 'REVERSED', reversalJeId: revId },
        summary: `Reversed journal entry ${current.je_number ?? params.id}.`,
      });
      const workflow = await triggerServiceWorkflow({
        req,
        ctx,
        serviceTypeKey: 'FINANCE_BILLING_EXCEPTION',
        referenceType: 'JournalEntry',
        referenceId: params.id,
        referenceNumber: current.je_number ?? params.id,
        contextData: {
          action: 'reverse',
          previousStatus: current.status,
          status: 'REVERSED',
          reversalJeId: revId,
          sourceType: current.source_type ?? null,
        },
        force: true,
      });

      return NextResponse.json({ original: params.id, reversalJe: revJe, workflow });
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  const [row] = await prisma.$queryRawUnsafe<JeRow[]>(sql, ...sqlParams).catch(() => [] as JeRow[]);
  if (!row) return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  await recordOperationalChange({
    req,
    ctx,
    entityType: 'FinanceJournalEntry',
    entityId: params.id,
    action: action === 'submit' || action === 'approve' || action === 'post' || action === 'void' ? 'STATUS_CHANGE' : 'UPDATE',
    before: current,
    after: row,
    summary: `Updated journal entry ${String(row.je_number ?? params.id)} via ${action}.`,
  });
  const workflow = await triggerServiceWorkflow({
    req,
    ctx,
    serviceTypeKey: 'FINANCE_BILLING_EXCEPTION',
    referenceType: 'JournalEntry',
    referenceId: params.id,
    referenceNumber: String(row.je_number ?? params.id),
    contextData: {
      action,
      previousStatus: current.status,
      status: row.status ?? null,
      sourceType: current.source_type ?? null,
      totalDebit: row.total_debit ?? current.total_debit,
    },
    force: action === 'approve' || action === 'post' || action === 'void',
  });
  return NextResponse.json({ ...row, workflow });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureOperationalTenantColumn('finance_journal_entries').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const [je] = await prisma.$queryRawUnsafe<{status: string}[]>(
    `SELECT status FROM finance_journal_entries WHERE id=$1 AND tenant_id::text = $2`, params.id, ctx.tenantId
  ).catch(() => [] as {status: string}[]);
  if (!je) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (je?.status === 'POSTED') return NextResponse.json({ error: 'Posted entries cannot be deleted' }, { status: 400 });
  await prisma.$executeRawUnsafe(`UPDATE finance_journal_entries SET deleted_at=NOW() WHERE id=$1 AND tenant_id::text = $2`, params.id, ctx.tenantId).catch(() => {});
  await recordOperationalChange({
    req,
    ctx,
    entityType: 'FinanceJournalEntry',
    entityId: params.id,
    action: 'DELETE',
    before: je,
    after: null,
    summary: `Deleted journal entry ${params.id}.`,
  });
  return NextResponse.json({ ok: true });
}
