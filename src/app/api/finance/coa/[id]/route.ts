import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type CoaRow = Record<string, unknown>;

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const [row] = await prisma.$queryRawUnsafe<CoaRow[]>(
    `SELECT c.*,
       (SELECT COALESCE(SUM(CASE WHEN jl.normal_balance='DEBIT' THEN jl.debit_amount - jl.credit_amount
                               ELSE jl.credit_amount - jl.debit_amount END),0)::text
          FROM finance_journal_lines jl
          JOIN finance_journal_entries je ON je.id = jl.journal_entry_id
         WHERE jl.account_code = c.account_code AND je.status = 'POSTED') as current_balance
     FROM finance_chart_of_accounts c
     WHERE c.id = $1 OR c.account_code = $1`,
    params.id
  ).catch(() => [] as CoaRow[]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const updates: string[] = [];
  const values: unknown[] = [];
  let pi = 1;

  const allowed = ['account_name', 'description', 'is_active', 'parent_code', 'sort_order', 'account_subtype'];
  for (const [key, val] of Object.entries(body)) {
    const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (allowed.includes(col)) { updates.push(`${col} = $${pi++}`); values.push(val); }
  }
  if (!updates.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  values.push(params.id);

  const [row] = await prisma.$queryRawUnsafe<CoaRow[]>(
    `UPDATE finance_chart_of_accounts SET ${updates.join(', ')}, updated_at=NOW() WHERE id=$${pi} OR account_code=$${pi} RETURNING *`,
    ...values
  ).catch(() => [] as CoaRow[]);

  if (!row) return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  return NextResponse.json(row);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  // Prevent deletion of system accounts or accounts with transactions
  const [acc] = await prisma.$queryRawUnsafe<{is_system: boolean; account_code: string}[]>(
    `SELECT is_system, account_code FROM finance_chart_of_accounts WHERE id=$1 OR account_code=$1`, params.id
  ).catch(() => [] as {is_system: boolean; account_code: string}[]);

  if (!acc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (acc.is_system) return NextResponse.json({ error: 'System accounts cannot be deleted' }, { status: 400 });

  const [{ count }] = await prisma.$queryRawUnsafe<{count: string}[]>(
    `SELECT COUNT(*)::text as count FROM finance_journal_lines WHERE account_code=$1`, acc.account_code
  ).catch(() => [{ count: '0' }]);
  if (parseInt(count) > 0) return NextResponse.json({ error: 'Account has journal entries and cannot be deleted' }, { status: 400 });

  await prisma.$executeRawUnsafe(
    `UPDATE finance_chart_of_accounts SET deleted_at=NOW() WHERE id=$1 OR account_code=$1`, params.id
  ).catch(() => {});
  return NextResponse.json({ ok: true });
}
