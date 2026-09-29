/**
 * Query helpers for the Scheduled Preventive Maintenance (SPM) routes,
 * bound to the caller's tenant.
 *
 * The SPM routes used to filter and insert with the literal tenant
 * 'default'. Under row level security (tenant_isolation on every spm_*
 * table) that matched nothing for a real tenant and every insert was
 * rejected, so SPM did not work for anyone. SQL passed here writes
 * `$tenant` where the tenant belongs; it is bound as the next positional
 * parameter, never interpolated.
 *
 * Failures resolve to [] / 0, as the per-file helpers these replace did.
 */
import { prisma } from '@/lib/prisma';

type Row = Record<string, unknown>;

export function spmSql(tenantId: string) {
  const bind = (sql: string, values: unknown[]): [string, unknown[]] => {
    if (!/\$tenant\b/.test(sql)) return [sql, values];
    return [sql.replace(/\$tenant\b/g, `$${values.length + 1}`), [...values, tenantId]];
  };
  return {
    query: <T = Row>(sql: string, ...values: unknown[]): Promise<T[]> => {
      const [text, params] = bind(sql, values);
      return prisma.$queryRawUnsafe<T[]>(text, ...params).catch(() => [] as T[]);
    },
    exec: (sql: string, ...values: unknown[]): Promise<number> => {
      const [text, params] = bind(sql, values);
      return prisma.$executeRawUnsafe(text, ...params).catch(() => 0);
    },
  };
}
