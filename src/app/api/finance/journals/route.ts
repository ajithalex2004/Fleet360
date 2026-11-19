import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import {
  assertPeriodOpen,
  nextJournalNumber,
  normalizeLeafGlAccount,
} from '@/lib/finance/journal-service';
import { logAuditInTx } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RawLineInput = {
  accountCode?: unknown;
  account?: unknown;
  accountName?: unknown;
  description?: unknown;
  debit?: unknown;
  credit?: unknown;
  costCentre?: unknown;
};

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  if (!authz.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const { tenantId, userId: makerId } = authz;

  try {
    const rawBody = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(rawBody);

    const dateStr = body.date ? String(body.date).trim().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const parsedDate = new Date(`${dateStr}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== dateStr
    ) {
      return NextResponse.json({ error: 'Invalid journal date (expected YYYY-MM-DD)' }, { status: 400 });
    }

    const narration =
      typeof body.description === 'string'
        ? body.description.trim()
        : typeof body.narration === 'string'
          ? body.narration.trim()
          : '';
    if (!narration) {
      return NextResponse.json({ error: 'Journal description is required' }, { status: 400 });
    }

    const rawLines: RawLineInput[] = Array.isArray(body.lines) ? body.lines : [];
    if (rawLines.length < 2) {
      return NextResponse.json({ error: 'Journal must have at least 2 lines' }, { status: 400 });
    }

    const normalizedLines: Array<{
      lineNumber: number;
      accountCode: string;
      accountName: string;
      description: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      normalBalance: 'DEBIT' | 'CREDIT';
      costCentre: string;
    }> = [];

    let totalDebit = new Prisma.Decimal(0);
    let totalCredit = new Prisma.Decimal(0);
    const currency = typeof body.currency === 'string' && body.currency.trim() ? body.currency.trim().toUpperCase() : 'AED';

    for (let i = 0; i < rawLines.length; i++) {
      const l = rawLines[i];
      if (!l || typeof l !== 'object') {
        return NextResponse.json({ error: `Line ${i + 1} is invalid` }, { status: 400 });
      }
      const rawAccount = String(l.accountCode ?? l.account ?? '').trim();
      if (!rawAccount) {
        return NextResponse.json({ error: `Line ${i + 1} is missing account code` }, { status: 400 });
      }

      const debitVal = Number(l.debit ?? 0);
      const creditVal = Number(l.credit ?? 0);
      if (!Number.isFinite(debitVal) || !Number.isFinite(creditVal) || debitVal < 0 || creditVal < 0) {
        return NextResponse.json({ error: `Line ${i + 1} has invalid negative or non-numeric amount` }, { status: 400 });
      }

      const debitDec = new Prisma.Decimal(debitVal.toFixed(2));
      const creditDec = new Prisma.Decimal(creditVal.toFixed(2));
      if (debitDec.eq(0) && creditDec.eq(0)) {
        return NextResponse.json({ error: `Line ${i + 1} must have a non-zero debit or credit` }, { status: 400 });
      }
      if (debitDec.gt(0) && creditDec.gt(0)) {
        return NextResponse.json({ error: `Line ${i + 1} cannot have both debit and credit` }, { status: 400 });
      }

      const norm = normalizeLeafGlAccount(
        rawAccount,
        typeof l.accountName === 'string' && l.accountName.trim() ? l.accountName.trim() : rawAccount,
      );
      const normalBalance: 'DEBIT' | 'CREDIT' =
        norm.code === '1290'
          ? 'CREDIT'
          : norm.code.startsWith('1') || norm.code.startsWith('5')
            ? 'DEBIT'
            : norm.code.startsWith('2') || norm.code.startsWith('3') || norm.code.startsWith('4')
              ? 'CREDIT'
              : debitDec.gte(creditDec)
                ? 'DEBIT'
                : 'CREDIT';

      totalDebit = totalDebit.plus(debitDec);
      totalCredit = totalCredit.plus(creditDec);

      normalizedLines.push({
        lineNumber: i + 1,
        accountCode: norm.code,
        accountName: norm.name,
        description: typeof l.description === 'string' && l.description.trim() ? l.description.trim() : narration,
        debit: debitDec,
        credit: creditDec,
        normalBalance,
        costCentre: typeof l.costCentre === 'string' && l.costCentre.trim() ? l.costCentre.trim() : 'GENERAL',
      });
    }

    if (totalDebit.lte(0) || !totalDebit.equals(totalCredit)) {
      return NextResponse.json({
        error: `Debits (${totalDebit.toFixed(2)}) do not equal Credits (${totalCredit.toFixed(2)})`,
      }, { status: 422 });
    }

    return await withTenantRls(prisma, tenantId, async (tx) => {
      try {
        await assertPeriodOpen(tx, tenantId, dateStr);
      } catch (periodErr: unknown) {
        const pe = periodErr as { message?: string; statusCode?: number };
        return NextResponse.json(
          { error: pe.message || 'Cannot post to locked accounting period' },
          { status: pe.statusCode || 422 },
        );
      }

      // Validate all line accountCode values against active leaf accounts in finance_chart_of_accounts
      const accountCodes = normalizedLines.map((l) => l.accountCode);
      const accounts = await tx.$queryRawUnsafe<Array<{
        account_code: string;
        account_name: string;
        normal_balance: string;
        is_header?: boolean;
        is_active?: boolean;
      }>>(
        `SELECT account_code, account_name, normal_balance, is_header, is_active
           FROM finance_chart_of_accounts
          WHERE account_code = ANY($1::text[]) AND tenant_id = $2`,
        accountCodes,
        tenantId,
      );
      const accMap = new Map(accounts.map((a) => [a.account_code, a]));

      for (const line of normalizedLines) {
        const acc = accMap.get(line.accountCode);
        if (!acc) {
          return NextResponse.json(
            { error: `Account code "${line.accountCode}" does not exist in chart of accounts` },
            { status: 422 },
          );
        }
        if (acc.is_header) {
          return NextResponse.json(
            { error: `Account code "${line.accountCode}" is a summary header account and cannot accept journal postings` },
            { status: 422 },
          );
        }
        if (acc.is_active === false) {
          return NextResponse.json(
            { error: `Account code "${line.accountCode}" is inactive and cannot accept journal postings` },
            { status: 422 },
          );
        }
        line.accountName = acc.account_name;
        if (acc.normal_balance === 'DEBIT' || acc.normal_balance === 'CREDIT') {
          line.normalBalance = acc.normal_balance;
        }
      }

      const entryId = randomUUID();
      const jeNumber = await nextJournalNumber(tx, tenantId, parsedDate);
      const periodYear = parsedDate.getUTCFullYear();
      const periodMonth = parsedDate.getUTCMonth() + 1;
      const reference = typeof body.reference === 'string' && body.reference.trim() ? body.reference.trim() : null;

      await tx.$executeRawUnsafe(
        `INSERT INTO finance_journal_entries
           (id, je_number, entry_date, period_year, period_month, narration, reference,
            source_type, status, total_debit, total_credit, is_balanced,
            prepared_by, currency, tenant_id)
         VALUES ($1::uuid, $2, $3::date, $4, $5, $6, $7,
                 'MANUAL', 'DRAFT', 0, 0, false,
                 $8, $9, $10)`,
        entryId,
        jeNumber,
        dateStr,
        periodYear,
        periodMonth,
        narration,
        reference,
        makerId,
        currency,
        tenantId,
      );

      for (const line of normalizedLines) {
        await tx.$executeRawUnsafe(
          `INSERT INTO finance_journal_lines
             (journal_entry_id, line_number, account_code, account_name, description,
              debit_amount, credit_amount, normal_balance, cost_centre, currency)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          entryId,
          line.lineNumber,
          line.accountCode,
          line.accountName,
          line.description,
          Number(line.debit.toFixed(2)),
          Number(line.credit.toFixed(2)),
          line.normalBalance,
          line.costCentre,
          currency,
        );
      }

      await tx.$executeRawUnsafe(
        `UPDATE finance_journal_entries je
            SET total_debit  = t.debit,
                total_credit = t.credit,
                is_balanced  = (t.debit = t.credit AND t.lines > 0),
                updated_at   = NOW()
           FROM (SELECT COALESCE(SUM(debit_amount), 0)  AS debit,
                        COALESCE(SUM(credit_amount), 0) AS credit,
                        COUNT(*)                        AS lines
                   FROM finance_journal_lines
                  WHERE journal_entry_id = $1::uuid) t
          WHERE je.id = $1::uuid`,
        entryId,
      );

      await logAuditInTx({
        tenantId,
        entityType: 'FinanceJournalEntry',
        entityId: entryId,
        action: 'CREATE',
        userId: makerId,
        userRole: authz.role ?? undefined,
        details: `Created DRAFT journal entry ${jeNumber} (${totalDebit.toFixed(2)} ${currency})`,
      }, tx);

      return NextResponse.json({
        ok: true,
        id: entryId,
        jeNumber,
        status: 'DRAFT',
        preparedBy: makerId,
        periodYear,
        periodMonth,
        totalDebit: Number(totalDebit.toFixed(2)),
        totalCredit: Number(totalCredit.toFixed(2)),
        date: dateStr,
        lines: normalizedLines.map((l) => ({
          lineNumber: l.lineNumber,
          accountCode: l.accountCode,
          accountName: l.accountName,
          description: l.description,
          debit: Number(l.debit.toFixed(2)),
          credit: Number(l.credit.toFixed(2)),
          normalBalance: l.normalBalance,
          costCentre: l.costCentre,
        })),
      }, { status: 201 });
    });
  } catch (e: unknown) {
    const errObj = e as { statusCode?: number; message?: string };
    if (errObj?.statusCode === 422 || errObj?.message?.includes('locked')) {
      return NextResponse.json({ error: errObj.message }, { status: 422 });
    }
    console.error('[finance/journals]', e);
    return NextResponse.json({ error: 'Failed to create journal' }, { status: 500 });
  }
}
