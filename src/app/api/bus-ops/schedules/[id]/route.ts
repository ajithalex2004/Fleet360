import { NextRequest, NextResponse } from 'next/server';
import { assertVehicleAssignableOrError } from '@/lib/fleet/vehicle-availability';
import { prisma } from '@/lib/prisma';
import { validateResourceAssignment } from '@/lib/bus-ops/validate-assignment';
import { isValidationEnabled, withAssignmentLocks } from '@/lib/bus-ops/assignment-txn';

/**
 * Fields whose change requires re-running resource validation. Missing
 * any of them from the trigger list would silently allow unsafe
 * re-assignments (e.g. "just change departureTime by 2 hours" landing
 * on top of another trip on the same vehicle).
 *
 * The validator runs against the *effective merged schedule* — existing
 * row + patch — not just the delta.
 */
const ASSIGNMENT_AFFECTING_FIELDS = [
  'vehicleId',
  'driverId',
  'departureTime',
  'arrivalTime',
  'routeId',
  'confirmedCount',
  'capacity',
] as const;

function touchesAssignment(body: Record<string, unknown>): boolean {
  return ASSIGNMENT_AFFECTING_FIELDS.some(f => Object.prototype.hasOwnProperty.call(body, f));
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const schedule = await prisma.tripSchedule.findFirst({
      where: { id: params.id, tenantId, deletedAt: null },
      include: {
        route: { include: { stops: { orderBy: { sequence: 'asc' } } } },
        passengers: { orderBy: { createdAt: 'asc' } },
        tripLogs: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(schedule);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    // Load full existing row so we can build an effective-merged
    // schedule for validation. Any assignment-affecting field NOT in
    // the patch retains its committed value.
    const existing = await prisma.tripSchedule.findFirst({
      where: { id: params.id, tenantId, deletedAt: null },
      select: {
        id: true, vehicleId: true, driverId: true,
        departureTime: true, arrivalTime: true, routeId: true,
        confirmedCount: true, capacity: true,
      },
    });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json();
    if (body.vehicleId) {
      const vehicleBlock = await assertVehicleAssignableOrError(body.vehicleId, tenantId);
      if (vehicleBlock) return NextResponse.json(vehicleBlock, { status: 409 });
    }
    const { route, passengers, tripLogs, ...data } = body;

    // Only revalidate when an assignment-affecting field was actually
    // changed. Pure status flips / notes edits skip the check to avoid
    // unnecessary lock traffic.
    if (isValidationEnabled() && touchesAssignment(body)) {
      const merged = {
        vehicleId:      Object.prototype.hasOwnProperty.call(body, 'vehicleId')      ? (body.vehicleId as string | null)     : existing.vehicleId,
        driverId:       Object.prototype.hasOwnProperty.call(body, 'driverId')       ? (body.driverId  as string | null)     : existing.driverId,
        departureTime:  Object.prototype.hasOwnProperty.call(body, 'departureTime')  ? new Date(body.departureTime as string) : existing.departureTime,
        arrivalTime:    Object.prototype.hasOwnProperty.call(body, 'arrivalTime')    ? (body.arrivalTime ? new Date(body.arrivalTime as string) : null) : existing.arrivalTime,
        routeId:        Object.prototype.hasOwnProperty.call(body, 'routeId')        ? (body.routeId as string | null)       : existing.routeId,
        confirmedCount: Object.prototype.hasOwnProperty.call(body, 'confirmedCount') ? (body.confirmedCount as number)       : (existing.confirmedCount ?? undefined),
      };

      const txResult = await withAssignmentLocks(
        { tenantId, vehicleId: merged.vehicleId, driverId: merged.driverId },
        async (tx) => {
          const v = await validateResourceAssignment(
            {
              tenantId,
              scheduleId:     params.id,   // self-exclusion in overlap query
              vehicleId:      merged.vehicleId,
              driverId:       merged.driverId,
              departureTime:  merged.departureTime,
              arrivalTime:    merged.arrivalTime,
              routeId:        merged.routeId,
              confirmedCount: merged.confirmedCount,
              timezone:       body.timezone as string | undefined,
            },
            tx,
          );
          if (v.verdict === 'BLOCK') {
            return { verdict: 'BLOCK' as const, validation: v };
          }
          const s = await tx.tripSchedule.update({
            where: { id: params.id },
            data:  { ...data, updatedAt: new Date() },
            include: { route: true },
          });
          return { verdict: v.verdict, validation: v, schedule: s };
        },
      );

      if (txResult.verdict === 'BLOCK') {
        return NextResponse.json(
          { error: 'Assignment blocked by resource validation', validation: txResult.validation },
          { status: 409 },
        );
      }
      return NextResponse.json({ ...txResult.schedule, validation: txResult.validation });
    }

    // Non-assignment PATCH or feature disabled — original single-write
    // path, no lock, no validation.
    const schedule = await prisma.tripSchedule.update({
      where: { id: params.id },
      data:  { ...data, updatedAt: new Date() },
      include: { route: true },
    });
    return NextResponse.json(schedule);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const existing = await prisma.tripSchedule.findFirst({ where: { id: params.id, tenantId, deletedAt: null }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await prisma.tripSchedule.update({
      where: { id: params.id },
      data: { deletedAt: new Date(), status: 'CANCELLED' },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
