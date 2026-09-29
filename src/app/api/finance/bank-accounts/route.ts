export const dynamic = 'force-dynamic';

/**
 * Bank Accounts API — /api/finance/bank-accounts
 * Manages bank accounts registered for reconciliation
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
// Tables come from migrations (the last: 20261005090000_finance_tenant_tables).
// A request runs no DDL: the runtime role may not create tables, and the
// failed statement aborted the request's transaction, so every query after
// it failed too.

type BankRow = Record<string, unknown>;

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const sp     = req.nextUrl.searchParams;
      const active = sp.get('active');
      let where    = `WHERE tenant_id = $1 AND deleted_at IS NULL`;
      if (active === 'true') where += ` AND is_active = TRUE`;

      const rows = await tx.$queryRawUnsafe<BankRow[]>(
        `SELECT * FROM finance_bank_accounts ${where} ORDER BY is_default DESC, bank_name ASC`,
        tenantId,
      ).catch(() => []);
      return NextResponse.json({ data: rows });
  });
}

export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

      // Unset existing default if setting new default
      if (body.isDefault) {
        await tx.$executeRawUnsafe(
          `UPDATE finance_bank_accounts SET is_default=FALSE WHERE tenant_id = $1 AND deleted_at IS NULL`,
          tenantId,
        ).catch(() => {});
      }

      const [row] = await tx.$queryRawUnsafe<BankRow[]>(
        `INSERT INTO finance_bank_accounts
           (tenant_id, bank_name, account_name, account_number, iban, currency,
            branch_name, swift_code, is_default, current_balance)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        tenantId, body.bankName, body.accountName, body.accountNumber,
        body.iban ?? null, body.currency ?? 'AED',
        body.branchName ?? null, body.swiftCode ?? null,
        body.isDefault ?? false, body.currentBalance ?? 0,
      ).catch(() => []);

      if (!row) return NextResponse.json({ error: 'Failed to create bank account' }, { status: 500 });
      return NextResponse.json(row, { status: 201 });
  });
}

