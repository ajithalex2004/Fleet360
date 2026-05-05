/**
 * Smart Mobility Platform — Hub-and-Spoke Data Access Library
 *
 * This module provides typed access helpers that operational modules
 * should use when reading master data from central hubs.
 *
 * RULE: Operational modules must NEVER write to central hub tables directly.
 *       All vehicle/driver/user creation goes through the hub APIs.
 *       Modules may only update their own FK assignments (e.g. assignedVehicleId).
 */

import { prisma } from '@/lib/prisma';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VehicleSummary {
  id: string;
  make: string | null;
  model: string | null;
  year: bigint | null;
  licensePlate: string | null;
  vin: string | null;
  color: string | null;
  fuelType: string | null;
  vehicleUsage: string | null;
  vehicleGroup: string | null;
  vehicleClass: string | null;
  seatingCapacity: number | null;
  status: string | null;
  currentMileage: bigint | null;
  registrationExpiry: Date | null;
  insuranceExpiry: Date | null;
  mulkiyaExpiry: Date | null;
  assignedDriverId: string | null;
  garageId: string | null;
}

export interface DriverSummary {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  contactNumber: string | null;
  licenseNumber: string | null;
  licenseExpiry: Date | null;
  licenseType: string | null;
  emiratesId: string | null;
  emiratesIdExpiry: Date | null;
  passportNumber: string | null;
  passportExpiry: Date | null;
  visaExpiry: Date | null;
  status: string | null;
  driverType: string | null;
  nationality: string | null;
  assignedVehicleId: string | null;
  garageId: string | null;
}

export interface UserSummary {
  id: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  department: string | null;
  position: string | null;
  mobileNumber: string | null;
  isActive: boolean;
  moduleAccess: Record<string, boolean> | null;
}

// ── FLEET HUB — Vehicle Registry ─────────────────────────────────────────────

/**
 * Fetch a single vehicle from the Fleet Hub.
 * Use this in all operational modules instead of querying vehicles table directly.
 */
export async function getVehicle(id: string): Promise<VehicleSummary | null> {
  const v = await prisma.vehicle.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true, make: true, model: true, year: true,
      licensePlate: true, vin: true, color: true, fuelType: true,
      vehicleUsage: true, vehicleGroup: true, vehicleClass: true,
      seatingCapacity: true, status: true, currentMileage: true,
      registrationExpiry: true, insuranceExpiry: true, mulkiyaExpiry: true,
      assignedDriverId: true, garageId: true,
    },
  });
  return v as VehicleSummary | null;
}

/**
 * Fetch multiple vehicles from the Fleet Hub with optional filters.
 */
export async function getVehicles(opts?: {
  status?: string;
  vehicleUsage?: string;
  vehicleGroup?: string;
  ids?: string[];
}): Promise<VehicleSummary[]> {
  const where: Record<string, unknown> = { deletedAt: null };
  if (opts?.status)        where.status        = opts.status;
  if (opts?.vehicleUsage)  where.vehicleUsage  = opts.vehicleUsage;
  if (opts?.vehicleGroup)  where.vehicleGroup  = opts.vehicleGroup;
  if (opts?.ids?.length)   where.id            = { in: opts.ids };

  const rows = await prisma.vehicle.findMany({
    where,
    select: {
      id: true, make: true, model: true, year: true,
      licensePlate: true, vin: true, color: true, fuelType: true,
      vehicleUsage: true, vehicleGroup: true, vehicleClass: true,
      seatingCapacity: true, status: true, currentMileage: true,
      registrationExpiry: true, insuranceExpiry: true, mulkiyaExpiry: true,
      assignedDriverId: true, garageId: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows as VehicleSummary[];
}

/**
 * Update only the operational assignment fields on a vehicle.
 * Modules may call this to assign a driver or garage — nothing else.
 */
export async function updateVehicleAssignment(
  id: string,
  assignment: { assignedDriverId?: string | null; garageId?: string | null },
) {
  return prisma.vehicle.update({
    where: { id },
    data: assignment,
  });
}

/**
 * Update only the vehicle status and mileage (operational updates from modules).
 */
export async function updateVehicleStatus(
  id: string,
  data: { status?: string; currentMileage?: bigint; fuelLevel?: number },
) {
  return prisma.vehicle.update({ where: { id }, data });
}

// ── DRIVER HUB ────────────────────────────────────────────────────────────────

/**
 * Fetch a single driver from the Driver Hub.
 */
export async function getDriver(id: string): Promise<DriverSummary | null> {
  const d = await prisma.driver.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true, name: true, firstName: true, lastName: true,
      email: true, contactNumber: true, licenseNumber: true,
      licenseExpiry: true, licenseType: true, emiratesId: true,
      emiratesIdExpiry: true, passportNumber: true, passportExpiry: true,
      visaExpiry: true, status: true, driverType: true, nationality: true,
      assignedVehicleId: true, garageId: true,
    },
  });
  return d as DriverSummary | null;
}

/**
 * Get expiring compliance items for a driver within N days.
 */
export async function getDriverComplianceStatus(id: string, withinDays = 30) {
  const d = await getDriver(id);
  if (!d) return null;

  const now = new Date();
  const threshold = new Date(now.getTime() + withinDays * 86400000);

  const check = (dt: Date | null) => {
    if (!dt) return 'missing';
    if (dt < now) return 'expired';
    if (dt < threshold) return 'expiring_soon';
    return 'valid';
  };

  return {
    driverId: id,
    licenseStatus:    check(d.licenseExpiry),
    emiratesIdStatus: check(d.emiratesIdExpiry),
    passportStatus:   check(d.passportExpiry),
    visaStatus:       check(d.visaExpiry),
    hasIssues: ['expired', 'expiring_soon', 'missing'].some(s =>
      [check(d.licenseExpiry), check(d.emiratesIdExpiry), check(d.passportExpiry), check(d.visaExpiry)].includes(s)
    ),
  };
}

