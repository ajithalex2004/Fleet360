/**
 * Bank Accounts API — /api/finance/bank-accounts
 * Manages bank accounts registered for reconciliation
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const INIT = `
  CREATE TABLE IF NOT EXISTS finance_bank_accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    bank_name           TEXT NOT NULL,
    account_name        TEXT NOT NULL,
    account_number      TEXT NOT NULL,
    iban                TEXT,
    currency            TEXT DEFAULT 'AED',
    branch_name         TEXT,
    swift_code          TEXT,
    is_default          BOOLEAN DEFAULT FALSE,
    is_active           BOOLEAN DEFAULT TRUE,
    current_balance     NUMERIC(15,2) DEFAULT 0,
    last_reconciled_at  TIMESTAMPTZ
  );
`;

type BankRow = Record<string, unknown>;

export async function GET(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});
  const sp     = req.nextUrl.searchParams;
  const active = sp.get('active');
  let where    = `WHERE deleted_at IS NULL`;
  if (active === 'true') where += ` AND is_active = TRUE`;

  const rows = await prisma.$queryRawUnsafe<BankRow[]>(
    `SELECT * FROM finance_bank_accounts ${where} ORDER BY is_default DESC, bank_name ASC`
  ).catch(() => []);
  return NextResponse.json({ data: rows });
}

export async function POST(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});
  const body = await req.json();

  // Unset existing default if setting new default
  if (body.isDefault) {
    await prisma.$executeRawUnsafe(
      `UPDATE finance_bank_accounts SET is_default=FALSE WHERE deleted_at IS NULL`
    ).catch(() => {});
  }

  const [row] = await prisma.$queryRawUnsafe<BankRow[]>(
    `INSERT INTO finance_bank_accounts
       (bank_name, account_name, account_number, iban, currency,
        branch_name, swift_code, is_default, current_balance)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    body.bankName, body.accountName, body.accountNumber,
    body.iban ?? null, body.currency ?? 'AED',
    body.branchName ?? null, body.swiftCode ?? null,
    body.isDefault ?? false, body.currentBalance ?? 0,
  ).catch(() => []);

  if (!row) return NextResponse.json({ error: 'Failed to create bank account' }, { status: 500 });
  return NextResponse.json(row, { status: 201 });
}
