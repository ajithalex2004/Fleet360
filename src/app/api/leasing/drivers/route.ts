/**
 * GET /api/leasing/drivers
 *
 * List drivers in the leasing context. By default returns only drivers who
 * currently have an ACTIVE LeaseDriverAllocation. Pass ?all=1 to include all
 * non-deleted Drivers (so the per-contract picker can pick from the wider
 * pool, not only those already allocated).
 *
 * Each driver is annotated with allocation stats (active/total) and a
 * licence-expiry status flag for the dashboard.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const all = req.nextUrl.searchParams.get('all') === '1';
  const now = new Date();

  // Find driver IDs with active leasing allocations.
  const activeAllocations = await prisma.leaseDriverAllocation.findMany({
    where: { status: 'ACTIVE' },
    select: {
      driverId: true,
      contractId: true,
      contractVehicleId: true,
      allocatedAt: true,
    },
  });
  const activeByDriver = new Map<string, typeof activeAllocations>();
  for (const a of activeAllocations) {
    const arr = activeByDriver.get(a.driverId) ?? [];
    arr.push(a);
    activeByDriver.set(a.driverId, arr);
  }

  const driverIds = all ? undefined : [...new Set(activeAllocations.map(a => a.driverId))];
  if (!all && (!driverIds || driverIds.length === 0)) {
    return NextResponse.json([]);
  }

  const drivers = await prisma.driver.findMany({
    where: {
      deletedAt: null,
      ...(driverIds ? { id: { in: driverIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      email: true,
      contactNumber: true,
      nationality: true,
      licenseNumber: true,
      licenseExpiry: true,
      licenseType: true,
      emiratesId: true,
      emiratesIdExpiry: true,
      visaExpiry: true,
      status: true,
      driverType: true,
    },
    orderBy: { name: 'asc' },
  });

  // Total allocation counts per driver (for the list view).
  const totalGroups = await prisma.leaseDriverAllocation.groupBy({
    by: ['driverId'],
    where: { driverId: { in: drivers.map(d => d.id) } },
    _count: { _all: true },
  });
  const totalByDriver = new Map(totalGroups.map(g => [g.driverId, g._count._all]));

  const flagExpiry = (d: Date | null | undefined) => {
    if (!d) return null;
    const days = Math.ceil((new Date(d).getTime() - now.getTime()) / 86400000);
    if (days < 0) return 'EXPIRED';
    if (days <= 30) return 'EXPIRING_SOON';
    return 'OK';
  };

  const out = drivers.map(d => ({
    ...d,
    activeAllocations: activeByDriver.get(d.id)?.length ?? 0,
    totalAllocations: totalByDriver.get(d.id) ?? 0,
    licenseExpiryStatus: flagExpiry(d.licenseExpiry),
    emiratesIdExpiryStatus: flagExpiry(d.emiratesIdExpiry),
    visaExpiryStatus: flagExpiry(d.visaExpiry),
  }));

  return NextResponse.json(out);
}
