/**
 * Leasing payment intents — lazy schema initialisation.
 *
 * Same lazy-init pattern as leasing-portal/schema.ts and
 * shipper-portal/schema.ts. Tracks payment ATTEMPTS (pending, received,
 * failed, cancelled) — distinct from LeaseReceipt, which only models
 * money already confirmed received. A lessee clicking "Pay now" in the
 * portal creates a PENDING row here; staff (or, once a real gateway is
 * wired in, a webhook) confirms it, which is what actually marks the
 * invoice paid and writes the LeaseReceipt.
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

export async function ensurePaymentIntentTables(): Promise<void> {
  if (_ensured) return;

  try {
    await ensurePaymentIntentTablesInner();
  } catch (e) {
    if (!isInsufficientPrivilege(e)) throw e;
    // A later hardening pass revoked the runtime role's CREATE privilege
    // on the public schema (see the identical fix in src/lib/branding.ts,
    // src/lib/fleet/schema.ts, src/lib/assets/schema.ts, src/lib/billing.ts)
    // — CREATE TABLE IF NOT EXISTS needs schema-level CREATE to even
    // attempt the no-op, regardless of whether the table already exists.
    // These tables were created successfully before that change landed
    // (verified live during the original G4 build), so assume they're
    // already there rather than hard-failing every payment confirmation.
    console.warn('[ensurePaymentIntentTables] DDL skipped: runtime role lacks CREATE privilege on public schema (assuming tables already exist)');
  }
  _ensured = true;
}

async function ensurePaymentIntentTablesInner(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS lease_payment_intents (
      id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id         TEXT         NOT NULL,
      invoice_id        TEXT         NOT NULL,
      lessee_id         TEXT         NOT NULL,
      amount            NUMERIC      NOT NULL,
      currency          TEXT         NOT NULL DEFAULT 'AED',
      /** Which payment-provider implementation created this intent.
       *  'stub' today; a real gateway integration would use its own id
       *  ('stripe', etc.) and this row's provider_ref would hold its
       *  session/charge id. */
      provider          TEXT         NOT NULL DEFAULT 'stub',
      provider_ref      TEXT,
      method            TEXT         NOT NULL DEFAULT 'BANK_TRANSFER', -- BANK_TRANSFER|CHEQUE|CARD|OTHER
      /** PENDING -> RECEIVED (staff/webhook confirms) or CANCELLED. */
      status            TEXT         NOT NULL DEFAULT 'PENDING',
      initiated_by      TEXT         NOT NULL DEFAULT 'LESSEE', -- LESSEE|STAFF
      initiated_by_user TEXT,
      reference_code    TEXT         NOT NULL,
      notes             TEXT,
      confirmed_at      TIMESTAMPTZ,
      confirmed_by      TEXT,
      receipt_id        TEXT,
      created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_payment_intents_invoice
     ON lease_payment_intents (invoice_id)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_payment_intents_tenant_status
     ON lease_payment_intents (tenant_id, status)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_payment_intents_lessee
     ON lease_payment_intents (lessee_id, created_at DESC)`,
  );
}
