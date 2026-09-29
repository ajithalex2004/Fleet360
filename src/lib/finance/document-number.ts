/**
 * Finance document numbers: <PREFIX>-<yyyymm>-<seq>-<suffix>,
 * e.g. COL-202609-0003-K7QX.
 *
 * These number columns (case_no, cn_number, deposit_no, schedule_no) are
 * unique across every tenant, but row level security only lets a tenant
 * count its own rows. A count-based number alone therefore collided as
 * soon as a second tenant created its first document of the month, and
 * the insert failed on the unique key. The sequence counts the tenant's own
 * documents for the month; the random suffix keeps the number unique
 * platform-wide — the scheme invoice, expense and journal numbers use.
 */
import { randomInt } from 'crypto';

type RawQueryDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

const SUFFIX_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Table and column names come from this list only, never from a request.
const DOCUMENTS = {
  COL: { table: 'finance_collection_cases',     column: 'case_no' },
  CN:  { table: 'finance_credit_notes',         column: 'cn_number' },
  FSD: { table: 'finance_security_deposits',    column: 'deposit_no' },
  FRS: { table: 'finance_recurring_schedules',  column: 'schedule_no' },
} as const;

export type DocumentPrefix = keyof typeof DOCUMENTS;

export async function nextDocumentNumber(
  db: RawQueryDb,
  tenantId: string,
  prefix: DocumentPrefix,
  at: Date = new Date(),
): Promise<string> {
  const { table, column } = DOCUMENTS[prefix];
  const ym = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}`;
  const [row] = await db.$queryRawUnsafe<Array<{ count: bigint | number | string }>>(
    `SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id::text = $1 AND ${column} LIKE $2`,
    tenantId,
    `${prefix}-${ym}-%`,
  );
  const seq = String(Number(row?.count ?? 0) + 1).padStart(4, '0');
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += SUFFIX_CHARS[randomInt(SUFFIX_CHARS.length)];
  return `${prefix}-${ym}-${seq}-${suffix}`;
}
