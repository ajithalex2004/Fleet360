/**
 * Lazy-creates the `service_rules` table for Phase 2B.
 *
 * Single-table-multi-category pattern (same shape as service_tickets +
 * tenant_ticket_types). One row per (service_type_id, category) holds the
 * rule-set as a JSONB blob. Adding a new category later is a zero-DDL change.
 */

import { prisma } from '@/lib/prisma';
import type { RuleCategory } from '@/types/service-rules';

let _ensured = false;

export async function ensureServiceRulesTable(): Promise<void> {
  if (_ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS service_rules (
      service_type_id  UUID         NOT NULL,
      category         TEXT         NOT NULL,
      rules            JSONB        NOT NULL DEFAULT '{}'::jsonb,
      updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_by       TEXT,
      PRIMARY KEY (service_type_id, category)
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_service_rules_type ON service_rules (service_type_id)`,
  );
  _ensured = true;
}

export async function loadRules<T = unknown>(
  serviceTypeId: string,
  category: RuleCategory,
): Promise<T | null> {
  await ensureServiceRulesTable();
  const rows = await prisma.$queryRawUnsafe<Array<{ rules: unknown }>>(
    `SELECT rules FROM service_rules
     WHERE service_type_id = $1::uuid AND category = $2`,
    serviceTypeId, category,
  ).catch(() => []);
  return (rows[0]?.rules as T) ?? null;
}

export async function saveRules(
  serviceTypeId: string,
  category: RuleCategory,
  rules: unknown,
  updatedBy: string | null,
): Promise<void> {
  await ensureServiceRulesTable();
  await prisma.$executeRawUnsafe(
    `INSERT INTO service_rules (service_type_id, category, rules, updated_at, updated_by)
     VALUES ($1::uuid, $2, $3::jsonb, NOW(), $4)
     ON CONFLICT (service_type_id, category) DO UPDATE SET
       rules      = EXCLUDED.rules,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by`,
    serviceTypeId, category, JSON.stringify(rules), updatedBy,
  );
}
