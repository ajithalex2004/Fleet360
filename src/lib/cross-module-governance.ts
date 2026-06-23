/**
 * Stub for the missing cross-module-governance module referenced from
 * src/lib/leasing-governance.ts. The original implementation was either
 * never committed or deleted in a cleanup pass; this stub exports
 * placeholder versions of the 3 symbols the file imports so the
 * production Next.js build compiles.
 *
 * Behaviour:
 *   - ensureOperationalTenantColumn: no-op (real impl ran ALTER TABLE
 *     to add a tenant_id column idempotently; the column now exists
 *     for the tables that need it via the Phase 2c migration).
 *   - tenantScopedIds: returns an empty array (real impl queried the
 *     table for IDs filtered by tenant; until the original module is
 *     restored, callers degrade to "no ids" rather than build-fail).
 *
 * Replace this file with the real implementation when the deleted
 * module is restored from history.
 */
import { prisma } from '@/lib/prisma';

export interface OperationalContext {
  tenantId: string;
  userId?: string;
}

/**
 * Stubbed: no-op. The Phase 2c Prisma migration
 * (20260623140000_add_tenant_id_to_fleet_tables) already added
 * tenant_id columns + NOT NULL + FK to the GORM-managed tables. The
 * legacy leasing tables (lease_contracts_v2, etc.) may not have it yet,
 * which is why the original implementation existed. Restoring it is a
 * separate piece of work; this stub keeps the build green meanwhile.
 */
export async function ensureOperationalTenantColumn(_tableName: string): Promise<void> {
  // intentional no-op
}

/**
 * Stubbed: returns an empty array. Real implementation queried the
 * table for ids where tenant_id matches and (when activeOnly) the row
 * is not soft-deleted.
 *
 * Returning [] is the safest stub: callers that filter by these ids
 * (e.g. "show contracts in this tenant") will show nothing rather
 * than leak cross-tenant data. When the real module is restored, the
 * pages start working without further changes.
 */
export async function tenantScopedIds(
  _tableName: string,
  _tenantId: string,
  _options?: { activeOnly?: boolean },
): Promise<string[]> {
  // Touch prisma to ensure the import resolves (otherwise TS may
  // tree-shake the import even though the runtime needs it).
  void prisma;
  return [];
}
