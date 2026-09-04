/**
 * Lazy-creates and migrates the `service_rules` table.
 *
 * Phase 2B — single table, JSONB rules per (service_type, category).
 * Phase 2D — append-only versioning with effective_from / effective_to.
 * Phase 2E — multi-tenant inheritance: rules are attached to a scope_id;
 *   resolvers walk the parent_scope_id chain. NULL scope_id is treated
 *   as the tenant-root scope (handled by callers via ensureRootScope).
 *
 * The migration is idempotent — runs safely on tenants already on the
 * 2B/2D schema and on fresh installs alike.
 */

import { prisma } from '@/lib/prisma';
import type { RuleCategory } from '@/types/service-rules';

/**
 * service_rules' schema (Phase 2B -> 2D -> 2E) now lives in
 * prisma/migrations/20260910000033_service_config_engine_tables.
 * ensureServiceRulesTable() used to lazily run that migration here on
 * every call; callers no longer call it.
 */

/**
 * Walk the scope chain looking for an active rule row. Returns the first
 * match (closest scope wins) plus the scope_id that owned it, or null
 * if no row exists anywhere in the chain.
 *
 * `chainScopeIds` is leaf → root, e.g. [departmentId, regionId, branchId, rootId].
 */
export async function loadRulesForChain<T = unknown>(
  serviceTypeId: string,
  category: RuleCategory,
  chainScopeIds: string[],
): Promise<{ rules: T; scopeId: string } | null> {
  if (chainScopeIds.length === 0) return null;

  // Single query: pull every active row matching any scope in the chain,
  // then pick the one whose scope_id appears earliest in the chain.
  const rows = await prisma.$queryRawUnsafe<Array<{ rules: unknown; scope_id: string | null }>>(
    `SELECT rules, scope_id::text
     FROM service_rules
     WHERE service_type_id = $1::uuid
       AND category = $2
       AND effective_to IS NULL
       AND scope_id = ANY($3::uuid[])`,
    serviceTypeId, category, chainScopeIds,
  ).catch(() => []);
  if (rows.length === 0) return null;

  const order = new Map(chainScopeIds.map((id, i) => [id, i]));
  rows.sort((a, b) => (order.get(a.scope_id ?? '') ?? Infinity) - (order.get(b.scope_id ?? '') ?? Infinity));
  return { rules: rows[0].rules as T, scopeId: rows[0].scope_id ?? chainScopeIds[chainScopeIds.length - 1] };
}

/** Read the active rule for one specific scope (no inheritance). */
export async function loadRulesForScope<T = unknown>(
  serviceTypeId: string,
  category: RuleCategory,
  scopeId: string,
): Promise<T | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ rules: unknown }>>(
    `SELECT rules FROM service_rules
     WHERE service_type_id = $1::uuid AND category = $2
       AND scope_id = $3::uuid AND effective_to IS NULL
     LIMIT 1`,
    serviceTypeId, category, scopeId,
  ).catch(() => []);
  return (rows[0]?.rules as T) ?? null;
}

/**
 * Append-only save: closes the previously-active row for (type, category,
 * scope) and inserts a new active row. Wrapped in a transaction so we
 * never leave the table with two active rows or zero active rows.
 */
export async function saveRules(
  serviceTypeId: string,
  category: RuleCategory,
  rules: unknown,
  updatedBy: string | null,
  scopeId: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.$executeRawUnsafe(
      `UPDATE service_rules
         SET effective_to = NOW()
       WHERE service_type_id = $1::uuid
         AND category = $2
         AND scope_id = $3::uuid
         AND effective_to IS NULL`,
      serviceTypeId, category, scopeId,
    ),
    prisma.$executeRawUnsafe(
      `INSERT INTO service_rules
         (service_type_id, category, scope_id, rules, effective_from, effective_to,
          updated_at, updated_by)
       VALUES ($1::uuid, $2, $3::uuid, $4::jsonb, NOW(), NULL, NOW(), $5)`,
      serviceTypeId, category, scopeId, JSON.stringify(rules), updatedBy,
    ),
  ]);
}

/** A historical row — used by the admin History panel and rollback flow. */
export interface RuleVersion {
  id: string;
  category: string;
  scopeId: string | null;
  rules: unknown;
  effectiveFrom: string;
  effectiveTo: string | null;
  updatedAt: string;
  updatedBy: string | null;
  active: boolean;
}

