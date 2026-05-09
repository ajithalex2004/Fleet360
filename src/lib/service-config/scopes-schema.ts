/**
 * Lazy-creates the `service_scopes` table for Phase 2E multi-tenant
 * inheritance. Every tenant has exactly one **root** scope (auto-created
 * on first read); admins can carve out branches / regions / departments
 * underneath and override rules at any level. The chain is driven by
 * `parent_scope_id` — the level enum is descriptive only.
 */

import { prisma } from '@/lib/prisma';
import type { ServiceScope, ScopeLevel } from '@/types/service-config';

let _ensured = false;

export async function ensureScopesTable(): Promise<void> {
  if (_ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS service_scopes (
      id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       TEXT         NOT NULL,
      parent_scope_id UUID,
      level           TEXT         NOT NULL DEFAULT 'COMPANY',
      key             TEXT         NOT NULL,
      name            TEXT         NOT NULL,
      description     TEXT,
      sort_order      INTEGER      NOT NULL DEFAULT 0,
      is_root         BOOLEAN      NOT NULL DEFAULT FALSE,
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      deleted_at      TIMESTAMPTZ,
      UNIQUE (tenant_id, key)
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_service_scopes_tenant
     ON service_scopes (tenant_id) WHERE deleted_at IS NULL`,
  );
  // Only one root per tenant — partial unique index.
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_service_scopes_root
     ON service_scopes (tenant_id) WHERE is_root = TRUE AND deleted_at IS NULL`,
  );
  _ensured = true;
}

interface ScopeRow {
  id: string; tenant_id: string; parent_scope_id: string | null;
  level: string; key: string; name: string; description: string | null;
  sort_order: number; is_root: boolean;
  created_at: string; updated_at: string;
}

function rowToApi(r: ScopeRow): ServiceScope {
  return {
    id: r.id, tenantId: r.tenant_id, parentScopeId: r.parent_scope_id,
    level: r.level as ScopeLevel,
    key: r.key, name: r.name, description: r.description,
    sortOrder: r.sort_order, isRoot: r.is_root,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

const SELECT = `id::text, tenant_id, parent_scope_id::text, level, key, name,
  description, sort_order, is_root, created_at::text, updated_at::text`;

/**
 * Ensure the tenant has its synthesized root scope. Returns the root
 * scope's id. Idempotent; safe to call repeatedly.
 */
export async function ensureRootScope(tenantId: string): Promise<string> {
  await ensureScopesTable();

  // Already exists?
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text FROM service_scopes
     WHERE tenant_id = $1 AND is_root = TRUE AND deleted_at IS NULL
     LIMIT 1`,
    tenantId,
  ).catch(() => []);
  if (existing[0]) return existing[0].id;

  // Create — partial unique index protects against races; on conflict, re-read.
  await prisma.$executeRawUnsafe(
    `INSERT INTO service_scopes
       (tenant_id, level, key, name, description, sort_order, is_root)
     VALUES ($1, 'COMPANY', 'ROOT', 'Tenant Root',
             'Default scope — applies to the whole tenant unless overridden.',
             0, TRUE)`,
    tenantId,
  ).catch(() => {});

  const after = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text FROM service_scopes
     WHERE tenant_id = $1 AND is_root = TRUE AND deleted_at IS NULL
     LIMIT 1`,
    tenantId,
  ).catch(() => []);
  if (!after[0]) throw new Error(`Failed to ensure root scope for tenant ${tenantId}`);
  return after[0].id;
}

/** List every (non-deleted) scope for a tenant, ordered for UI rendering. */
export async function listScopes(tenantId: string): Promise<ServiceScope[]> {
  await ensureScopesTable();
  const rows = await prisma.$queryRawUnsafe<ScopeRow[]>(
    `SELECT ${SELECT}
     FROM service_scopes
     WHERE tenant_id = $1 AND deleted_at IS NULL
     ORDER BY is_root DESC, level, sort_order, name`,
    tenantId,
  ).catch(() => []);
  return rows.map(rowToApi);
}

/**
 * Resolve the parent chain from a scope up to the root, inclusive.
 * Returns scopes ordered leaf → root. Used by the resolver to walk
 * inheritance: the first matching service_rules row wins.
 */
export async function loadScopeChain(
  tenantId: string,
  scopeId: string,
): Promise<ServiceScope[]> {
  await ensureScopesTable();
  // Recursive CTE — Postgres-native parent walk.
  const rows = await prisma.$queryRawUnsafe<ScopeRow[]>(
    `WITH RECURSIVE chain AS (
       SELECT ${SELECT}, 0 AS depth FROM service_scopes
        WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL
       UNION ALL
       SELECT s.id::text, s.tenant_id, s.parent_scope_id::text, s.level, s.key, s.name,
              s.description, s.sort_order, s.is_root,
              s.created_at::text, s.updated_at::text,
              c.depth + 1
       FROM service_scopes s
       JOIN chain c ON s.id = c.parent_scope_id::uuid
       WHERE s.tenant_id = $2 AND s.deleted_at IS NULL
     )
     SELECT id, tenant_id, parent_scope_id, level, key, name, description,
            sort_order, is_root, created_at, updated_at
     FROM chain ORDER BY depth ASC`,
    scopeId, tenantId,
  ).catch(() => []);
  return rows.map(rowToApi);
}

export async function getScope(
  tenantId: string,
  scopeId: string,
): Promise<ServiceScope | null> {
  await ensureScopesTable();
  const rows = await prisma.$queryRawUnsafe<ScopeRow[]>(
    `SELECT ${SELECT} FROM service_scopes
     WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL
     LIMIT 1`,
    scopeId, tenantId,
  ).catch(() => []);
  return rows[0] ? rowToApi(rows[0]) : null;
}

export async function createScope(
  tenantId: string,
  args: {
    parentScopeId: string | null;
    level: ScopeLevel;
    key: string;
    name: string;
    description?: string | null;
    sortOrder?: number;
  },
): Promise<ServiceScope> {
  await ensureScopesTable();
  const rows = await prisma.$queryRawUnsafe<ScopeRow[]>(
    `INSERT INTO service_scopes
       (tenant_id, parent_scope_id, level, key, name, description, sort_order, is_root)
     VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, FALSE)
     RETURNING ${SELECT}`,
    tenantId, args.parentScopeId, args.level, args.key, args.name,
    args.description ?? null, args.sortOrder ?? 100,
  );
  if (!rows[0]) throw new Error('createScope returned no row');
  return rowToApi(rows[0]);
}

export async function updateScope(
  tenantId: string,
  scopeId: string,
  patch: Partial<{
    parentScopeId: string | null;
    level: ScopeLevel;
    name: string;
    description: string | null;
    sortOrder: number;
  }>,
): Promise<ServiceScope | null> {
  await ensureScopesTable();
  const sets: string[] = [];
  const args: unknown[] = [];
  let p = 1;
  const setIf = (col: string, value: unknown, cast = '') => {
    if (value === undefined) return;
    sets.push(`${col} = $${p}${cast}`); args.push(value); p++;
  };
  if ('parentScopeId' in patch) setIf('parent_scope_id', patch.parentScopeId, '::uuid');
  if (patch.level !== undefined)       setIf('level',       patch.level);
  if (patch.name !== undefined)        setIf('name',        patch.name);
  if ('description' in patch)          setIf('description', patch.description ?? null);
  if (patch.sortOrder !== undefined)   setIf('sort_order',  patch.sortOrder);
  if (sets.length === 0) return await getScope(tenantId, scopeId);
  sets.push(`updated_at = NOW()`);
  args.push(scopeId, tenantId);
  const rows = await prisma.$queryRawUnsafe<ScopeRow[]>(
    `UPDATE service_scopes SET ${sets.join(', ')}
     WHERE id = $${p}::uuid AND tenant_id = $${p + 1} AND deleted_at IS NULL
     RETURNING ${SELECT}`,
    ...args,
  );
  return rows[0] ? rowToApi(rows[0]) : null;
}

/** Soft-delete a non-root scope. Children must be re-parented first. */
export async function deleteScope(
  tenantId: string,
  scopeId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureScopesTable();
  const target = await getScope(tenantId, scopeId);
  if (!target) return { ok: false, error: 'Scope not found' };
  if (target.isRoot) return { ok: false, error: 'Cannot delete the tenant root scope.' };

  const childCount = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM service_scopes
     WHERE parent_scope_id = $1::uuid AND deleted_at IS NULL`,
    scopeId,
  ).catch(() => [{ count: BigInt(0) }]);
  if (Number(childCount[0]?.count ?? BigInt(0)) > 0) {
    return { ok: false, error: 'Move or delete child scopes first.' };
  }

  await prisma.$executeRawUnsafe(
    `UPDATE service_scopes SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1::uuid AND tenant_id = $2`,
    scopeId, tenantId,
  );
  return { ok: true };
}
