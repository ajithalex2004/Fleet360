import { prisma } from '@/lib/prisma';

export type FleetVehicleForLease = {
  id: string;
  vehicle_code: string | null;
  license_plate: string | null;
  plate_number: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  type: string | null;
  vehicle_type_name: string | null;
  vehicle_class: string | null;
  vehicle_group: string | null;
  branch_id: string | null;
  branch_name: string | null;
  status: string | null;
  vin: string | null;
  current_mileage: number | null;
  odometer_reading: number | null;
  tenant_id: string | null;
};

export type LeaseContractVehicleLike = {
  id: string;
  vehicleId?: string | null;
  vehicleType?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  licensePlate?: string | null;
  vin?: string | null;
  driverId?: string | null;
  monthlyRate?: unknown;
  mileageStart?: number | null;
  status?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value?: string | null) {
  return Boolean(value && UUID_RE.test(value));
}

export function normalizeVehicleStatus(status?: string | null) {
  return (status || 'AVAILABLE').trim().toUpperCase();
}

export function statusForLeaseAssignment(contractStatus?: string | null) {
  return normalizeVehicleStatus(contractStatus) === 'ACTIVE' ? 'RENTED' : 'RESERVED';
}

export function fleetVehicleDisplay(vehicle: Pick<FleetVehicleForLease, 'vehicle_code' | 'license_plate' | 'plate_number' | 'make' | 'model' | 'year'>) {
  const plate = vehicle.license_plate || vehicle.plate_number || vehicle.vehicle_code || 'Unregistered';
  const model = [vehicle.make, vehicle.model, vehicle.year ? String(vehicle.year) : null].filter(Boolean).join(' ');
  return model ? `${plate} - ${model}` : plate;
}

export async function loadFleetVehicleForLease(vehicleId: string, tenantId: string) {
  const rows = await prisma.$queryRawUnsafe<FleetVehicleForLease[]>(
    `SELECT v.id::text AS id,
            v.vehicle_code,
            v.license_plate,
            v.plate_number,
            v.make,
            v.model,
            v.year::int AS year,
            v.type,
            vt.name AS vehicle_type_name,
            v.vehicle_class,
            v.vehicle_group,
            v.branch_id::text AS branch_id,
            COALESCE(tb.branch_name, v.branch_name) AS branch_name,
            v.status,
            v.vin,
            v.current_mileage::bigint AS current_mileage,
            v.odometer_reading::bigint AS odometer_reading,
            tb.tenant_id::text AS tenant_id
       FROM vehicles v
       LEFT JOIN vehicle_types vt ON vt.id::text = v.vehicle_type_id
       LEFT JOIN tenant_branches tb ON tb.id::text = v.branch_id::text AND tb.deleted_at IS NULL
      WHERE v.id::text = $1
        AND v.deleted_at IS NULL
        AND (tb.tenant_id IS NULL OR tb.tenant_id::text = $2)
      LIMIT 1`,
    vehicleId,
    tenantId,
  );
  return rows[0] ?? null;
}

export function assertFleetVehicleAssignable(vehicle: FleetVehicleForLease | null) {
  if (!vehicle) return 'Vehicle was not found in Fleet Master for this tenant.';
  const status = normalizeVehicleStatus(vehicle.status);
  if (status !== 'AVAILABLE') {
    return `Vehicle ${fleetVehicleDisplay(vehicle)} is ${status}. Only AVAILABLE vehicles can be assigned.`;
  }
  return null;
}

export function assertOpeningBranchMatch(vehicle: FleetVehicleForLease, openingBranchId?: string | null) {
  if (!openingBranchId || !vehicle.branch_id) return null;
  return vehicle.branch_id === openingBranchId
    ? null
    : `Vehicle belongs to ${vehicle.branch_name || vehicle.branch_id}, not the agreement opening branch.`;
}

