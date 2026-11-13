/**
 * Transaction-scoped concurrency locks, cross-module vehicle overlap guards,
 * canonical MAX+1 serial generators, and BigInt-safe vehicle serialization for
 * the Rent-A-Car (RAC) module.
 *
 * Coordinates with `src/lib/leasing/contract-lock.ts` via the shared
 * `fleet-vehicle:${tenantId}:${vehicleId}` advisory lock key so concurrent RAC
 * handovers/bookings and Leasing allocations never double-book the same car.
 */

import type { TxClient } from '@/lib/rls';
import { findGroundingBlocks } from '@/lib/fleet/grounding-blocks';

/**
 * Acquire deterministic transaction-scoped Postgres advisory locks on an
 * optional agreement/booking and sorted vehicle IDs.
 *
 * Lock acquisition order (deadlock-free with `withContractAndVehicleLock`):
 *   1. Entity lock (`rac-entity:${tenantId}:${entityKey}`) if provided
 *   2. Sorted `vehicleIds`: shared `fleet-vehicle:${tenantId}:${vehicleId}`
 *      followed by `rac-vehicle:${tenantId}:${vehicleId}`
 */
export async function withRentalLock<T>(
  tx: TxClient,
  tenantId: string,
  scope: {
    entityKey?: string | null;
    vehicleIds?: Array<string | null | undefined>;
  },
  fn: () => Promise<T>,
): Promise<T> {
  if (scope.entityKey) {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      `rac-entity:${tenantId}:${scope.entityKey}`,
    );
  }

  const vehicleIds = Array.from(
    new Set((scope.vehicleIds ?? []).filter((id): id is string => Boolean(id))),
  ).sort();

  for (const vehicleId of vehicleIds) {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      `fleet-vehicle:${tenantId}:${vehicleId}`,
    );
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      `rac-vehicle:${tenantId}:${vehicleId}`,
    );
  }

  return fn();
}

/**
 * Serialize concurrent payment / capture / credit-note mutations on a single
 * rental invoice within a tenant.
 */
export async function withInvoicePaymentLock<T>(
  tx: TxClient,
  tenantId: string,
  invoiceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await tx.$executeRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    `rac-invoice-pay:${tenantId}:${invoiceId}`,
  );
  return fn();
}

/**
 * Serialize per-tenant document numbering (`RA-`, `RBK-`, `RINV-`, `RCN-`, `RRCPT-`, `RRN-`, `AUTH-`).
 */
export async function lockRentalSerial(
  tx: TxClient,
  tenantId: string,
  series: string,
): Promise<void> {
  await tx.$executeRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    `rac-serial:${tenantId}:${series}`,
  );
}

const ALLOWED_SERIAL_TABLES: Record<string, Set<string>> = {
  rental_agreements: new Set(['agreement_no']),
  rental_bookings: new Set(['booking_ref']),
  rental_invoices: new Set(['invoice_no']),
  rental_invoice_payments: new Set(['receipt_no']),
  rental_extensions: new Set(['renewal_no']),
  rental_vehicle_transfers: new Set(['transfer_no']),
  rental_documents: new Set(['doc_ref']),
  rental_insurance_policies: new Set(['policy_no']),
  rental_inquiries: new Set(['inquiry_no']),
  rental_quotations: new Set(['quote_no']),
  rental_handovers: new Set(['handover_no']),
  rental_branches: new Set(['branch_code']),
};

/**
 * Generates a collision-free per-tenant sequential document number using
 * `lockRentalSerial` + `MAX(trailing_digits) + 1` (never unlocked `COUNT(*) + 1`,
 * which collides after soft-deletes or out-of-band inserts).
 */
