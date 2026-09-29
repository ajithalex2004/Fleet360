/**
 * Per-tenant profit centres.
 *
 * finance_profit_centres holds each tenant's own profit centres, unique by
 * (tenant_id, code), under row level security (migration
 * 20261006090000_profit_centres_per_tenant). The seven standard entries
 * live in finance.finance_profit_centre_template; a tenant created after
 * that migration gets its copy on first use, the way the chart of accounts
 * and reminder schedules work.
 */
import type { TxClient } from '@/lib/rls';

/**
 * Copies the standard profit centres to the tenant when it has none. Runs
 * inside the caller's tenant transaction; concurrent first requests are
 * harmless (ON CONFLICT on the per-tenant code key).
 *
 * Checks first, with a read that cannot fail, that the migration has run: a
 * failing statement would abort the caller's transaction.
 */
export async function ensureTenantProfitCentres(tx: TxClient, tenantId: string): Promise<void> {
  const [state] = await tx.$queryRawUnsafe<Array<{ ready: boolean }>>(
    `SELECT to_regclass('finance.finance_profit_centre_template') IS NOT NULL AS ready`,
  );
  if (!state?.ready) return;

  await tx.$executeRawUnsafe(
    `INSERT INTO finance_profit_centres (tenant_id, code, name, description, parent_code, module)
     SELECT $1, t.code, t.name, t.description, t.parent_code, t.module
       FROM finance.finance_profit_centre_template t
      WHERE NOT EXISTS (SELECT 1 FROM finance_profit_centres p WHERE p.tenant_id = $1)
     ON CONFLICT (tenant_id, code) DO NOTHING`,
    tenantId,
  );
}