export function buildLeaseVehicleDataFromFleet(
  vehicle: FleetVehicleForLease,
  contractId: string,
  monthlyRate?: number | string | null,
) {
  const lastMileage = vehicle.odometer_reading ?? vehicle.current_mileage ?? null;
  return {
    contractId,
    vehicleId: vehicle.id,
    vehicleType: vehicle.vehicle_type_name || vehicle.type || vehicle.vehicle_class || vehicle.vehicle_group || 'Vehicle',
    make: vehicle.make || '',
    model: vehicle.model || '',
    year: vehicle.year ?? new Date().getFullYear(),
    licensePlate: vehicle.license_plate || vehicle.plate_number || '',
    vin: vehicle.vin || null,
    monthlyRate: monthlyRate === undefined || monthlyRate === null || monthlyRate === ''
      ? null
      : Number(monthlyRate),
    mileageStart: lastMileage === null ? null : Number(lastMileage),
    status: 'ACTIVE',
  };
}

export function mapLeaseVehicleForClient(vehicle: LeaseContractVehicleLike, fleet?: FleetVehicleForLease | null) {
  return {
    id: vehicle.id,
    vehicleId: vehicle.vehicleId ?? fleet?.id ?? null,
    type: vehicle.vehicleType ?? fleet?.vehicle_type_name ?? fleet?.type ?? '',
    make: vehicle.make ?? fleet?.make ?? '',
    model: vehicle.model ?? fleet?.model ?? '',
    year: vehicle.year ?? fleet?.year ?? null,
    licensePlate: vehicle.licensePlate ?? fleet?.license_plate ?? fleet?.plate_number ?? '',
    driver: vehicle.driverId ?? '',
    monthlyRate: vehicle.monthlyRate ?? 0,
    status: vehicle.status ?? 'ACTIVE',
    branchId: fleet?.branch_id ?? null,
    branchName: fleet?.branch_name ?? null,
    fleetStatus: fleet?.status ?? null,
    lastOdometer: fleet?.odometer_reading ?? fleet?.current_mileage ?? null,
  };
}

export async function markFleetVehicleLeaseStatus(
  vehicleId: string,
  status: 'AVAILABLE' | 'RESERVED' | 'RENTED',
  options: { branchId?: string | null; mileage?: number | null } = {},
) {
  if (options.branchId && isUuid(options.branchId)) {
    await prisma.$executeRawUnsafe(
      `UPDATE vehicles
          SET status = $2,
              branch_id = $3::uuid,
              branch_name = COALESCE((SELECT branch_name FROM tenant_branches WHERE id = $3::uuid), branch_name),
              odometer_reading = COALESCE($4::bigint, odometer_reading),
              updated_at = NOW()
        WHERE id::text = $1
          AND deleted_at IS NULL`,
      vehicleId,
      status,
      options.branchId,
      options.mileage ?? null,
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    `UPDATE vehicles
        SET status = $2,
            odometer_reading = COALESCE($3::bigint, odometer_reading),
            updated_at = NOW()
      WHERE id::text = $1
        AND deleted_at IS NULL`,
    vehicleId,
    status,
    options.mileage ?? null,
  );
}

export async function releaseLeaseContractVehicles(
  contractId: string,
  options: { branchId?: string | null; mileage?: number | null } = {},
) {
  const rows = await prisma.leaseContractVehicle.findMany({
    where: { contractId, vehicleId: { not: null }, status: { not: 'RETURNED' } },
    select: { id: true, vehicleId: true },
  });

  await prisma.leaseContractVehicle.updateMany({
    where: { contractId, status: { not: 'RETURNED' } },
    data: { status: 'RETURNED' },
  });

  for (const row of rows) {
    if (row.vehicleId) {
      await markFleetVehicleLeaseStatus(row.vehicleId, 'AVAILABLE', {
        branchId: options.branchId,
        mileage: options.mileage,
      });
    }
  }

  return rows.map((row) => row.vehicleId).filter(Boolean) as string[];
}

export async function setContractVehiclesAssignedStatus(contractId: string, contractStatus?: string | null) {
  const fleetStatus = statusForLeaseAssignment(contractStatus);
  const rows = await prisma.leaseContractVehicle.findMany({
    where: { contractId, vehicleId: { not: null }, status: 'ACTIVE' },
    select: { vehicleId: true },
  });
  for (const row of rows) {
    if (row.vehicleId) await markFleetVehicleLeaseStatus(row.vehicleId, fleetStatus);
  }
  return rows.map((row) => row.vehicleId).filter(Boolean) as string[];
}
