/**
 * Shipper Portal — lazy schema initialisation.
 *
 * Three things happen on first request to the portal:
 *   1. CREATE TABLE customer_portal_users — portal-side identities,
 *      strictly separate from tenant operator User+UserTenant.
 *   2. CREATE TABLE customer_portal_invitations — one-time tokens used
 *      to bootstrap a portal user (operator invites; shipper accepts).
 *   3. ALTER existing tables to carry the per-shipment / per-customer
 *      tracking-visibility levels (Phase 1.5). Uses ADD COLUMN IF NOT
 *      EXISTS so re-running is a no-op.
 *
 * Mirrors the lazy-init pattern already in workflow-db.ts, service-
 * config/schema.ts, and the data-master libs.
 */

import { prisma } from '@/lib/prisma';

let _ensured = false;

export async function ensureShipperPortalTables(): Promise<void> {
  if (_ensured) return;

  // ── 1. customer_portal_users ─────────────────────────────────────────
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS customer_portal_users (
      id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       TEXT         NOT NULL,
      customer_id     TEXT         NOT NULL,
      email           TEXT         NOT NULL,
      full_name       TEXT,
      phone           TEXT,
      /** NULL until the user accepts an invitation and sets a password. */
      password_hash   TEXT,
      is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
      /** SHIPPER_USER  - can create shipments, view own org's shipments.
       *  SHIPPER_ADMIN - above + can invite additional users for the same customer. */
      role            TEXT         NOT NULL DEFAULT 'SHIPPER_USER',
      last_login_at   TIMESTAMPTZ,
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      deleted_at      TIMESTAMPTZ,
      UNIQUE (tenant_id, email)
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_portal_users_customer
     ON customer_portal_users (customer_id) WHERE deleted_at IS NULL`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_portal_users_tenant_email
     ON customer_portal_users (tenant_id, email) WHERE deleted_at IS NULL`,
  );

  // ── 2. customer_portal_invitations ───────────────────────────────────
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS customer_portal_invitations (
      id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id            TEXT         NOT NULL,
      portal_user_id       UUID         NOT NULL,
      /** sha256 hex of the raw token sent in the email. The raw token
       *  is never stored — only the hash, so a DB leak can't be used
       *  to accept invitations. */
      token_hash           TEXT         NOT NULL,
      expires_at           TIMESTAMPTZ  NOT NULL,
      invited_by_user_id   TEXT         NOT NULL,
      accepted_at          TIMESTAMPTZ,
      created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_portal_invites_token_hash
     ON customer_portal_invitations (token_hash) WHERE accepted_at IS NULL`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_portal_invites_user
     ON customer_portal_invitations (portal_user_id, created_at DESC)`,
  );

  // ── 3. Tracking-visibility columns on existing tables ────────────────
  // Customers table — per-customer default tracking level
  await prisma.$executeRawUnsafe(`
    ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS portal_tracking_level TEXT NOT NULL DEFAULT 'STATUS_ONLY'
  `).catch(() => {
    // If `customers` doesn't exist yet (early dev tenant) ALTER throws —
    // fine to skip; the column will be added when customers table is created.
  });

  // logistics_shipment_orders — per-shipment override (NULL = inherit from customer)
  await prisma.$executeRawUnsafe(`
    ALTER TABLE logistics_shipment_orders
      ADD COLUMN IF NOT EXISTS portal_tracking_level TEXT
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE logistics_shipment_orders
      ADD COLUMN IF NOT EXISTS portal_tracking_override_reason TEXT
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE logistics_shipment_orders
      ADD COLUMN IF NOT EXISTS source_channel TEXT
  `).catch(() => {});

  // tenant_settings — tenant-wide default tracking level (created on demand
  // so we don't fail if the table doesn't exist yet on a fresh install).
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tenant_settings (
      tenant_id  TEXT  PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE tenant_settings
      ADD COLUMN IF NOT EXISTS default_portal_tracking_level TEXT NOT NULL DEFAULT 'STATUS_ONLY'
  `);

  _ensured = true;
}
