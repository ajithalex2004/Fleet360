import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';
import { expandRosterToTrip } from '@/lib/bus-ops/expand-roster';
import { resolveVariantVersionForTrip } from '@/lib/bus-ops/resolve-variant-version';
import { raiseAlert } from '@/lib/alerts/raise';
import { validateResourceAssignment } from '@/lib/bus-ops/validate-assignment';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  estimateRosterCountForTrip,
  isValidationEnabled,
  withAssignmentLocks,
} from '@/lib/bus-ops/assignment-txn';

const CACHE_TAG = 'bus-ops:schedules';

const getSchedules = cacheRead(
  async (
    tenantId: string,
    status: string | null,
    routeId: string | null,
    dateStr: string | null,
  ) => {
    const where: any = { deletedAt: null, tenantId };
    if (status)   where.status   = status;
    if (routeId)  where.routeId  = routeId;
    if (dateStr) {
      const start = new Date(dateStr); start.setHours(0,0,0,0);
      const end   = new Date(dateStr); end.setHours(23,59,59,999);
      where.departureTime = { gte: start, lte: end };
    }
    return prisma.tripSchedule.findMany({
      where,
      include: {
        route: true,
        passengers: true,
        tripLogs: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { departureTime: 'asc' },
    });
  },
  [CACHE_TAG],
  30,
);

export async function GET(req: NextRequest) {
  try {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

    if (!authz.ok) {

      return NextResponse.json({ error: authz.error }, { status: authz.status });

    }

    const { tenantId } = authz;
    const { searchParams } = new URL(req.url);
    const status  = searchParams.get('status');
    const routeId = searchParams.get('routeId');
    const dateStr = searchParams.get('date');

    const schedules = await getSchedules(tenantId, status, routeId, dateStr);
    return NextResponse.json(schedules, {
      headers: { 'Cache-Control': privateCacheControl(30, 120) },
    });
    } catch (e) {
    console.error('Error fetching schedules:', e);
    return NextResponse.json({ error: 'Failed to fetch schedules' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {

  try {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

    if (!authz.ok) {

      return NextResponse.json({ error: authz.error }, { status: authz.status });

    }

    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        // Per-tenant, and derived from the highest number issued rather than
        // a row count — see the note in transport-requests for why both parts
        // matter. Guarded by uniq_trip_schedules_tenant_trip_number.
        //
        // $1::uuid, unlike the sibling generators: trip_schedules.tenant_id is
        // uuid while staff_transport_requests and breakdown_reports use text.
        // Without the cast this fails with 42883 "operator does not exist:
        // uuid = text" on every trip creation.
        const [{ max }] = await tx.$queryRawUnsafe<Array<{ max: number | null }>>(
          `SELECT MAX(NULLIF(regexp_replace(trip_number, '^TRP-', ''), '')::int) AS max
             FROM trip_schedules
            WHERE tenant_id = $1::uuid AND trip_number ~ '^TRP-[0-9]+$'`,
          tenantId,
        );
        const tripNumber = body.tripNumber ?? `TRP-${String((max ?? 0) + 1).padStart(5, '0')}`;

        // Route versioning Phase 1 — snapshot the exact variant version this
        // trip runs. Prefer explicit body.routeVariantVersionId, else derive
        // from routeVariantId, else from routeId+direction, else routeId
        // alone. Null result means the route has no variants yet — the trip
        // is written without a snapshot (Phase 1 back-compat) and Phase 2
        // reader migration will start requiring it.
        const snapshot = await resolveVariantVersionForTrip({
          tenantId,
          routeId:              body.routeId ?? null,
          direction:            body.direction ?? null,
          routeVariantId:       body.routeVariantId ?? null,
          routeVariantVersionId: body.routeVariantVersionId ?? null,
        }).catch(err => {
          console.warn('[schedules.POST] variant-version resolve failed:', err);
          return null;
        });

        // Resource Validation Engine (Phase 1) — validate + write inside
        // a single transaction with advisory locks on (tenant, vehicle)
        // and (tenant, driver). Prevents check-then-write races between
        // concurrent dispatchers targeting the same resources.
        //
        // Validation runs read-only against the same transaction so the
        // overlap check sees every committed prior trip but not this
        // transaction's own future write.
        //
        // On POST the roster hasn't been materialised yet — we estimate
        // future roster size via the same eligibility logic the roster
        // expander uses. This lets V4 (capacity) fire honestly instead
        // of always passing on new schedules.
        const departureTime = body.departureTime ? new Date(body.departureTime) : null;
        const arrivalTime   = body.arrivalTime   ? new Date(body.arrivalTime)   : null;
        if (!departureTime) {
          return NextResponse.json({ error: 'departureTime is required' }, { status: 400 });
        }

        let validation:
          | Awaited<ReturnType<typeof validateResourceAssignment>>
          | undefined;
        let schedule: Awaited<ReturnType<typeof tx.tripSchedule.create>>;

        if (isValidationEnabled()) {
          const estimatedRoster = body.routeId
            ? await estimateRosterCountForTrip({ tenantId, routeId: body.routeId, tripDate: departureTime })
            : 0;

          const txResult = await withAssignmentLocks(
            { tenantId, vehicleId: body.vehicleId ?? null, driverId: body.driverId ?? null },
            async (tx) => {
              const v = await validateResourceAssignment(
                {
                  tenantId,
                  vehicleId:     body.vehicleId ?? null,
                  driverId:      body.driverId  ?? null,
                  departureTime,
                  arrivalTime,
                  routeId:       body.routeId ?? null,
                  confirmedCount: estimatedRoster,
                  timezone:      body.timezone ?? undefined,
                },
                tx,
              );
              if (v.verdict === 'BLOCK') {
                // Bail out of the transaction (rolls back the lock) —
                // return the verdict to the outer handler so it can 409.
                return { verdict: 'BLOCK' as const, validation: v };
              }
              // Verdict is PASS or WARN — write inside the same tx while
              // the lock is still held.
              const s = await tx.tripSchedule.create({
                data: {
                  ...body,
                  tripNumber,
                  tenantId,
                  routeVariantVersionId: snapshot?.id ?? null,
                },
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
          validation = txResult.validation;
          schedule = txResult.schedule!;
        } else {
          // Feature-disabled path — preserve pre-Phase-1 behaviour exactly.
          // `validation` stays undefined so clients can tell the engine was off.
          schedule = await tx.tripSchedule.create({
            data: {
              ...body,
              tripNumber,
              tenantId,
              routeVariantVersionId: snapshot?.id ?? null,
            },
            include: { route: true },
          });
        }

        // Materialise the route's standing passenger roster into TripPassenger
        // rows for this new trip. Best-effort: if the expansion fails for any
        // reason, the trip itself is already created and ops can re-run the
        // expansion manually via POST /api/bus-ops/schedules/[id]/expand-roster.
        let rosterExpansion = null;
        if (schedule.routeId && schedule.departureTime) {
          try {
            rosterExpansion = await expandRosterToTrip(
              tenantId,
              schedule.id,
              schedule.routeId,
              new Date(schedule.departureTime),
            );
          } catch (err) {
            console.error('[schedules.POST] roster expansion failed:', err);
          }
        }

        // Alert Engine — CAPACITY_EXCEEDED. Roster expansion just wrote the
        // definitive attendance count; compare against the schedule's
        // capacity (which the caller sets or defaults from the route).
        // Dedup on scheduleId — only one CAPACITY_EXCEEDED per trip at a
        // time. Re-triggers after ops resolves the alert and a passenger is
        // added later.
        if (schedule.capacity && rosterExpansion) {
          const seated = (rosterExpansion.inserted ?? 0) + (rosterExpansion.skipped ?? 0);
          if (seated > schedule.capacity) {
            void raiseAlert({
              tenantId,
              code:         'CAPACITY_EXCEEDED',
              sourceModule: 'bus-ops',
              subjectType:  'TripSchedule',
              subjectId:    schedule.id,
              title:        `Trip ${schedule.tripNumber ?? schedule.id.slice(0, 8)} · over capacity (${seated}/${schedule.capacity})`,
              description:  `${seated - schedule.capacity} passenger${seated - schedule.capacity === 1 ? '' : 's'} above the bus's ${schedule.capacity}-seat capacity.`,
              severity:     'HIGH',
              context: {
                scheduleId:    schedule.id,
                tripNumber:    schedule.tripNumber,
                capacity:      schedule.capacity,
                confirmedCount: seated,
                overBy:        seated - schedule.capacity,
              },
            });
          }
        }

        revalidateCache([CACHE_TAG]);
        return NextResponse.json({ ...schedule, rosterExpansion, validation }, { status: 201 });
    });
  } catch (e) {
    console.error('Error creating schedule:', e);
    return NextResponse.json({ error: 'Failed to create schedule' }, { status: 500 });
  }
}

