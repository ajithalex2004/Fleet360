/**
 * Per-tenant chart of accounts.
 *
 * finance_chart_of_accounts holds one chart per tenant, under row level
 * security (migration 20261002090000_tenant_chart_of_accounts). A tenant
 * created after that migration has no accounts until first use: the finance
 * routes that read the chart call ensureTenantChartOfAccounts inside their
 * withTenantRls transaction, which copies the standard transport chart from
 * finance.finance_coa_template when the tenant has none.
 */
import type { TxClient } from '@/lib/rls';

/**
 * Seeds the tenant's chart from the template when it has no accounts. Runs
 * inside the caller's tenant transaction (the rows pass the policy's WITH
 * CHECK as the caller's tenant); concurrent first requests are harmless
 * (ON CONFLICT on the per-tenant unique key).
 *
 * Checks first, with a read that cannot fail, that the migration has run: a
 * failing statement would abort the caller's transaction.
 */
export async function ensureTenantChartOfAccounts(tx: TxClient, tenantId: string): Promise<void> {
  const [state] = await tx.$queryRawUnsafe<Array<{ ready: boolean }>>(
    `SELECT to_regclass('finance.finance_coa_template') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_attribute
                     WHERE attrelid = to_regclass('finance.finance_chart_of_accounts')
                       AND attname = 'tenant_id' AND NOT attisdropped) AS ready`,
  );
  if (!state?.ready) return;

  await tx.$executeRawUnsafe(
    `INSERT INTO finance.finance_chart_of_accounts
       (tenant_id, account_code, account_name, account_type, account_subtype, parent_code,
        description, is_header, is_active, is_system, normal_balance, currency, sort_order)
     SELECT $1, t.account_code, t.account_name, t.account_type, t.account_subtype, t.parent_code,
            t.description, t.is_header, t.is_active, t.is_system, t.normal_balance, t.currency, t.sort_order
       FROM finance.finance_coa_template t
      WHERE NOT EXISTS (SELECT 1 FROM finance.finance_chart_of_accounts c WHERE c.tenant_id = $1)
     ON CONFLICT (tenant_id, account_code) DO NOTHING`,
    tenantId,
  );
}