export async function nextRentalSerial(
  tx: TxClient,
  args: {
    tenantId: string;
    series: string;
    prefix: string;
    table: keyof typeof ALLOWED_SERIAL_TABLES;
    column: string;
    padWidth?: number;
  },
): Promise<string> {
  const { tenantId, series, prefix, table, column, padWidth = 6 } = args;
  const allowedCols = ALLOWED_SERIAL_TABLES[table];
  if (!allowedCols || !allowedCols.has(column)) {
    throw new Error(`Disallowed serial table/column: ${table}.${column}`);
  }

  await lockRentalSerial(tx, tenantId, series);

  const rows = await withSavepoint<Array<{ max_seq: string | number | bigint | null }>>(
    tx,
    `serial_${table}_${column}`,
    () =>
      tx.$queryRawUnsafe<Array<{ max_seq: string | number | bigint | null }>>(
        `SELECT COALESCE(MAX((SUBSTRING(${column} FROM '([0-9]+)$'))::bigint), 0) AS max_seq
           FROM ${table}
          WHERE tenant_id::text = $1
            AND ${column} LIKE $2`,
        tenantId,
        `${prefix}%`,
      ),
    [{ max_seq: 0 }],
  );

  const currentMax = Number(rows[0]?.max_seq ?? 0);
  const nextSeq = Number.isFinite(currentMax) && currentMax >= 0 ? currentMax + 1 : 1;
  return `${prefix}${String(nextSeq).padStart(padWidth, '0')}`;
}

/**
 * Checks whether a physical vehicle has any overlapping CONFIRMED or ACTIVE
 * RAC booking, ACTIVE RAC agreement, active Lease allocation, open Workshop
 * WorkOrder, in-transit branch transfer, or (optionally) Fleet grounding block.
 */
