/**
 * Allocate a tenant-scoped unique BusRoute.code (e.g. RT-0001, SCH-0003).
 *
 * Uniqueness is enforced by DB index uniq_bus_routes_tenant_code
 * (tenant_id, code) WHERE code IS NOT NULL.
 *
 * Callers should retry create once on Prisma P2002 (unique violation)
 * for concurrent creates under the same tenant.
 */

import type { PrismaClient, Prisma } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export type RouteCodePrefix = 'RT' | 'SCH' | 'RTE';

/** Map routeType → stable prefix. */
export function routeCodePrefix(routeType?: string | null): RouteCodePrefix {
  const t = (routeType ?? 'STAFF').toUpperCase();
  if (t === 'SCHOOL') return 'SCH';
  if (t === 'BOTH') return 'RTE';
  return 'RT'; // STAFF and unknown
}

/**
 * Next code for this tenant + prefix: PREFIX-0001, PREFIX-0002, …
 * Only considers codes matching ^PREFIX-digits$ so free-form overrides
 * don't break the sequence.
 *
 * Deliberately counts soft-deleted routes. The unique index above has no
 * `deleted_at IS NULL` clause, so a soft-deleted row keeps owning its code —
 * skipping those here would hand out a code the index still refuses, and every
 * create would fail with P2002. That is not theoretical: a tenant that had
 * soft-deleted all of its routes got `max = 0` and was issued RT-0001 for every
 * row of a 14-route import, all of which collided with the deleted RT-0001.
 * Codes are cheap; reusing a deleted route's code would also make audit and
 * consolidation history ambiguous.
 */
export async function allocateNextRouteCode(
  db: Db,
  tenantId: string,
  routeType?: string | null,
): Promise<string> {
  if (!tenantId?.trim()) {
    throw new Error('allocateNextRouteCode: tenantId is required');
  }

  const prefix = routeCodePrefix(routeType);
  const rows = await db.busRoute.findMany({
    where: {
      tenantId,
      code: { not: null },
    },
    select: { code: true },
  });

  const re = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  let max = 0;
  for (const row of rows) {
    const m = row.code?.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }

  const next = max + 1;
  return `${prefix}-${String(next).padStart(4, '0')}`;
}

/** True if Prisma error is unique constraint on code (or general unique). */
export function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2002'
  );
}
