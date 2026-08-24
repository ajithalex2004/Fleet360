import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';

// GET /api/rental/availability?startDate=...&endDate=...&category=...
// Returns vehicles NOT booked in the requested date range
export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const { searchParams } = new URL(req.url);
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        const category = searchParams.get('category');

        // Find bookings that overlap the requested period
        const conflictingBookings = await tx.rentalBooking.findMany({
          where: {
            deletedAt: null,
            status: { in: ['CONFIRMED', 'ACTIVE'] },
            vehicleId: { not: null },
            ...(startDate && endDate ? {
              AND: [
                { pickupDate: { lte: new Date(endDate) } },
                { dropoffDate: { gte: new Date(startDate) } },
              ],
            } : {}),
          },
          select: { vehicleId: true },
        });
        const bookedVehicleIds = conflictingBookings.map(b => b.vehicleId!);

        // Find all active vehicles NOT in the booked list
        const availableVehicles = await tx.vehicle.findMany({
          where: {
            isActive: true,
            id: { notIn: bookedVehicleIds },
            ...(category ? { category } : {}),
          },
          orderBy: { make: 'asc' },
        });

        return NextResponse.json({
          available: availableVehicles.length,
          vehicles: availableVehicles,
          booked: bookedVehicleIds.length,
        });
        } catch (e) {
        console.error('Error fetching availability:', e);
        return NextResponse.json({ error: 'Failed to fetch availability' }, { status: 500 });
      }
  });
}

