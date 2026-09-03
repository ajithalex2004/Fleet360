/**
 * Leasing self-service — lazy schema initialisation for damage reports
 * and e-signatures. Same lazy-init pattern as the other new leasing
 * tables in this codebase (leasing-portal/schema.ts, payment-schema.ts,
 * shipper-portal/schema.ts).
 */

import { prisma } from '@/lib/prisma';

let _ensured = false;

export async function ensureSelfServiceTables(): Promise<void> {
  if (_ensured) return;

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
      entity_type    TEXT         NOT NULL, -- RENEWAL
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

  _ensured = true;
}
