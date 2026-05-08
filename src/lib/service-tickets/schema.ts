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

let _ensured = false;

export async function ensureServiceTicketsTable(): Promise<void> {
  if (_ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS service_tickets (
      id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id               TEXT         NOT NULL,
      ticket_type             TEXT         NOT NULL,
      readable_id             TEXT,
      requestor_id            TEXT         NOT NULL,
      requestor_name          TEXT,
      vehicle_id              TEXT,
      related_driver_id       TEXT,
      title                   TEXT         NOT NULL,
      description             TEXT,
      priority                TEXT         NOT NULL DEFAULT 'Medium',
      status                  TEXT         NOT NULL DEFAULT 'Pending',
      due_date                DATE,
      assigned_to             TEXT,
      maintenance_request_id  TEXT,
      history                 JSONB        NOT NULL DEFAULT '[]'::jsonb,
      attachments             JSONB        NOT NULL DEFAULT '[]'::jsonb,
      comments                JSONB        NOT NULL DEFAULT '[]'::jsonb,
      custom_fields           JSONB        NOT NULL DEFAULT '{}'::jsonb,
      created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      deleted_at              TIMESTAMPTZ
    )
  `);
  // 1C migration — add column if upgrading from a 1B schema.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb`,
  ).catch(() => {});
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_service_tickets_tenant ON service_tickets (tenant_id) WHERE deleted_at IS NULL`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_service_tickets_type   ON service_tickets (tenant_id, ticket_type) WHERE deleted_at IS NULL`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_service_tickets_status ON service_tickets (tenant_id, status) WHERE deleted_at IS NULL`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_service_tickets_readable_id ON service_tickets (readable_id) WHERE readable_id IS NOT NULL`);
  _ensured = true;
}

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
