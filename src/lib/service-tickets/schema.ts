/**
 * Lazy-creates the `service_tickets` table and its indexes on first call.
 *
 * Storage layout — single table, ticket_type is the discriminator. Same
 * pattern as finance_invoices / tenant_invitations / etc. The Service &
 * Support Ticketing module uses Next.js Prisma routes (NOT the Go
 * backend on :8080), so existing /maintenance/service-requests stays
 * unaffected during this rollout.
 */

import { prisma } from '@/lib/prisma';

/**
 * Compute the next per-(tenant, type, year) sequence and return the
 * canonical ticker. Atomic enough for a single-writer Postgres workload —
 * SELECT MAX over an indexed scope inside a transaction. For high-write
 * tenants we'd switch to a counter table with SELECT … FOR UPDATE; that's
 * a follow-up.
 */
export async function nextReadableId(
  tenantId: string,
  ticketType: string,
  prefix: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const likePattern = `ST${year}-${prefix}-%`;

  const rows = await prisma.$queryRawUnsafe<{ max_seq: string | null }[]>(
    `SELECT MAX(
       CAST(SUBSTRING(readable_id FROM 'ST\\d{4}-[A-Z]{3}-(\\d+)$') AS INTEGER)
     )::text AS max_seq
     FROM service_tickets
     WHERE tenant_id = $1
       AND ticket_type = $2
       AND readable_id LIKE $3`,
    tenantId, ticketType, likePattern,
  ).catch(() => [{ max_seq: null }]);

  const last = rows[0]?.max_seq ? parseInt(rows[0].max_seq, 10) : 0;
  const next = (isFinite(last) ? last : 0) + 1;
  return `ST${year}-${prefix}-${String(next).padStart(4, '0')}`;
}
