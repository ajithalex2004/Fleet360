/**
 * Chart of Accounts — /api/finance/coa
 * Transport-specific double-entry COA with 5 root types
 * Account codes: 1xxx=Asset, 2xxx=Liability, 3xxx=Equity, 4xxx=Income, 5xxx=Expense
 *
 * finance_chart_of_accounts is created and seeded by
 * migration 20260810000003_finance_reference_data_seed — no runtime DDL needed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
type CoaRow = Record<string, unknown>;

export async function GET(req: NextRequest) {
  const sp     = req.nextUrl.searchParams;
  const type   = sp.get('type');    // filter by ASSET | LIABILITY | EQUITY | INCOME | EXPENSE
  const search = sp.get('search');
  const flat   = sp.get('flat');    // flat list vs tree

  let where = `WHERE deleted_at IS NULL`;
  const params: unknown[] = [];
  let pi = 1;
  if (type)   { where += ` AND account_type = $${pi++}`;                                     params.push(type); }
  if (search) { where += ` AND (account_code ILIKE $${pi} OR account_name ILIKE $${pi})`;   params.push(`%${search}%`); pi++; }

  const rows = await prisma.$queryRawUnsafe<CoaRow[]>(
    `SELECT * FROM finance_chart_of_accounts ${where} ORDER BY sort_order, account_code`, ...params
  ).catch(() => []);

  if (flat === 'true') return NextResponse.json({ data: rows, count: rows.length });

  // Build tree
  const map   = new Map<string, CoaRow & { children: CoaRow[] }>();
  const roots: (CoaRow & { children: CoaRow[] })[] = [];
  for (const r of rows) {
    map.set(r.account_code as string, { ...r, children: [] });
  }
  for (const r of rows) {
    const node = map.get(r.account_code as string)!;
    if (r.parent_code && map.has(r.parent_code as string)) {
      (map.get(r.parent_code as string)!.children as CoaRow[]).push(node);
    } else if (!r.parent_code) {
      roots.push(node);
    }
  }

  return NextResponse.json({ data: roots, flatData: rows, count: rows.length });
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  // Determine normal_balance from account_type if not specified
  const normalBalance = body.normalBalance ??
    (['LIABILITY', 'EQUITY', 'INCOME'].includes(body.accountType) ? 'CREDIT' : 'DEBIT');

  const [row] = await prisma.$queryRawUnsafe<CoaRow[]>(
    `INSERT INTO finance_chart_of_accounts
       (account_code, account_name, account_type, account_subtype, parent_code,
        description, is_header, is_active, normal_balance, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    body.accountCode, body.accountName, body.accountType,
    body.accountSubtype ?? null, body.parentCode ?? null,
    body.description ?? null, body.isHeader ?? false, true,
    normalBalance, body.sortOrder ?? 999,
  ).catch(() => []);

  if (!row) return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  return NextResponse.json(row, { status: 201 });
}
