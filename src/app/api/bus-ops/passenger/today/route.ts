/**
 * GET /api/bus-ops/passenger/today?employeeId=X
 *
 * Returns today's trips for one staff member: their staff record, the
 * passenger row(s) on today's TripSchedules, vehicle beacon UUID for BLE
 * proximity check, and any RFID tag they hold (so the PWA can echo it back
 * for confirmation).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const employeeId = req.nextUrl.searchParams.get('employeeId');
  if (!employeeId) {
    return NextResponse.json({ error: 'employeeId is required' }, { status: 400 });
  }

  const staff = await prisma.staffMember.findUnique({
    where: { employeeId },
    include: {
      transportRequests: {
        where: { tripDate: { gte: startOfToday() } },
        orderBy: { tripDate: 'asc' },
      },
    },
  });
  if (!staff) return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });

  // Today's window — TripPassenger does not store its own date, so we filter
  // by the related TripSchedule.departureTime.
  const start = startOfToday();
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const passengers = await prisma.tripPassenger.findMany({
    where: {
      staffMemberId: staff.id,
      trip: { departureTime: { gte: start, lt: end }, deletedAt: null },
    },
    include: {
      trip: { include: { route: { include: { stops: true } } } },
    },
    orderBy: { id: 'asc' },
  });

  // For each trip's vehicle, lazy-fetch the beacon (so PWA knows which BLE
  // UUID to look for).
  const vehicleIds = [...new Set(passengers.map(p => p.trip.vehicleId).filter(Boolean) as string[])];
  const beacons = vehicleIds.length > 0
    ? await prisma.vehicleBeacon.findMany({
        where: { vehicleId: { in: vehicleIds }, isActive: true },
        select: { vehicleId: true, bleUuid: true },
      })
    : [];
  const beaconByVehicle = new Map(beacons.map(b => [b.vehicleId, b.bleUuid]));

  const rfidTag = await prisma.staffRfidTag.findUnique({
    where: { staffMemberId: staff.id },
    select: { tagUid: true, isActive: true },
  });

  const trips = passengers.map(p => ({
    passengerId: p.id,
    status: p.status ?? 'CONFIRMED',
    boardedAt: p.boardedAt,
    boardingStop: p.boardingStopName ?? null,
    alightingStop: p.alightingStopName ?? null,
    trip: {
      id: p.trip.id,
      tripNumber: p.trip.tripNumber,
      departureTime: p.trip.departureTime,
      arrivalTime: p.trip.arrivalTime,
      shiftType: p.trip.shiftType,
      direction: p.trip.direction,
      status: p.trip.status,
      vehicleId: p.trip.vehicleId,
      route: {
        name: p.trip.route?.name,
        origin: p.trip.route?.origin,
        destination: p.trip.route?.destination,
        stops: (p.trip.route?.stops ?? []).map(s => ({ id: s.id, name: (s as { name?: string }).name ?? null })),
      },
      bleBeaconUuid: p.trip.vehicleId ? (beaconByVehicle.get(p.trip.vehicleId) ?? null) : null,
    },
  }));

  return NextResponse.json({
    staff: {
      id: staff.id,
      name: staff.name,
      employeeId: staff.employeeId,
      department: staff.department,
      designation: staff.designation,
      shiftType: staff.shiftType,
      defaultRouteId: staff.defaultRouteId,
      defaultStopId: staff.defaultStopId,
      defaultStopName: staff.defaultStopName,
    },
    trips,
    rfidTag: rfidTag && rfidTag.isActive !== false
      ? { tagUid: rfidTag.tagUid }
      : null,
    transportRequests: staff.transportRequests,
  });
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