export async function checkVehicleRentalConflict(
  tx: TxClient,
  args: {
    tenantId: string;
    vehicleId: string;
    startDate: Date;
    endDate: Date;
    excludeBookingId?: string | null;
    excludeAgreementId?: string | null;
    checkGrounding?: boolean;
    skipCrossModuleChecks?: boolean;
  },
): Promise<{ hasConflict: boolean; reason?: string; conflictingRef?: string }> {
  const {
    tenantId,
    vehicleId,
    startDate,
    endDate,
    excludeBookingId,
    excludeAgreementId,
    checkGrounding = false,
    skipCrossModuleChecks = false,
  } = args;

  const bookingConflicts = await tx.$queryRawUnsafe<
    Array<{ id: string; booking_ref: string | null; status: string }>
  >(
    `SELECT id::text AS id, booking_ref, status
       FROM rental_bookings
      WHERE tenant_id::text = $1
        AND vehicle_id = $2
        AND deleted_at IS NULL
        AND status IN ('CONFIRMED', 'ACTIVE')
        AND pickup_date < $4::timestamptz
        AND dropoff_date > $3::timestamptz
        ${excludeBookingId ? 'AND id::text <> $5' : ''}
      LIMIT 1`,
    ...(excludeBookingId
      ? [tenantId, vehicleId, startDate.toISOString(), endDate.toISOString(), excludeBookingId]
      : [tenantId, vehicleId, startDate.toISOString(), endDate.toISOString()]),
  );

  if (bookingConflicts.length > 0) {
    const c = bookingConflicts[0];
    return {
      hasConflict: true,
      conflictingRef: c.booking_ref ?? c.id,
      reason: `Vehicle is already reserved under booking ${c.booking_ref ?? c.id} (${c.status}) during this period`,
    };
  }

  const agreementConflicts = await tx.$queryRawUnsafe<
    Array<{ id: string; agreement_no: string | null; status: string }>
  >(
    `SELECT id::text AS id, agreement_no, status
       FROM rental_agreements
      WHERE tenant_id::text = $1
        AND vehicle_id = $2
        AND deleted_at IS NULL
        AND status = 'ACTIVE'
        AND start_date < $4::timestamptz
        AND end_date > $3::timestamptz
        ${excludeAgreementId ? 'AND id::text <> $5' : ''}
      LIMIT 1`,
    ...(excludeAgreementId
      ? [tenantId, vehicleId, startDate.toISOString(), endDate.toISOString(), excludeAgreementId]
      : [tenantId, vehicleId, startDate.toISOString(), endDate.toISOString()]),
  );

  if (agreementConflicts.length > 0) {
    const a = agreementConflicts[0];
    return {
      hasConflict: true,
      conflictingRef: a.agreement_no ?? a.id,
      reason: `Vehicle is currently out on active agreement ${a.agreement_no ?? a.id} overlapping this period`,
    };
  }

  if (!skipCrossModuleChecks) {
    // Active Leasing allocation occurrence or active LeaseContractVehicle
    const leaseConflicts = await withSavepoint<Array<{ ref: string }>>(
      tx,
      'chk_veh_lease_occ',
      () =>
        tx.$queryRawUnsafe<Array<{ ref: string }>>(
          `SELECT COALESCE(lc.contract_no, lao.contract_id) AS ref
             FROM lease_allocation_occurrences lao
             LEFT JOIN lease_contracts_v2 lc ON lc.id = lao.contract_id
            WHERE lao.tenant_id::text = $1
              AND lao.vehicle_id = $2
              AND lao.status = 'ACTIVE'
            UNION ALL
           SELECT COALESCE(lc2.contract_no, lcv.contract_id) AS ref
             FROM lease_contract_vehicles lcv
             JOIN lease_contracts_v2 lc2 ON lc2.id = lcv.contract_id
            WHERE lcv.tenant_id::text = $1
              AND lcv.vehicle_id = $2
              AND COALESCE(lcv.status, 'ACTIVE') = 'ACTIVE'
              AND UPPER(COALESCE(lc2.status, '')) IN ('ACTIVE', 'SIGNED', 'DISPATCHED')
            LIMIT 1`,
          tenantId,
          vehicleId,
        ),
      [],
    );
    if (leaseConflicts.length > 0) {
      return {
        hasConflict: true,
        conflictingRef: leaseConflicts[0].ref,
        reason: `Vehicle is allocated to active lease contract ${leaseConflicts[0].ref}`,
      };
    }

    // Open Workshop WorkOrder (via MaintenanceRequest)
    const workOrderConflicts = await withSavepoint<Array<{ id: string }>>(
      tx,
      'chk_veh_work_order',
      () =>
        tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT wo.id::text AS id
             FROM "WorkOrder" wo
             JOIN maintenance_requests mr ON mr.id::text = wo."requestId"::text
            WHERE wo.tenant_id::text = $1
              AND mr.vehicle_id::text = $2
              AND mr.deleted_at IS NULL
              AND UPPER(COALESCE(wo.status::text, '')) NOT IN ('COMPLETED', 'CLOSED', 'CANCELLED')
            LIMIT 1`,
          tenantId,
          vehicleId,
        ),
      [],
    );
    if (workOrderConflicts.length > 0) {
      return {
        hasConflict: true,
        conflictingRef: workOrderConflicts[0].id,
        reason: `Vehicle has an open workshop work order (${workOrderConflicts[0].id})`,
      };
    }

    // In-transit inter-branch transfer overlapping window
    const transferConflicts = await withSavepoint<Array<{ transfer_no: string }>>(
      tx,
      'chk_veh_transfer',
      () =>
        tx.$queryRawUnsafe<Array<{ transfer_no: string }>>(
          `SELECT transfer_no
             FROM rental_vehicle_transfers
            WHERE tenant_id::text = $1
              AND vehicle_id = $2
              AND status IN ('IN_TRANSIT')
            LIMIT 1`,
          tenantId,
          vehicleId,
        ),
      [],
    );
    if (transferConflicts.length > 0) {
      return {
        hasConflict: true,
        conflictingRef: transferConflicts[0].transfer_no,
        reason: `Vehicle is currently in transit on branch transfer ${transferConflicts[0].transfer_no}`,
      };
    }
  }

  if (checkGrounding) {
    const groundingMap = await withSavepoint(
      tx,
      'chk_veh_grounding',
      () => findGroundingBlocks(tx, tenantId, [vehicleId]),
      new Map(),
    );
    const blocks = groundingMap.get(vehicleId) ?? [];
    if (blocks.length > 0) {
      return {
        hasConflict: true,
        conflictingRef: blocks[0].id,
        reason: `Vehicle is grounded (${blocks[0].source}: ${blocks[0].reason})`,
      };
    }
  }

  return { hasConflict: false };
}

/**
 * Computes the safe post-rental `Vehicle.status` upon return, close, or booking
 * cancellation so RAC never overwrites a `'GROUNDED'` / `'MAINTENANCE'` vehicle
 * back to `'AVAILABLE'` or clears `'RENTED'` while another agreement is active.
 */
export async function computeSafePostRentalVehicleStatus(
  tx: TxClient,
  args: {
    tenantId: string;
    vehicleId: string;
    excludeAgreementId?: string | null;
    excludeBookingId?: string | null;
    preferredStatus?: 'AVAILABLE' | 'MAINTENANCE' | 'GROUNDED';
  },
): Promise<{ status: string; isActive?: boolean }> {
  const {
    tenantId,
    vehicleId,
    excludeAgreementId,
    excludeBookingId,
    preferredStatus = 'AVAILABLE',
  } = args;

  if (preferredStatus === 'GROUNDED') {
    return { status: 'GROUNDED', isActive: false };
  }

  const groundingMap = await withSavepoint(
    tx,
    'post_rental_grounding',
    () => findGroundingBlocks(tx, tenantId, [vehicleId]),
    new Map(),
  );
  if ((groundingMap.get(vehicleId) ?? []).length > 0) {
    return { status: 'GROUNDED', isActive: false };
  }

  if (preferredStatus === 'MAINTENANCE') {
    return { status: 'MAINTENANCE' };
  }

  // Still out on another active rental agreement?
  const otherActiveAgreements = await withSavepoint<Array<{ id: string }>>(
    tx,
    'post_rental_active_agr',
    () =>
      tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text AS id
           FROM rental_agreements
          WHERE tenant_id::text = $1
            AND vehicle_id = $2
            AND deleted_at IS NULL
            AND status = 'ACTIVE'
            ${excludeAgreementId ? 'AND id::text <> $3' : ''}
          LIMIT 1`,
        ...(excludeAgreementId ? [tenantId, vehicleId, excludeAgreementId] : [tenantId, vehicleId]),
      ),
    [],
  );
  if (otherActiveAgreements.length > 0) {
    return { status: 'RENTED' };
  }

  // Open workshop work order?
  const openWo = await withSavepoint<Array<{ id: string }>>(
    tx,
    'post_rental_open_wo',
    () =>
      tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT wo.id::text AS id
           FROM "WorkOrder" wo
           JOIN maintenance_requests mr ON mr.id::text = wo."requestId"::text
          WHERE wo.tenant_id::text = $1
            AND mr.vehicle_id::text = $2
            AND mr.deleted_at IS NULL
            AND UPPER(COALESCE(wo.status::text, '')) NOT IN ('COMPLETED', 'CLOSED', 'CANCELLED')
          LIMIT 1`,
        tenantId,
        vehicleId,
      ),
    [],
  );
  if (openWo.length > 0) {
    return { status: 'MAINTENANCE' };
  }

  // Upcoming confirmed booking within next 24h?
  const upcomingBookings = await withSavepoint<Array<{ id: string }>>(
    tx,
    'post_rental_upcoming_bkg',
    () =>
      tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text AS id
           FROM rental_bookings
          WHERE tenant_id::text = $1
            AND vehicle_id = $2
            AND deleted_at IS NULL
            AND status = 'CONFIRMED'
            AND pickup_date <= (NOW() + INTERVAL '24 hours')
            AND dropoff_date > NOW()
            ${excludeBookingId ? 'AND id::text <> $3' : ''}
          LIMIT 1`,
        ...(excludeBookingId ? [tenantId, vehicleId, excludeBookingId] : [tenantId, vehicleId]),
      ),
    [],
  );
  if (upcomingBookings.length > 0) {
    return { status: 'RESERVED' };
  }

  return { status: 'AVAILABLE', isActive: true };
}

