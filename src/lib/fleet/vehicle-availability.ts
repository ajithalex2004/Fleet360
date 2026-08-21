/**
 * Shared vehicle assignability for Bus Ops / schedules / dispatch.
 *
 * Blocks assignment when fleet marks the vehicle as in maintenance or
 * otherwise out of service. Aligns with FleetMaintenanceConsumer which
 * sets status / operational_status back to AVAILABLE on WO complete.
 */

import { prisma } from '@/lib/prisma';

/** Statuses that must not be assigned to trips or templates. */
export const VEHICLE_UNASSIGNABLE_STATUSES = new Set([
  'MAINTENANCE',
  'IN_MAINTENANCE',
  'UNDER_REPAIR',
  'OUT_OF_SERVICE',
  'INACTIVE',
  'SOLD',
  'DECOMMISSIONED',
]);

export type VehicleAssignability = {
  ok: true;
  vehicleId: string;
  status: string | null;
  licensePlate: string | null;
} | {
  ok: false;
  error: string;
  vehicleId: string;
  status: string | null;
  licensePlate: string | null;
};

function normalizeStatus(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase();
}

/**
 * Prisma `Vehicle.status` is the primary field in schema.
 * Some deployments also have `operational_status` (raw SQL); we check both.
 */
export async function checkVehicleAssignable(
  vehicleId: string,
  opts?: { tenantId?: string | null },
): Promise<VehicleAssignability> {
  const tenantId = opts?.tenantId ?? undefined;

  const vehicle = await prisma.vehicle.findFirst({
    where: {
      id: vehicleId,
      deletedAt: null,
      ...(tenantId ? { tenantId } : {}),
    },
    select: {
      id: true,
      status: true,
      licensePlate: true,
      tenantId: true,
    },
  });

  if (!vehicle) {
    return {
      ok: false,
      vehicleId,
      status: null,
      licensePlate: null,
      error: 'Vehicle not found',
    };
  }

  let status = normalizeStatus(vehicle.status);

  // Optional operational_status column (fleet consumer uses it when present)
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ operational_status: string | null }>>(
      `SELECT operational_status FROM vehicles WHERE id = $1 LIMIT 1`,
      vehicleId,
    );
    const op = normalizeStatus(rows?.[0]?.operational_status);
    if (op) status = op;
  } catch {
    /* column may not exist — use Vehicle.status only */
  }

  if (VEHICLE_UNASSIGNABLE_STATUSES.has(status)) {
    const plate = vehicle.licensePlate ?? vehicleId.slice(0, 8);
    return {
      ok: false,
      vehicleId,
      status,
      licensePlate: vehicle.licensePlate,
      error: `Vehicle ${plate} is ${status.replace(/_/g, ' ')} and cannot be assigned to trips`,
    };
  }

  return {
    ok: true,
    vehicleId,
    status: status || vehicle.status,
    licensePlate: vehicle.licensePlate,
  };
}

/** Throws nothing — returns Next-friendly result for route handlers. */
export async function assertVehicleAssignableOrError(
  vehicleId: string | null | undefined,
  tenantId?: string | null,
): Promise<{ error: string } | null> {
  if (!vehicleId) return null; // unassigned trip is allowed
  const result = await checkVehicleAssignable(vehicleId, { tenantId });
  if (result.ok) return null;
  return { error: result.error };
}

/** Prisma where-fragment: vehicles safe to show in assignment dropdowns. */
export function vehicleAssignableWhere() {
  return {
    deletedAt: null,
    OR: [
      { status: null },
      {
        status: {
          notIn: Array.from(VEHICLE_UNASSIGNABLE_STATUSES),
          mode: 'insensitive' as const,
        },
      },
    ],
  };
}
