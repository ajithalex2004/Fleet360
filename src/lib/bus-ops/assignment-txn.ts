/**
 * assignment-txn.ts — Concurrency wrapper for trip-schedule assignments.
 *
 * Solves the check-then-write race that resource validation on its own
 * can't:
 *
 *   Dispatcher A validates vehicle X → no conflict
 *   Dispatcher B validates vehicle X → no conflict   (A hasn't committed yet)
 *   Dispatcher A commits → schedule created
 *   Dispatcher B commits → schedule created (same vehicle, same window)
 *
 * Both validations pass because neither sees the other's uncommitted
 * write; V3/D2 become advisory, not enforced.
 *
 * ── Design ──────────────────────────────────────────────────────────
 *
 * Postgres advisory locks (`pg_advisory_xact_lock`) provide a
 * transaction-scoped mutex on an arbitrary integer key. We hash the
 * resource identity into a 64-bit key and acquire the lock at the
 * start of the transaction; the lock is released automatically on
 * commit or rollback, so callers cannot leak locks by forgetting to
 * release them.
 *
 * Key scheme:
 *   `hashtext('bus-ops:vehicle:${tenantId}:${vehicleId}')` for vehicles
 *   `hashtext('bus-ops:driver:${tenantId}:${driverId}')` for drivers
 *
 * `pg_advisory_xact_lock(bigint)` takes a signed 64-bit; `hashtext`
 * returns a 32-bit hash which Postgres widens transparently.
 *
 * ── Deadlock avoidance ───────────────────────────────────────────────
 *
 * Two concurrent writers each holding one lock and waiting for the
 * other's would deadlock. We prevent this by always acquiring locks
 * in a fixed canonical order: **vehicle before driver**, and within
 * each class **sorted by tenant+id string**. Any two transactions
 * competing for overlapping resources will therefore acquire them in
 * the same order, and one will simply wait for the other.
 *
 * ── Usage ────────────────────────────────────────────────────────────
 *
 *   await withAssignmentLocks(
 *     { tenantId, vehicleId, driverId },
 *     async (tx) => {
 *       const validation = await validateResourceAssignment(input, tx);
 *       if (validation.verdict === 'BLOCK') { ... }
 *       const schedule = await tx.tripSchedule.create({ ... });
 *       return { validation, schedule };
 *     },
 *   );
 *
 * The validation reads and the schedule write share the same
 * transaction handle `tx`, so the validator's overlap query sees
 * everything committed by prior transactions (including one that
 * just released its lock) but not this transaction's own future
 * write.
 *
 * ── Feature flag ─────────────────────────────────────────────────────
 *
 * Safety validation and locking are mandatory regardless of feature flags.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export interface AssignmentLockKey {
  tenantId:  string;
  vehicleId: string | null;
  driverId:  string | null;
}

/**
 * Run `fn` inside a Prisma transaction with advisory locks held on
 * the (tenant, vehicle) and (tenant, driver) pairs. Releases locks
 * on commit or rollback.
 *
 * Null vehicleId or driverId → no lock for that resource. An unassigned
 * trip (both null) still opens a transaction but takes no locks —
 * useful for consistent read/write semantics.
 */
export async function withAssignmentLocks<T>(
  key: AssignmentLockKey,
  fn:  (tx: Prisma.TransactionClient) => Promise<T>,
  prisma: PrismaClient | Prisma.TransactionClient = defaultPrisma,
): Promise<T> {
  if (!key.tenantId) {
    throw new Error('withAssignmentLocks: tenantId is required');
  }

  const run = async (tx: Prisma.TransactionClient) => {
    // Vehicle before driver — see deadlock-avoidance note above.
    if (key.vehicleId) {
      const k = `bus-ops:vehicle:${key.tenantId}:${key.vehicleId}`;
      // hashtext takes text and returns a 32-bit int; pg_advisory_xact_lock
      // accepts bigint. Postgres widens seamlessly.
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, k);
    }
    if (key.driverId) {
      const k = `bus-ops:driver:${key.tenantId}:${key.driverId}`;
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, k);
    }
    return fn(tx);
  };
  return '$transaction' in prisma
    ? withTenantRls(prisma as PrismaClient, key.tenantId, run)
    : run(prisma as Prisma.TransactionClient);
}

/**
 * Estimate the roster size for a proposed trip. Used by the V4
 * capacity check on POST, where TripPassenger rows don't exist yet
 * (roster expansion happens after schedule create).
 *
 * Counts active RoutePassenger rows whose validity window includes
 * the trip date. Matches the same eligibility logic that
 * expandRosterToTrip() will use at trip-create time, so V4's
 * warning corresponds to what will actually happen.
 */
export async function estimateRosterCountForTrip(
  args:  { tenantId: string; routeId: string; tripDate: Date },
  prisma: PrismaClient | Prisma.TransactionClient = defaultPrisma,
): Promise<number> {
  // Normalise to UTC date-only for RoutePassenger.effectiveFrom/To
  // comparison. RoutePassenger uses DATE columns; a stray time-of-day
  // in the trip date could push it past a same-day effectiveTo.
  const day = new Date(args.tripDate);
  day.setUTCHours(0, 0, 0, 0);
  return prisma.routePassenger.count({
    where: {
      tenantId:  args.tenantId,
      routeId:   args.routeId,
      status:    'ACTIVE',
      deletedAt: null,
      effectiveFrom: { lte: day },
      OR: [
        { effectiveTo: null },
        { effectiveTo: { gte: day } },
      ],
    },
  });
}

/** Assignment ownership and safety invariants cannot be disabled by a rollout flag. */
export function isValidationEnabled(): boolean {
  return true;
}