/**
 * Update driver vehicle assignment (called by Fleet/Booking when assigning).
 */
export async function updateDriverAssignment(
  id: string,
  assignment: { assignedVehicleId?: string | null },
) {
  return prisma.driver.update({ where: { id }, data: assignment });
}

// ── ADMIN HUB — User & RBAC ───────────────────────────────────────────────────

/**
 * Fetch a user from the Admin Hub.
 */
export async function getUser(id: string): Promise<UserSummary | null> {
  const u = await prisma.user.findFirst({
    where: { id },
    select: {
      id: true, username: true, email: true,
      firstName: true, lastName: true, department: true,
      position: true, mobileNumber: true, isActive: true, moduleAccess: true,
    },
  });
  if (!u) return null;
  return {
    ...u,
    moduleAccess: u.moduleAccess as Record<string, boolean> | null,
  };
}

/**
 * Check if a user has access to a specific module.
 */
export async function checkModuleAccess(userId: string, module: string): Promise<boolean> {
  const u = await prisma.user.findFirst({ where: { id: userId }, select: { isActive: true, moduleAccess: true } });
  if (!u || !u.isActive) return false;
  const access = u.moduleAccess as Record<string, boolean> | null;
  if (!access) return true; // No restriction = full access (backward compat)
  return access[module] === true;
}

// ── FINANCE AGGREGATION HELPERS ───────────────────────────────────────────────

/**
 * Get aggregated financial totals across all modules for a date range.
 * Finance Hub is READ-ONLY — it does not own any transaction tables.
 */
export async function getFinanceSummary(opts?: { from?: Date; to?: Date }) {
  const dateFilter = {
    ...(opts?.from ? { gte: opts.from } : {}),
    ...(opts?.to   ? { lte: opts.to }   : {}),
  };
  const hasDateFilter = opts?.from || opts?.to;

  const [
    maintenanceCosts,
    rentalRevenue,
    leaseRevenue,
    invoiceRevenue,
  ] = await Promise.all([
    // Maintenance module — sum of approved quotation totals
    prisma.$queryRawUnsafe<Array<{ total: number; count: bigint }>>(
      hasDateFilter
        ? `SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count
           FROM quotations WHERE status = 'APPROVED' AND deleted_at IS NULL
           AND created_at >= $1 AND created_at <= $2`
        : `SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count
           FROM quotations WHERE status = 'APPROVED' AND deleted_at IS NULL`,
      ...(hasDateFilter ? [opts?.from ?? new Date(0), opts?.to ?? new Date()] : []),
    ),

    // RAC module — sum of rental invoices
    prisma.$queryRawUnsafe<Array<{ total: number; count: bigint }>>(
      hasDateFilter
        ? `SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count
           FROM rental_invoices WHERE deleted_at IS NULL
           AND created_at >= $1 AND created_at <= $2`
        : `SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count
           FROM rental_invoices WHERE deleted_at IS NULL`,
      ...(hasDateFilter ? [opts?.from ?? new Date(0), opts?.to ?? new Date()] : []),
    ),

    // Leasing module — sum of lease invoices
    prisma.$queryRawUnsafe<Array<{ total: number; count: bigint }>>(
      hasDateFilter
        ? `SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count
           FROM lease_invoices WHERE deleted_at IS NULL
           AND created_at >= $1 AND created_at <= $2`
        : `SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count
           FROM lease_invoices WHERE deleted_at IS NULL`,
      ...(hasDateFilter ? [opts?.from ?? new Date(0), opts?.to ?? new Date()] : []),
    ),

    // General invoices
    prisma.$queryRawUnsafe<Array<{ total: number; count: bigint }>>(
      hasDateFilter
        ? `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
           FROM invoices WHERE deleted_at IS NULL
           AND created_at >= $1 AND created_at <= $2`
        : `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
           FROM invoices WHERE deleted_at IS NULL`,
      ...(hasDateFilter ? [opts?.from ?? new Date(0), opts?.to ?? new Date()] : []),
    ),
  ]);

  const toNum = (r: Array<{ total: number; count: bigint }>) => ({
    total: Number(r[0]?.total ?? 0),
    count: Number(r[0]?.count ?? 0),
  });

  const mc = toNum(maintenanceCosts);
  const rr = toNum(rentalRevenue);
  const lr = toNum(leaseRevenue);
  const ir = toNum(invoiceRevenue);

  const totalRevenue = rr.total + lr.total + ir.total;
  const totalCosts   = mc.total;

  return {
    period: { from: opts?.from ?? null, to: opts?.to ?? null },
    modules: {
      maintenance: { costs:   mc.total, invoiceCount: mc.count },
      rental:      { revenue: rr.total, invoiceCount: rr.count },
      leasing:     { revenue: lr.total, invoiceCount: lr.count },
      general:     { revenue: ir.total, invoiceCount: ir.count },
    },
    summary: {
      totalRevenue,
      totalCosts,
      grossProfit: totalRevenue - totalCosts,
      grossMarginPct: totalRevenue > 0
        ? Math.round(((totalRevenue - totalCosts) / totalRevenue) * 1000) / 10
        : 0,
    },
  };
}