/**
 * History for a single (type, category, scope). Ordered newest-first,
 * including the currently-active row.
 */
export async function loadRulesHistory(
  serviceTypeId: string,
  category: RuleCategory,
  scopeId: string,
  limit = 50,
): Promise<RuleVersion[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string; category: string; scope_id: string | null; rules: unknown;
    effective_from: string; effective_to: string | null;
    updated_at: string; updated_by: string | null;
  }>>(
    `SELECT id::text, category, scope_id::text, rules,
            effective_from::text, effective_to::text,
            updated_at::text, updated_by
     FROM service_rules
     WHERE service_type_id = $1::uuid AND category = $2 AND scope_id = $3::uuid
     ORDER BY effective_from DESC
     LIMIT $4`,
    serviceTypeId, category, scopeId, limit,
  ).catch(() => []);

  return rows.map(r => ({
    id: r.id, category: r.category, scopeId: r.scope_id,
    rules: r.rules,
    effectiveFrom: r.effective_from, effectiveTo: r.effective_to,
    updatedAt: r.updated_at, updatedBy: r.updated_by,
    active: r.effective_to === null,
  }));
}

/**
 * Seed-mode insert at a specific scope: only writes if no active row
 * exists for the triple. Used by the platform seed so that re-runs are
 * idempotent and admin edits are never overwritten. Returns true on insert.
 */
export async function seedRulesIfAbsent(
  serviceTypeId: string,
  category: RuleCategory,
  rules: unknown,
  scopeId: string,
): Promise<boolean> {
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text FROM service_rules
     WHERE service_type_id = $1::uuid AND category = $2 AND scope_id = $3::uuid
       AND effective_to IS NULL
     LIMIT 1`,
    serviceTypeId, category, scopeId,
  ).catch(() => []);
  if (existing.length > 0) return false;

  await prisma.$executeRawUnsafe(
    `INSERT INTO service_rules
       (service_type_id, category, scope_id, rules, effective_from, effective_to, updated_at, updated_by)
     VALUES ($1::uuid, $2, $3::uuid, $4::jsonb, NOW(), NULL, NOW(), 'system-seed')`,
    serviceTypeId, category, scopeId, JSON.stringify(rules),
  );
  return true;
}

/**
 * One-time backfill: every existing rule row that lacks a scope_id gets
 * pointed at the tenant's root scope. Idempotent — runs `WHERE scope_id
 * IS NULL` so subsequent calls are no-ops. Called from
 * ensureSeededForTenant after ensureRootScope.
 */
export async function backfillRulesToScope(
  tenantId: string,
  rootScopeId: string,
): Promise<number> {
  const result = await prisma.$executeRawUnsafe(
    `UPDATE service_rules
       SET scope_id = $1::uuid
     WHERE scope_id IS NULL
       AND service_type_id IN (
         SELECT id FROM service_types WHERE tenant_id = $2 AND deleted_at IS NULL
       )`,
    rootScopeId, tenantId,
  );
  return Number(result);
}

/**
 * Roll back to a historical version. Loads the historical row's rules
 * payload, then runs the standard saveRules flow at the SAME scope so
 * the new active row preserves the audit trail. The historical row is
 * left untouched.
 */
export async function rollbackToVersion(
  serviceTypeId: string,
  category: RuleCategory,
  scopeId: string,
  historicalId: string,
  updatedBy: string | null,
): Promise<{ ok: true; rules: unknown } | { ok: false; error: string }> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    rules: unknown; category: string; service_type_id: string; scope_id: string | null;
  }>>(
    `SELECT rules, category, service_type_id::text, scope_id::text
     FROM service_rules
     WHERE id = $1::uuid`,
    historicalId,
  ).catch(() => []);
  const r = rows[0];
  if (!r) return { ok: false, error: 'Version not found' };
  if (r.category !== category) return { ok: false, error: 'Version belongs to a different category' };
  if (r.service_type_id !== serviceTypeId) return { ok: false, error: 'Version belongs to a different service type' };
  if (r.scope_id !== scopeId) return { ok: false, error: 'Version belongs to a different scope' };

  await saveRules(serviceTypeId, category, r.rules, updatedBy, scopeId);
  return { ok: true, rules: r.rules };
}
