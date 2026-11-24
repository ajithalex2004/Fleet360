import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { assertPeriodOpen } from '@/lib/finance/journal-service';
import { logAuditInTx } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  if (!authz.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const { tenantId, userId: checkerId } = authz;

  try {
    return await withTenantRls(prisma, tenantId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{
        id: string;
        je_number: string;
        status: string;
        prepared_by: string | null;
        entry_date: Date | string;
      }>>(
        `SELECT id::text, je_number, status, prepared_by, entry_date
           FROM finance_journal_entries
          WHERE id::text = $1 AND tenant_id = $2 AND deleted_at IS NULL
          LIMIT 1
            FOR UPDATE`,
        params.id,
        tenantId,
      );

      if (rows.length === 0) {
        return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 });
      }

      const je = rows[0];
      const POSTABLE_STATUSES = new Set(['DRAFT', 'SUBMITTED', 'APPROVED']);

      if (je.status === 'POSTED') {
        return NextResponse.json({ error: 'Journal entry is already POSTED' }, { status: 409 });
      }
      if (!POSTABLE_STATUSES.has(je.status)) {
        return NextResponse.json(
          { error: `Cannot post journal entry in status ${je.status}` },
          { status: 400 },
        );
      }

      // Maker-Checker Segregation of Duties: disallow missing/empty preparer and self-approval
      if (!je.prepared_by || !je.prepared_by.trim()) {
        return NextResponse.json({
          error: 'Journal entry is missing preparer (prepared_by) and cannot be posted under Segregation of Duties',
        }, { status: 422 });
      }
      if (je.prepared_by.trim().toLowerCase() === checkerId.trim().toLowerCase()) {
        return NextResponse.json({
          error: 'Segregation of duties violation: maker cannot approve/post their own journal entry',
        }, { status: 403 });
      }

      // Period lock validation
      await assertPeriodOpen(tx, tenantId, je.entry_date);

      // Verify journal lines exist and balance
      const [lineSummary] = await tx.$queryRawUnsafe<Array<{
        line_count: number;
        total_debit: string;
        total_credit: string;
      }>>(
        `SELECT COUNT(*)::int AS line_count,
                COALESCE(SUM(debit_amount), 0)::text AS total_debit,
                COALESCE(SUM(credit_amount), 0)::text AS total_credit
           FROM finance_journal_lines
          WHERE journal_entry_id = $1::uuid`,
        je.id,
      );

      const lineCount = Number(lineSummary?.line_count ?? 0);
      const totalDebit = new Prisma.Decimal(lineSummary?.total_debit ?? '0');
      const totalCredit = new Prisma.Decimal(lineSummary?.total_credit ?? '0');

      if (lineCount < 2 || totalDebit.lte(0) || !totalDebit.equals(totalCredit)) {
        return NextResponse.json(
          { error: 'Journal entry must have at least 2 balanced non-zero lines before posting' },
          { status: 422 },
        );
      }

      const updated = await tx.$queryRawUnsafe<Array<{
        id: string;
        status: string;
        posted_by: string;
        posted_at: Date;
      }>>(
        `UPDATE finance_journal_entries
            SET status = 'POSTED',
                posted_by = $1,
                posted_at = NOW(),
                updated_at = NOW()
          WHERE id::text = $2
            AND tenant_id = $3
            AND deleted_at IS NULL
            AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED')
          RETURNING id::text, status, posted_by, posted_at`,
        checkerId,
        je.id,
        tenantId,
      );

      if (updated.length === 0) {
        return NextResponse.json({ error: 'Journal entry status changed concurrently and cannot be posted' }, { status: 409 });
      }

      await logAuditInTx({
        tenantId,
        entityType: 'FinanceJournalEntry',
        entityId: je.id,
        action: 'UPDATE',
        userId: checkerId,
        userRole: authz.role ?? undefined,
        details: `Posted journal entry ${je.je_number} (prepared by ${je.prepared_by ?? 'unknown'})`,
      }, tx);

      return NextResponse.json({
        ok: true,
        id: updated[0].id,
        jeNumber: je.je_number,
        status: updated[0].status,
        postedBy: updated[0].posted_by,
        postedAt: new Date(updated[0].posted_at).toISOString(),
      }, { status: 200 });
    });
  } catch (e: unknown) {
    const errObj = e as { statusCode?: number; message?: string };
    if (errObj?.statusCode === 422) {
      return NextResponse.json({ error: errObj.message || 'Period is locked' }, { status: 422 });
    }
    console.error('[finance/journals/[id]/post]', e);
    return NextResponse.json({ error: 'Failed to post journal entry' }, { status: 500 });
  }
}
