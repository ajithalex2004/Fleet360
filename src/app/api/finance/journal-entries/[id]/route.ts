export const dynamic = 'force-dynamic';

/**
 * Journal Entry individual operations — status transitions + reversal
 *
 * All reads and writes are scoped to the tenantId returned by
 * requireAuthorizedTenant, never to the raw x-tenant-id header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { approvalGate, approvalInProgress, withApprovalStart } from '@/lib/workflow/approvals';
import { sessionUser } from '@/lib/session-user';
import { nextJournalNumber } from '@/lib/finance/journal-service';
type JeRow = Record<string, unknown>;

// ── GET /api/finance/journal-entries/:id ─────────────────────────────────────

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      // Interpolation is safe here: tenantId comes from requireAuthorizedTenant,
      // which runs it through sanitizeTenantId() ([a-zA-Z0-9_-] only). The raw
      // x-tenant-id header must never be used for this — it is unsanitised.
      const tenantClause = `AND je.tenant_id = '${tenantId}'`;

      const [je] = await tx.$queryRawUnsafe<JeRow[]>(
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
         LEFT JOIN finance_journal_lines jl ON jl.journal_entry_id::text = je.id::text
         WHERE je.id::text = $1 AND je.deleted_at IS NULL ${tenantClause}
         GROUP BY je.id`,
        params.id,
      ).catch(() => [] as JeRow[]);

      if (!je) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(je);
  });
}


// ── PATCH /api/finance/journal-entries/:id ───────────────────────────────────

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const body = stripTenantOwnershipFields(await req.json());
  const { action } = body;
  // A company's journal approval workflow (Admin > Workflows) decides
  // submitted entries: approve / reject go to the level that is waiting, and
  // the entry can't be posted or voided until the workflow has decided.
  if (action === 'approve' || action === 'reject') {
    const gated = await approvalGate({
      headers: req.headers, tenantId, referenceType: 'finance_journal', referenceId: params.id,
      action: action === 'reject' ? 'REJECT' : 'APPROVE',
      comments: String((action === 'reject' ? body.reason : body.notes) ?? ''),
    });
    if (gated) return gated;
  } else if (action === 'post' || action === 'void') {
    const busy = await approvalInProgress(tenantId, 'finance_journal', params.id);
    if (busy) return busy;
  }

  // No statement in this transaction swallows its error: a failed statement
  // aborts the transaction, so a swallowed one let the handler answer
  // success (a reversal with no lines, say) while the COMMIT rolled back.
  let response: NextResponse;
  try {
  response = await withTenantRls(prisma, tenantId, async (tx) => {
      const now = new Date().toISOString();

      // Fetch current JE — enforce tenant ownership.
      const [current] = await tx.$queryRawUnsafe<
        { status: string; je_number: string; entry_date: string; narration: string; total_debit: string; tenant_id: string }[]
      >(
        `SELECT status, je_number, entry_date, narration, total_debit, tenant_id
           FROM finance_journal_entries
          WHERE id::text = $1 AND deleted_at IS NULL AND tenant_id = $2`,
        params.id, tenantId,
      );

      if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      let sql        = '';
      let sqlParams: unknown[] = [];

      switch (action) {
        case 'submit':
          if (current.status !== 'DRAFT') {
            return NextResponse.json({ error: 'Only DRAFT entries can be submitted' }, { status: 400 });
          }
          sql = `UPDATE finance_journal_entries
                    SET status = 'SUBMITTED', updated_at = $2::timestamptz
                  WHERE id::text = $1 AND tenant_id = $3
                  RETURNING *`;
          sqlParams = [params.id, now, tenantId];
          break;

        case 'approve':
          if (current.status !== 'SUBMITTED') {
            return NextResponse.json({ error: 'Only SUBMITTED entries can be approved' }, { status: 400 });
          }
          sql = `UPDATE finance_journal_entries
                    SET status = 'APPROVED', approved_by = $2, approved_at = $3::timestamptz, updated_at = $3::timestamptz
                  WHERE id::text = $1 AND tenant_id = $4
                  RETURNING *`;
          sqlParams = [params.id, body.approvedBy ?? req.headers.get('x-user-id') ?? 'Finance Manager', now, tenantId];
          break;

        case 'reject': {
          // Back to the preparer as a draft, with the reason in its notes.
          if (current.status !== 'SUBMITTED') {
            return NextResponse.json({ error: 'Only SUBMITTED entries can be returned' }, { status: 400 });
          }
          const by = (await sessionUser(req.headers))?.email ?? 'Finance Manager';
          sql = `UPDATE finance_journal_entries
                    SET status = 'DRAFT', updated_at = $2::timestamptz,
                        notes = concat_ws(E'\n', NULLIF(notes, ''), $3::text)
                  WHERE id::text = $1 AND tenant_id = $4
                  RETURNING *`;
          sqlParams = [params.id, now, `Returned by ${by}: ${String(body.reason ?? '').trim() || 'No reason given'}`, tenantId];
          break;
        }

        case 'post':
          // Only once approved: a submitted entry has not been.
          if (current.status !== 'APPROVED') {
            return NextResponse.json({ error: 'Entry must be APPROVED before posting' }, { status: 400 });
          }
          sql = `UPDATE finance_journal_entries
                    SET status = 'POSTED', posted_by = $2, posted_at = $3::timestamptz, updated_at = $3::timestamptz
                  WHERE id::text = $1 AND tenant_id = $4
                  RETURNING *`;
          sqlParams = [params.id, body.postedBy ?? req.headers.get('x-user-id') ?? 'Finance Manager', now, tenantId];
          break;

        case 'void':
          if (current.status === 'POSTED') {
            return NextResponse.json(
              { error: 'Posted entries cannot be voided — use Reverse instead' },
              { status: 400 },
            );
          }
          sql = `UPDATE finance_journal_entries
                    SET status = 'VOID', updated_at = $2::timestamptz, notes = COALESCE($3, notes)
                  WHERE id::text = $1 AND tenant_id = $4
                  RETURNING *`;
          sqlParams = [params.id, now, body.notes ?? null, tenantId];
          break;

        case 'reverse': {
          if (current.status !== 'POSTED') {
            return NextResponse.json({ error: 'Only POSTED entries can be reversed' }, { status: 400 });
          }

          // Claim the entry before creating anything: a concurrent reversal
          // blocks on this row, then finds it no longer POSTED and gets a 409,
          // so an entry is reversed once. (Distinct journal numbers no longer
          // make the second insert fail by accident.) If a later statement
          // fails, the transaction is aborted and the claim rolls back with it.
          const [claimed] = await tx.$queryRawUnsafe<{ id: string }[]>(
            `UPDATE finance_journal_entries
                SET status = 'REVERSED', updated_at = $2::timestamptz
              WHERE id::text = $1 AND tenant_id = $3 AND status = 'POSTED'
              RETURNING id::text`,
            params.id, now, tenantId,
          );
          if (!claimed) {
            return NextResponse.json({ error: 'This entry has already been reversed' }, { status: 409 });
          }

          const lines = await tx.$queryRawUnsafe<
            { account_code: string; account_name: string; description: string; debit_amount: string; credit_amount: string; normal_balance: string; cost_centre: string }[]
          >(
            `SELECT account_code, account_name, description, debit_amount, credit_amount, normal_balance, cost_centre
               FROM finance_journal_lines
              WHERE journal_entry_id::text = $1
              ORDER BY line_number`,
            params.id,
          );

          const revJeNo = `${await nextJournalNumber(tx, tenantId)}-REV`;

          const revDate    = body.reversalDate ?? new Date().toISOString().slice(0, 10);
          const d          = new Date(revDate);
          const totalDebit = parseFloat(current.total_debit);

          const [revJe] = await tx.$queryRawUnsafe<JeRow[]>(
            `INSERT INTO finance_journal_entries
               (je_number, entry_date, period_year, period_month,
                narration, source_type, source_id, status,
                total_debit, total_credit, is_balanced,
                reversed_je_id, prepared_by, currency, tenant_id)
             VALUES ($1,$2::date,$3,$4,$5,'REVERSAL',$6,'POSTED',$7,$7,TRUE,$8,$9,'AED',$10)
             RETURNING *`,
            revJeNo,
            revDate,
            d.getFullYear(),
            d.getMonth() + 1,
            `Reversal of ${current.je_number}: ${current.narration}`,
            params.id,
            totalDebit,
            params.id,
            body.reversedBy ?? req.headers.get('x-user-id') ?? 'Finance Manager',
            tenantId,
          );

          if (!revJe) {
            return NextResponse.json({ error: 'Failed to create reversal JE' }, { status: 500 });
          }
          const revId = (revJe as Record<string, string>).id;

          for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            await tx.$executeRawUnsafe(
              `INSERT INTO finance_journal_lines
                 (journal_entry_id, line_number, account_code, account_name,
                  description, debit_amount, credit_amount, normal_balance, cost_centre)
               VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9)`,
              revId,
              i + 1,
              l.account_code,
              l.account_name,
              `Reversal: ${l.description ?? ''}`,
              l.credit_amount, // flip: credit → debit
              l.debit_amount,  // flip: debit → credit
              l.normal_balance,
              l.cost_centre,
            );
          }

          await tx.$executeRawUnsafe(
            `UPDATE finance_journal_entries
                SET reversal_je_id = $2, updated_at = $3::timestamptz
              WHERE id::text = $1 AND tenant_id = $4`,
            params.id, revId, now, tenantId,
          );

          return NextResponse.json({ original: params.id, reversalJe: revJe });
        }

        default:
          return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
      }

      const [row] = await tx.$queryRawUnsafe<JeRow[]>(sql, ...sqlParams);
      if (!row) return NextResponse.json({ error: 'Update failed' }, { status: 500 });
      return NextResponse.json(row);
  });
  } catch (err) {
    console.error(`[finance/journal-entries PATCH ${action}]`, err);
    return NextResponse.json({ error: 'Failed to update journal entry' }, { status: 500 });
  }
  return action === 'submit'
    ? withApprovalStart(response, { headers: req.headers, tenantId, referenceType: 'finance_journal', referenceId: params.id })
    : response;
}


// ── DELETE /api/finance/journal-entries/:id ──────────────────────────────────

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
  return await withTenantRls(prisma, tenantId, async (tx) => {
      const [je] = await tx.$queryRawUnsafe<{ status: string }[]>(
        `SELECT status FROM finance_journal_entries WHERE id::text = $1 AND tenant_id = $2`,
        params.id, tenantId,
      );

      if (!je) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (je.status === 'POSTED') {
        return NextResponse.json(
          { error: 'Posted entries cannot be deleted — use Reverse instead' },
          { status: 400 },
        );
      }

      await tx.$executeRawUnsafe(
        `UPDATE finance_journal_entries SET deleted_at = NOW() WHERE id::text = $1 AND tenant_id = $2`,
        params.id, tenantId,
      );

      return NextResponse.json({ ok: true });
  });
  } catch (err) {
    console.error('[finance/journal-entries DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete journal entry' }, { status: 500 });
  }
}

