/**
 * Lazy-creates and migrates the `service_rules` table.
 *
 * Phase 2B — single table, JSONB rules per (service_type, category).
 * Phase 2D — append-only versioning with effective_from / effective_to.
 *   • Each save inserts a NEW row and closes the previously-active row.
 *   • The partial unique index `uq_service_rules_active` guarantees at
 *     most one currently-active row per (service_type_id, category).
 *   • History = every row with effective_to IS NOT NULL.
 *   • Rollback = insert a clone of an old row's `rules` as the new active.
 *
 * The migration is idempotent — runs safely on tenants already on the
 * 2B schema and on fresh installs alike.
 */

import { prisma } from '@/lib/prisma';
import type { RuleCategory } from '@/types/service-rules';

let _ensured = false;

export async function ensureServiceRulesTable(): Promise<void> {
  if (_ensured) return;

  // 2B base schema — created on first install. Existing tenants already
  // have this table.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS service_rules (
      service_type_id  UUID         NOT NULL,
      category         TEXT         NOT NULL,
      rules            JSONB        NOT NULL DEFAULT '{}'::jsonb,
      updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_by       TEXT
    )
  `);

  // 2D — versioning columns (idempotent ALTER ADD COLUMN IF NOT EXISTS).
  await prisma.$executeRawUnsafe(`ALTER TABLE service_rules ADD COLUMN IF NOT EXISTS id UUID`);
  await prisma.$executeRawUnsafe(`ALTER TABLE service_rules ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ`);
  await prisma.$executeRawUnsafe(`ALTER TABLE service_rules ADD COLUMN IF NOT EXISTS effective_to TIMESTAMPTZ`);

  // Backfill: any pre-2D rows get an id and an effective_from = updated_at.
  await prisma.$executeRawUnsafe(`UPDATE service_rules SET id = gen_random_uuid() WHERE id IS NULL`);
  await prisma.$executeRawUnsafe(`UPDATE service_rules SET effective_from = updated_at WHERE effective_from IS NULL`);

  // Lock down the constraints. Each ALTER is best-effort — if we already
  // ran on a previous deploy these are no-ops, but we keep them in catch
  // blocks because some Postgres versions error on "already set".
  await prisma.$executeRawUnsafe(`ALTER TABLE service_rules ALTER COLUMN id SET DEFAULT gen_random_uuid()`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE service_rules ALTER COLUMN id SET NOT NULL`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE service_rules ALTER COLUMN effective_from SET DEFAULT NOW()`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE service_rules ALTER COLUMN effective_from SET NOT NULL`).catch(() => {});

  // PK swap — drop the old composite, install the new id-based one.
  await prisma.$executeRawUnsafe(`ALTER TABLE service_rules DROP CONSTRAINT IF EXISTS service_rules_pkey`);
  await prisma.$executeRawUnsafe(`ALTER TABLE service_rules ADD PRIMARY KEY (id)`).catch(() => {});

  // Helpful indexes.
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_service_rules_active
      ON service_rules (service_type_id, category) WHERE effective_to IS NULL
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_service_rules_history
      ON service_rules (service_type_id, category, effective_from DESC)
  `);

  _ensured = true;
}

export async function loadRules<T = unknown>(
  serviceTypeId: string,
  category: RuleCategory,
): Promise<T | null> {
  await ensureServiceRulesTable();
  const rows = await prisma.$queryRawUnsafe<Array<{ rules: unknown }>>(
    `SELECT rules FROM service_rules
     WHERE service_type_id = $1::uuid AND category = $2 AND effective_to IS NULL
     LIMIT 1`,
    serviceTypeId, category,
  ).catch(() => []);
  return (rows[0]?.rules as T) ?? null;
}

/**
 * Append-only save. Closes the currently-active row (sets `effective_to =
 * NOW()`) and inserts a fresh active row with the new payload.
 *
 * Wrapped in a transaction so we never leave the table with two active
 * rows or zero active rows for the pair.
 */
export async function saveRules(
  serviceTypeId: string,
  category: RuleCategory,
  rules: unknown,
  updatedBy: string | null,
): Promise<void> {
  await ensureServiceRulesTable();
  await prisma.$transaction([
    prisma.$executeRawUnsafe(
      `UPDATE service_rules
         SET effective_to = NOW()
       WHERE service_type_id = $1::uuid AND category = $2 AND effective_to IS NULL`,
      serviceTypeId, category,
    ),
    prisma.$executeRawUnsafe(
      `INSERT INTO service_rules
         (service_type_id, category, rules, effective_from, effective_to,
          updated_at, updated_by)
       VALUES ($1::uuid, $2, $3::jsonb, NOW(), NULL, NOW(), $4)`,
      serviceTypeId, category, JSON.stringify(rules), updatedBy,
    ),
  ]);
}

/** A historical row — used by the admin History panel and rollback flow. */
export interface RuleVersion {
  id: string;
  category: string;
  rules: unknown;
  effectiveFrom: string;
  effectiveTo: string | null;
  updatedAt: string;
  updatedBy: string | null;
  active: boolean;
}

/**
 * Return every row for (type, category) ordered newest-first, including
 * the currently-active one. Used by the admin History panel.
 */
export async function loadRulesHistory(
  serviceTypeId: string,
  category: RuleCategory,
  limit = 50,
): Promise<RuleVersion[]> {
  await ensureServiceRulesTable();
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string; category: string; rules: unknown;
    effective_from: string; effective_to: string | null;
    updated_at: string; updated_by: string | null;
  }>>(
    `SELECT id::text, category, rules,
            effective_from::text, effective_to::text,
            updated_at::text, updated_by
     FROM service_rules
     WHERE service_type_id = $1::uuid AND category = $2
     ORDER BY effective_from DESC
     LIMIT $3`,
    serviceTypeId, category, limit,
  ).catch(() => []);

  return rows.map(r => ({
    id: r.id,
    category: r.category,
    rules: r.rules,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
    active: r.effective_to === null,
  }));
}

/**
 * Seed-mode insert: only writes if no active row exists for the pair.
 * Used by the platform seed so that re-runs are idempotent and admin
 * edits are never overwritten. Returns true when a row was inserted.
 */
export async function seedRulesIfAbsent(
  serviceTypeId: string,
  category: RuleCategory,
  rules: unknown,
): Promise<boolean> {
  await ensureServiceRulesTable();
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text FROM service_rules
     WHERE service_type_id = $1::uuid AND category = $2 AND effective_to IS NULL
     LIMIT 1`,
    serviceTypeId, category,
  ).catch(() => []);
  if (existing.length > 0) return false;

  await prisma.$executeRawUnsafe(
    `INSERT INTO service_rules
       (service_type_id, category, rules, effective_from, effective_to, updated_at, updated_by)
     VALUES ($1::uuid, $2, $3::jsonb, NOW(), NULL, NOW(), 'system-seed')`,
    serviceTypeId, category, JSON.stringify(rules),
  );
  return true;
}

/**
 * Roll back to a historical version. Loads the historical row's rules
 * payload, then runs the standard saveRules flow so the new active row
 * preserves the audit trail (the rollback itself becomes a new entry,
 * the historical row is left untouched).
 */
export async function rollbackToVersion(
  serviceTypeId: string,
  category: RuleCategory,
  historicalId: string,
  updatedBy: string | null,
): Promise<{ ok: true; rules: unknown } | { ok: false; error: string }> {
  await ensureServiceRulesTable();
  const rows = await prisma.$queryRawUnsafe<Array<{ rules: unknown; category: string; service_type_id: string }>>(
    `SELECT rules, category, service_type_id::text
     FROM service_rules
     WHERE id = $1::uuid`,
    historicalId,
  ).catch(() => []);
  const r = rows[0];
  if (!r) return { ok: false, error: 'Version not found' };
  if (r.category !== category) return { ok: false, error: 'Version belongs to a different category' };
  if (r.service_type_id !== serviceTypeId) return { ok: false, error: 'Version belongs to a different service type' };

  await saveRules(serviceTypeId, category, r.rules, updatedBy);
  return { ok: true, rules: r.rules };
}
