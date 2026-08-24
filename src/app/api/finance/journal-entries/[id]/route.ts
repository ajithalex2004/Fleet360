/**
 * Journal Entry individual operations — status transitions + reversal
 * All reads and writes are scoped to the tenant from x-tenant-id.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
type JeRow = Record<string, unknown>;

function getTenant(req: NextRequest): string | null {
  return req.headers.get('x-tenant-id');
}

// ── GET /api/finance/journal-entries/:id ─────────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const tenantId = getTenant(req);
      if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const tenantClause = tenantId === '*' ? '' : `AND je.tenant_id = '${tenantId}'`;

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
         LEFT JOIN finance_journal_lines jl ON jl.journal_entry_id = je.id
         WHERE je.id = $1 AND je.deleted_at IS NULL ${tenantClause}
         GROUP BY je.id`,
        params.id,
      ).catch(() => [] as JeRow[]);

      if (!je) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(je);
  });
}


// ── PATCH /api/finance/journal-entries/:id ───────────────────────────────────

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const tenantId = getTenant(req);
      if (!tenantId || tenantId === '*') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const { action } = body;
      const now = new Date().toISOString();

      // Fetch current JE — enforce tenant ownership.
      const [current] = await tx.$queryRawUnsafe<
        { status: string; je_number: string; entry_date: string; narration: string; total_debit: string; tenant_id: string }[]
      >(
        `SELECT status, je_number, entry_date, narration, total_debit, tenant_id
           FROM finance_journal_entries
          WHERE id = $1 AND deleted_at IS NULL AND tenant_id = $2`,
        params.id, tenantId,
      ).catch(() => []);

      if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      let sql        = '';
      let sqlParams: unknown[] = [];

      switch (action) {
        case 'submit':
          if (current.status !== 'DRAFT') {
            return NextResponse.json({ error: 'Only DRAFT entries can be submitted' }, { status: 400 });
          }
          sql = `UPDATE finance_journal_entries
                    SET status = 'SUBMITTED', updated_at = $2
                  WHERE id = $1 AND tenant_id = $3
                  RETURNING *`;
          sqlParams = [params.id, now, tenantId];
          break;

        case 'approve':
          if (current.status !== 'SUBMITTED') {
            return NextResponse.json({ error: 'Only SUBMITTED entries can be approved' }, { status: 400 });
          }
          sql = `UPDATE finance_journal_entries
                    SET status = 'APPROVED', approved_by = $2, approved_at = $3, updated_at = $3
                  WHERE id = $1 AND tenant_id = $4
                  RETURNING *`;
          sqlParams = [params.id, body.approvedBy ?? req.headers.get('x-user-id') ?? 'Finance Manager', now, tenantId];
          break;

        case 'post':
          if (!['APPROVED', 'SUBMITTED'].includes(current.status)) {
            return NextResponse.json({ error: 'Entry must be APPROVED before posting' }, { status: 400 });
          }
          sql = `UPDATE finance_journal_entries
                    SET status = 'POSTED', posted_by = $2, posted_at = $3, updated_at = $3
                  WHERE id = $1 AND tenant_id = $4
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
                    SET status = 'VOID', updated_at = $2, notes = COALESCE($3, notes)
                  WHERE id = $1 AND tenant_id = $4
                  RETURNING *`;
          sqlParams = [params.id, now, body.notes ?? null, tenantId];
          break;

        case 'reverse': {
          if (current.status !== 'POSTED') {
            return NextResponse.json({ error: 'Only POSTED entries can be reversed' }, { status: 400 });
          }

          const lines = await tx.$queryRawUnsafe<
            { account_code: string; account_name: string; description: string; debit_amount: string; credit_amount: string; normal_balance: string; cost_centre: string }[]
          >(
            `SELECT account_code, account_name, description, debit_amount, credit_amount, normal_balance, cost_centre
               FROM finance_journal_lines
              WHERE journal_entry_id = $1
              ORDER BY line_number`,
            params.id,
          ).catch(() => []);

          const [{ count }] = await tx.$queryRawUnsafe<{ count: string }[]>(
            `SELECT COUNT(*)::text AS count FROM finance_journal_entries WHERE tenant_id = $1`,
            tenantId,
          ).catch(() => [{ count: '0' }]);

          const ym      = new Date().toISOString().slice(0, 7).replace('-', '');
          const seq     = (parseInt(count) + 1).toString().padStart(5, '0');
          const revJeNo = `JE-${ym}-${seq}-REV`;

          const revDate    = body.reversalDate ?? new Date().toISOString().slice(0, 10);
          const d          = new Date(revDate);
          const totalDebit = parseFloat(current.total_debit);

          const [revJe] = await tx.$queryRawUnsafe<JeRow[]>(
            `INSERT INTO finance_journal_entries
               (je_number, entry_date, period_year, period_month,
                narration, source_type, source_id, status,
                total_debit, total_credit, is_balanced,
                reversed_je_id, prepared_by, currency, tenant_id)
             VALUES ($1,$2,$3,$4,$5,'REVERSAL',$6,'POSTED',$7,$7,TRUE,$8,$9,'AED',$10)
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
          ).catch(() => []);

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
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              revId,
              i + 1,
              l.account_code,
              l.account_name,
              `Reversal: ${l.description ?? ''}`,
              l.credit_amount, // flip: credit → debit
              l.debit_amount,  // flip: debit → credit
              l.normal_balance,
              l.cost_centre,
            ).catch(() => {});
          }

          await tx.$executeRawUnsafe(
            `UPDATE finance_journal_entries
                SET status = 'REVERSED', reversal_je_id = $2, updated_at = $3
              WHERE id = $1 AND tenant_id = $4`,
            params.id, revId, now, tenantId,
          ).catch(() => {});

          return NextResponse.json({ original: params.id, reversalJe: revJe });
        }

        default:
          return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
      }

      const [row] = await tx.$queryRawUnsafe<JeRow[]>(sql, ...sqlParams).catch(() => [] as JeRow[]);
      if (!row) return NextResponse.json({ error: 'Update failed' }, { status: 500 });
      return NextResponse.json(row);
  });
}


// ── DELETE /api/finance/journal-entries/:id ──────────────────────────────────

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const tenantId = getTenant(req);
      if (!tenantId || tenantId === '*') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const [je] = await tx.$queryRawUnsafe<{ status: string }[]>(
        `SELECT status FROM finance_journal_entries WHERE id = $1 AND tenant_id = $2`,
        params.id, tenantId,
      ).catch(() => [] as { status: string }[]);

      if (!je) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (je.status === 'POSTED') {
        return NextResponse.json(
          { error: 'Posted entries cannot be deleted — use Reverse instead' },
          { status: 400 },
        );
      }

      await tx.$executeRawUnsafe(
        `UPDATE finance_journal_entries SET deleted_at = NOW() WHERE id = $1 AND tenant_id = $2`,
        params.id, tenantId,
      ).catch(() => {});

      return NextResponse.json({ ok: true });
  });
}

