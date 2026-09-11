import type { TxClient } from '@/lib/rls';

/**
 * Serialize concurrent operations on a lease contract and (optionally) one
 * or more vehicles, using transaction-scoped Postgres advisory locks —
 * same primitive as lockSerialSeries, scoped to a business entity instead
 * of a serial-number series.
 *
 * Contract-only locking isn't enough on its own: a vehicle can be touched
 * by flows on two *different* contracts at once (an exchange mid-flight on
 * contract A, a fresh allocation attempt on contract B), so this also
 * locks each vehicleId given. Locks are acquired in a fixed canonical
 * order — contract first, then vehicle IDs sorted ascending — mirroring
 * src/lib/bus-ops/assignment-txn.ts's vehicle-before-driver ordering, so
 * two transactions contending for overlapping resources always acquire
 * them in the same order and one simply waits rather than deadlocking.
 *
 * Must be called from inside the same withTenantRls transaction that
 * performs the guarded reads/writes — the lock releases automatically at
 * commit/rollback.
 */
export async function withContractAndVehicleLock<T>(
  tx: TxClient,
  tenantId: string,
  scope: { contractId: string; vehicleIds?: Array<string | null | undefined> },
  fn: () => Promise<T>,
): Promise<T> {
  await tx.$executeRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    `lease-contract:${tenantId}:${scope.contractId}`,
  );

  const vehicleIds = Array.from(
    new Set((scope.vehicleIds ?? []).filter((id): id is string => Boolean(id))),
  ).sort();

  for (const vehicleId of vehicleIds) {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      `lease-vehicle:${tenantId}:${vehicleId}`,
    );
  }

  return fn();
}

/** Convenience wrapper for the common single-vehicle (or no-vehicle) case. */
export async function withContractLock<T>(
  tx: TxClient,
  tenantId: string,
  contractId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withContractAndVehicleLock(tx, tenantId, { contractId }, fn);
}
