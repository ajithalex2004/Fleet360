/**
 * Bank Accounts API — /api/finance/bank-accounts
 * Manages bank accounts registered for reconciliation
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureOperationalTenantColumn, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

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
    last_reconciled_at  TIMESTAMPTZ,
    tenant_id           TEXT
  );
`;

type BankRow = Record<string, unknown>;

export async function GET(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});
  await ensureOperationalTenantColumn('finance_bank_accounts').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;
  const sp     = req.nextUrl.searchParams;
  const active = sp.get('active');
  let where    = `WHERE deleted_at IS NULL AND tenant_id::text = $1`;
  const params: unknown[] = [ctx.tenantId];
  if (active === 'true') where += ` AND is_active = TRUE`;

  const rows = await prisma.$queryRawUnsafe<BankRow[]>(
    `SELECT * FROM finance_bank_accounts ${where} ORDER BY is_default DESC, bank_name ASC`,
    ...params,
  ).catch(() => []);
  return NextResponse.json({ data: rows });
}

export async function POST(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});
  await ensureOperationalTenantColumn('finance_bank_accounts').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json();

  // Unset existing default if setting new default
  if (body.isDefault) {
    await prisma.$executeRawUnsafe(
      `UPDATE finance_bank_accounts SET is_default=FALSE WHERE deleted_at IS NULL AND tenant_id::text = $1`,
      ctx.tenantId,
    ).catch(() => {});
  }

  const [row] = await prisma.$queryRawUnsafe<BankRow[]>(
    `INSERT INTO finance_bank_accounts
       (bank_name, account_name, account_number, iban, currency,
        branch_name, swift_code, is_default, current_balance, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    body.bankName, body.accountName, body.accountNumber,
    body.iban ?? null, body.currency ?? 'AED',
    body.branchName ?? null, body.swiftCode ?? null,
    body.isDefault ?? false, body.currentBalance ?? 0, ctx.tenantId,
  ).catch(() => []);

  if (!row) return NextResponse.json({ error: 'Failed to create bank account' }, { status: 500 });
  await recordOperationalChange({
    req,
    ctx,
    entityType: 'FinanceBankAccount',
    entityId: String(row.id ?? ''),
    action: 'CREATE',
    after: row,
    summary: `Created bank account ${String(row.bank_name ?? '')} / ${String(row.account_name ?? '')}.`,
  });
  const workflow = await triggerServiceWorkflow({
    req,
    ctx,
    serviceTypeKey: 'FINANCE_BILLING_EXCEPTION',
    referenceType: 'BankAccount',
    referenceId: String(row.id ?? ''),
    referenceNumber: String(row.account_number ?? row.id ?? ''),
    contextData: {
      action: 'create',
      bankName: row.bank_name ?? null,
      accountName: row.account_name ?? null,
      isDefault: row.is_default ?? false,
      currency: row.currency ?? 'AED',
    },
    force: body.isDefault === true,
  });
  return NextResponse.json({ ...row, workflow }, { status: 201 });
}
