/**
 * Leasing Portal — lazy schema initialisation.
 *
 * Mirrors src/lib/shipper-portal/schema.ts exactly, adapted for lessees.
 * Two things happen on first request to the portal:
 *   1. CREATE TABLE lessee_portal_users — portal-side identities, strictly
 *      separate from tenant operator User+UserTenant.
 *   2. CREATE TABLE lessee_portal_invitations — one-time tokens used to
 *      bootstrap a portal user (operator invites; lessee accepts).
 *
 * Uses CREATE TABLE IF NOT EXISTS so re-running is a no-op — no formal
 * Prisma migration needed, same tradeoff the shipper-portal tables made.
 */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

let _ensured = false;

function isInsufficientPrivilege(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    (e.meta as { code?: string } | undefined)?.code === '42501'
  );
}

export async function ensureLeasingPortalTables(): Promise<void> {
  if (_ensured) return;

  try {
    await ensureLeasingPortalTablesInner();
  } catch (e) {
    if (!isInsufficientPrivilege(e)) throw e;
    // See the identical fix in src/lib/branding.ts / payment-schema.ts —
    // a later hardening pass revoked the runtime role's CREATE privilege
    // on the public schema. These tables were created successfully before
    // that change landed (verified live during the original G11 build),
    // so assume they're already there.
    console.warn('[ensureLeasingPortalTables] DDL skipped: runtime role lacks CREATE privilege on public schema (assuming tables already exist)');
  }
  _ensured = true;
}

async function ensureLeasingPortalTablesInner(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS lessee_portal_users (
      id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       TEXT         NOT NULL,
      lessee_id       TEXT         NOT NULL,
      email           TEXT         NOT NULL,
      full_name       TEXT,
      phone           TEXT,
      /** NULL until the user accepts an invitation and sets a password. */
      password_hash   TEXT,
      is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
      /** LESSEE_USER  - can view own contracts/invoices/documents, pay,
       *                 sign renewals, upload documents, file damage
       *                 reports, request renewal/termination.
       *  LESSEE_ADMIN - above + can invite additional users for the same
       *                 lessee (corporate accounts with multiple contacts). */
      role            TEXT         NOT NULL DEFAULT 'LESSEE_USER',
      last_login_at   TIMESTAMPTZ,
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      deleted_at      TIMESTAMPTZ,
      UNIQUE (tenant_id, email)
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_lessee_portal_users_lessee
     ON lessee_portal_users (lessee_id) WHERE deleted_at IS NULL`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_lessee_portal_users_tenant_email
     ON lessee_portal_users (tenant_id, email) WHERE deleted_at IS NULL`,
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS lessee_portal_invitations (
      id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id            TEXT         NOT NULL,
      portal_user_id       UUID         NOT NULL,
      /** sha256 hex of the raw token sent in the email. The raw token is
       *  never stored — only the hash, so a DB leak can't be used to
       *  accept invitations. */
      token_hash           TEXT         NOT NULL,
      expires_at           TIMESTAMPTZ  NOT NULL,
      invited_by_user_id   TEXT         NOT NULL,
      accepted_at          TIMESTAMPTZ,
      created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_lessee_portal_invites_token_hash
     ON lessee_portal_invitations (token_hash) WHERE accepted_at IS NULL`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_lessee_portal_invites_user
     ON lessee_portal_invitations (portal_user_id, created_at DESC)`,
  );
}