/**
 * Converts Prisma `Vehicle` rows containing `BigInt` (`year`, `currentMileage`,
 * `odometerReading`) or `Decimal` fields into JSON-serializable plain objects.
 */
export function serializeVehicleForJson<T extends Record<string, unknown>>(vehicle: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(vehicle)) {
    if (typeof value === 'bigint') {
      out[key] = Number(value);
    } else if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (
      value !== null &&
      typeof value === 'object' &&
      'toNumber' in value &&
      typeof (value as { toNumber: () => number }).toNumber === 'function'
    ) {
      out[key] = (value as { toNumber: () => number }).toNumber();
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Runs an optional SQL query inside a PostgreSQL SAVEPOINT on an interactive
 * `TxClient` so a failed query (e.g. optional table/column absent in older DBs)
 * rolls back cleanly to the savepoint instead of poisoning the outer transaction
 * with `25P02: current transaction is aborted`.
 */
export async function withSavepoint<T>(
  tx: TxClient,
  name: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  const safeName = `sp_${name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 48)}`;
  const canSavepoint = typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function';
  if (!canSavepoint) {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  }

  await tx.$executeRawUnsafe(`SAVEPOINT ${safeName}`);
  try {
    const res = await fn();
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${safeName}`);
    return res;
  } catch {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${safeName}`).catch(() => {});
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${safeName}`).catch(() => {});
    return fallback;
  }
}
