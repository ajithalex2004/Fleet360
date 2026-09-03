/**
 * Leasing self-service — lazy schema initialisation for damage reports
 * and e-signatures. Same lazy-init pattern as the other new leasing
 * tables in this codebase (leasing-portal/schema.ts, payment-schema.ts,
 * shipper-portal/schema.ts).
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

export async function ensureSelfServiceTables(): Promise<void> {
  if (_ensured) return;

  try {
    await ensureSelfServiceTablesInner();
  } catch (e) {
    if (!isInsufficientPrivilege(e)) throw e;
    // See the identical fix in src/lib/branding.ts / payment-schema.ts —
    // a later hardening pass revoked the runtime role's CREATE privilege
    // on the public schema. These tables were created successfully before
    // that change landed (verified live during the original G11 build),
    // so assume they're already there.
    console.warn('[ensureSelfServiceTables] DDL skipped: runtime role lacks CREATE privilege on public schema (assuming tables already exist)');
  }
  _ensured = true;
}

async function ensureSelfServiceTablesInner(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS lease_damage_reports (
      id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id     TEXT         NOT NULL,
      lessee_id     TEXT         NOT NULL,
      contract_id   TEXT         NOT NULL,
      vehicle_ref   TEXT,
      severity      TEXT         NOT NULL DEFAULT 'MODERATE', -- MINOR|MODERATE|SEVERE
      description   TEXT         NOT NULL,
      photo_urls    JSONB        NOT NULL DEFAULT '[]'::jsonb,
      status        TEXT         NOT NULL DEFAULT 'SUBMITTED', -- SUBMITTED|ACKNOWLEDGED|RESOLVED
      reported_by   TEXT         NOT NULL,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_damage_reports_lessee
     ON lease_damage_reports (tenant_id, lessee_id, created_at DESC)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_damage_reports_contract
     ON lease_damage_reports (contract_id)`,
  );

  // Lightweight click-to-sign acceptance record — typed full name + explicit
  // agree action, timestamped and IP-stamped, sealed with a hash of what was
  // actually agreed to so the record can't be silently altered after the
  // fact. Not a DocuSign-style integration; a real, legally-common pattern
  // for low-stakes online acceptance (the same shape as clicking "I agree"
  // on a EULA), scoped appropriately for a renewal confirmation.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS lease_esignatures (
      id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id      TEXT         NOT NULL,
      lessee_id      TEXT         NOT NULL,
      entity_type    TEXT         NOT NULL, -- RENEWAL | CONTRACT
      entity_id      TEXT         NOT NULL,
      signer_name    TEXT         NOT NULL,
      signer_email   TEXT         NOT NULL,
      ip_address     TEXT,
      user_agent     TEXT,
      accepted_text  TEXT         NOT NULL,
      content_hash   TEXT         NOT NULL,
      signed_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_esignatures_entity
     ON lease_esignatures (entity_type, entity_id)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_esignatures_entity
     ON lease_esignatures (entity_type, entity_id)`,
  );
}
