import { requireBusOpsRequest } from '@/lib/bus-ops/access';
export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { validateResourceAssignment } from '@/lib/bus-ops/validate-assignment';
import { isValidationEnabled, withAssignmentLocks } from '@/lib/bus-ops/assignment-txn';
import { logAudit } from '@/lib/audit';
import { getEventBus } from '@/events/event-bus';
import { VEHICLE_CHANGED, DRIVER_CHANGED } from '@/events/contracts/trip.events';
import type { Prisma } from '@prisma/client';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
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

async function publishResourceChanges(
  tx: Prisma.TransactionClient,
  tenantId: string,
  actor: string | null,
  prior: { id: string; tripNumber: string | null; vehicleId: string | null; driverId: string | null },
  next: { vehicleId: string | null; driverId: string | null },
) {
  const changedAt = new Date().toISOString();
  if (prior.vehicleId !== next.vehicleId) {
    await getEventBus().publish({ eventType: VEHICLE_CHANGED, aggregateType: 'TripSchedule', aggregateId: prior.id,
      sourceModule: 'bus-ops', tenantId, actor,
      payload: { scheduleId: prior.id, tripNumber: prior.tripNumber, previousVehicleId: prior.vehicleId,
        newVehicleId: next.vehicleId, driverId: next.driverId, reason: null, changedAt },
    }, tx);
  }
  if (prior.driverId !== next.driverId) {
    await getEventBus().publish({ eventType: DRIVER_CHANGED, aggregateType: 'TripSchedule', aggregateId: prior.id,
      sourceModule: 'bus-ops', tenantId, actor,
      payload: { scheduleId: prior.id, tripNumber: prior.tripNumber, vehicleId: next.vehicleId,
        previousDriverId: prior.driverId, newDriverId: next.driverId, reason: null, changedAt },
    }, tx);
  }
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const policyError = await requireBusOpsRequest(req);
  if (policyError) return policyError;
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        const schedule = await tx.tripSchedule.findFirst({
          where: { id: params.id, tenantId, deletedAt: null },
          include: {
            route: { include: { stops: { orderBy: { sequence: 'asc' } } } },
            passengers: { orderBy: { createdAt: 'asc' } },
            tripLogs: { orderBy: { createdAt: 'desc' } },
          },
        });
        if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json(schedule);
      } catch (e) {
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
      }
  });
}


export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const policyError = await requireBusOpsRequest(req);
  if (policyError) return policyError;
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  try {
    return await withTenantRls(prisma, tenantId, async (tx) => {

      try {
        // Load full existing row so we can build an effective-merged
        // schedule for validation. Any assignment-affecting field NOT in
        // the patch retains its committed value.
        await tx.$queryRawUnsafe('SELECT id FROM trip_schedules WHERE id::text = $1 AND tenant_id = $2 FOR UPDATE', params.id, tenantId);
        const existing = await tx.tripSchedule.findFirst({
          where: { id: params.id, tenantId, deletedAt: null },
          select: {
            id: true, tripNumber: true, vehicleId: true, driverId: true,
            departureTime: true, arrivalTime: true, routeId: true,
            confirmedCount: true, capacity: true, status: true,
          },
        });
        if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const parsed = z.object({
          routeId: z.string().min(1).optional(),
          vehicleId: z.string().min(1).nullable().optional(),
          driverId: z.string().min(1).nullable().optional(),
          departureTime: z.iso.datetime({ offset: true }).optional(),
          arrivalTime: z.iso.datetime({ offset: true }).nullable().optional(),
          latestArrivalTime: z.iso.datetime({ offset: true }).nullable().optional(),
          capacity: z.number().int().positive().max(200).optional(),
          frequency: z.enum(['DAILY', 'WEEKLY', 'ONCE']).optional(),
          shiftType: z.enum(['MORNING', 'EVENING', 'NIGHT', 'SPLIT']).optional(),
          direction: z.enum(['INBOUND', 'OUTBOUND']).optional(),
          notes: z.string().max(10000).nullable().optional(),
        }).strict().safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: 'Invalid schedule update', issues: parsed.error.issues }, { status: 400 });
        const data = parsed.data;
        if (touchesAssignment(body) && existing.status !== 'SCHEDULED') return NextResponse.json({ error: 'Only scheduled trips may be reassigned' }, { status: 409 });
        if (data.capacity !== undefined && data.capacity < (existing.confirmedCount ?? 0)) return NextResponse.json({ error: 'Capacity is below confirmed passenger count' }, { status: 409 });

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
              await publishResourceChanges(tx, tenantId, authz.userId ?? null, existing, s);
              return { verdict: v.verdict, validation: v, schedule: s };
            },
            tx,
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
        const schedule = await tx.tripSchedule.update({
          where: { id: params.id },
          data:  { ...data, updatedAt: new Date() },
          include: { route: true },
        });
        await publishResourceChanges(tx, tenantId, authz.userId ?? null, existing, schedule);
        return NextResponse.json(schedule);
      } catch (e) {
        throw e;
      }
    });
  } catch (e) {
    console.error('[bus-ops/schedules/:id PATCH]', e);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}


export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const policyError = await requireBusOpsRequest(req);
  if (policyError) return policyError;
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  // Filled inside the transaction, written after it commits. Auditing from
  // inside an interactive transaction is unsafe in both directions: a
  // fire-and-forget promise is abandoned when the callback returns (the entry
  // silently never lands), and awaiting it holds the transaction's connection
  // while logAudit checks out a second one from the same pool — which can
  // exhaust the pool under concurrency.
  let auditDetails: string | null = null;
  let auditTripName: string | null = null;

  const response = await withTenantRls(prisma, tenantId, async (tx) => {

      try {
        // Selects more than the existence check needs: these fields describe
        // what was destroyed and are what an auditor would ask for, so they
        // are captured here rather than lost behind the deletedAt filter.
        const existing = await tx.tripSchedule.findFirst({
          where: { id: params.id, tenantId, deletedAt: null },
          select: {
            id: true, tripNumber: true, status: true,
            routeId: true, departureTime: true, confirmedCount: true,
          },
        });
        if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        await tx.tripSchedule.update({
          where: { id: params.id },
          data: { deletedAt: new Date(), status: 'CANCELLED' },
        });

        // Deleting a trip schedule is auditable. Only the message is built
        // here; the write happens once the transaction has closed (see above).
        auditTripName = existing.tripNumber ?? null;
        auditDetails =
          `Soft-deleted trip schedule ${existing.tripNumber ?? params.id.slice(0, 8)} ` +
          `(was ${existing.status ?? 'unknown'}, route ${existing.routeId.slice(0, 8)}, ` +
          `departure ${existing.departureTime ? existing.departureTime.toISOString() : 'none'}, ` +
          `${existing.confirmedCount ?? 0} confirmed passenger(s)); deletedAt set, status CANCELLED.`;

        return NextResponse.json({ success: true });
        } catch (e) {
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
      }
  });

  // Transaction has committed and released its connection. Awaiting here is
  // safe and makes the audit trail authoritative for a destructive action —
  // logAudit swallows its own errors, so it still cannot fail the delete.
  if (auditDetails) {
    await logAudit({
      tenantId,
      userId:   req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'TripSchedule',
      entityId:   params.id,
      entityName: auditTripName ?? undefined,
      action:     'DELETE',
      details:    auditDetails,
      ipAddress:  req.headers.get('x-forwarded-for') ?? undefined,
      userAgent:  req.headers.get('user-agent') ?? undefined,
    });
  }

  return response;
}
