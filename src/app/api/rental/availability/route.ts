import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/rental/availability?startDate=...&endDate=...&category=...
// Returns vehicles NOT booked in the requested date range
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const category = searchParams.get('category');

    // Find bookings that overlap the requested period
    const conflictingBookings = await prisma.rentalBooking.findMany({
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
    const availableVehicles = await prisma.vehicle.findMany({
      where: {
        deletedAt: null,
        status: { in: ['AVAILABLE', 'ACTIVE'] },
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
  } catch (error) {
    console.error('Error fetching availability:', error);
    return NextResponse.json({ error: 'Failed to fetch availability' }, { status: 500 });
  }
}
