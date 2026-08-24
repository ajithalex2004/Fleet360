/**
 * GET /api/bus-ops/schedules/[id]/eta
 *
 * Live ETA for the next unvisited stop on a running trip. Reuses the pure
 * logistics ETA predictor (observed-speed extrapolation with a fallback
 * ladder: observed-speed → route baseline → planned arrival).
 *
 * Returns the ETA to the NEXT stop only. The passenger app can poll this
 * every ~15s while the trip is in progress; a UI change is not part of this
 * endpoint — the endpoint just makes the number available.
 *
 * Response shape:
 *   {
 *     stopId: string | null,      // null when the trip has visited every stop
 *     stopName: string | null,
 *     etaAt: string | null,       // ISO
 *     method: 'observed-speed' | 'lane-average' | 'default-speed' | 'planned' | 'arrived',
 *     confidence: 'high' | 'medium' | 'low',
 *     remainingKm: number | null,
 *     reason: string,
 *   }
 *
 * Auth: tenant session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { predictEta, type TrackingPoint } from '@/lib/logistics/eta-predictor';
import { raiseAlert } from '@/lib/alerts/raise';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

/**
 * LATE_ARRIVAL trips when the predictor's ETA slips past the trip's
 * scheduled arrival window by more than this many minutes. Same
 * philosophy as LATE_DEPARTURE — soft tolerance so GPS jitter or a
 * traffic-light stop doesn't page ops.
 */
const LATE_ARRIVAL_TOLERANCE_MIN = 5;

interface PingRow { latitude: number; longitude: number; occurred_at: Date }
interface StopRow { id: string; sequence: number; stop_name: string; gps_lat: number | null; gps_lng: number | null; estimated_arrival_mins: number | null }
interface VisitRow { stop_id: string; entered_at: Date | null }

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {

  const { id: scheduleId } = await params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        // ensureBusGpsTables() removed — tables live in fleet schema now

        const schedule = await tx.tripSchedule.findFirst({
          where: { id: scheduleId, tenantId },
          select: {
            id: true, routeId: true, departureTime: true, status: true,
            // Route versioning Phase 2 — snapshotted variant version wins.
            routeVariantVersionId: true,
          },
        });
        if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });

        // Prefer the trip's snapshotted variant version so a route edit
        // published *after* this trip started can't change the ETA target.
        // Falls back to the flat routeId list (pre-version rows have
        // variant_version_id IS NULL).
        const stopsQuery = schedule.routeVariantVersionId
          ? tx.$queryRawUnsafe<StopRow[]>(
              `SELECT id, sequence, stop_name, gps_lat, gps_lng, estimated_arrival_mins
                 FROM route_stops
                WHERE variant_version_id = $1
                  AND gps_lat IS NOT NULL AND gps_lng IS NOT NULL
                ORDER BY sequence ASC`,
              schedule.routeVariantVersionId,
            )
          : tx.$queryRawUnsafe<StopRow[]>(
              `SELECT id, sequence, stop_name, gps_lat, gps_lng, estimated_arrival_mins
                 FROM route_stops
                WHERE route_id = $1
                  AND variant_version_id IS NULL
                  AND gps_lat IS NOT NULL AND gps_lng IS NOT NULL
                ORDER BY sequence ASC`,
              schedule.routeId,
            );

        const [stopRows, visitRows, pingRows] = await Promise.all([
          stopsQuery,
          tx.$queryRawUnsafe<VisitRow[]>(
            `SELECT stop_id, entered_at FROM trip_stop_visits WHERE schedule_id = $1 AND entered_at IS NOT NULL`,
            scheduleId,
          ),
          // Last 10 GPS pings for this schedule — enough for the predictor's
          // observed-speed window (default is 5) with headroom for gaps.
          tx.$queryRawUnsafe<PingRow[]>(
            `SELECT latitude, longitude, occurred_at
               FROM fleet.bus_gps_pings
              WHERE schedule_id = $1
              ORDER BY occurred_at DESC
              LIMIT 10`,
            scheduleId,
          ),
        ]);

        const visited = new Set(visitRows.map(v => v.stop_id));
        const nextStop = stopRows.find(s => !visited.has(s.id)) ?? null;

        // No next stop → the trip has visited every geofenced stop already.
        if (!nextStop) {
          return NextResponse.json({
            stopId: null, stopName: null, etaAt: null,
            method: 'arrived', confidence: 'high', remainingKm: null,
            reason: 'All geofenced stops have been visited.',
          });
        }

        // Feed the predictor. Points arrive newest-first from the query; the
        // predictor sorts internally, so order doesn't matter, but reverse for
        // clarity.
        const trackingPoints: TrackingPoint[] = pingRows
          .map(p => ({
            latitude: p.latitude,
            longitude: p.longitude,
            occurredAt: p.occurred_at.toISOString(),
          }))
          .reverse();

        // Planned arrival at THIS stop = trip departureTime + stop.estimated_arrival_mins.
        // Null-safe: if either is missing, the predictor falls back to observed-speed
        // only, or to defaults, and reports its confidence accordingly.
        const plannedArrivalAt = nextStop.estimated_arrival_mins != null
          ? new Date(schedule.departureTime.getTime() + nextStop.estimated_arrival_mins * 60_000).toISOString()
          : null;

        const prediction = predictEta({
          trackingPoints,
          destination: { latitude: nextStop.gps_lat as number, longitude: nextStop.gps_lng as number },
          now: new Date().toISOString(),
          plannedArrivalAt,
        });

        // Alert Engine — LATE_ARRIVAL. Dedup key includes the stop id so
        // the passenger sees one alert per stop, not per ETA poll (this
        // endpoint is polled every ~15s during a live trip). The Alert
        // Engine's partial unique index enforces this; we can also rely on
        // it not to spam the pipeline.
        if (
          prediction.etaAt &&
          plannedArrivalAt &&
          new Date(prediction.etaAt).getTime() - new Date(plannedArrivalAt).getTime() > LATE_ARRIVAL_TOLERANCE_MIN * 60_000
        ) {
          const delayMin = Math.round((new Date(prediction.etaAt).getTime() - new Date(plannedArrivalAt).getTime()) / 60_000);
          void raiseAlert({
            tenantId,
            code:         'LATE_ARRIVAL',
            sourceModule: 'bus-ops',
            subjectType:  'TripSchedule',
            subjectId:    schedule.id,
            // (schedule, stop) dedup — one alert per stop-per-trip that
            // stays open until acknowledged or the arrival lands.
            dedupeKey:    `LATE_ARRIVAL:${schedule.id}:${nextStop.id}`,
            title:        `Trip ${schedule.id.slice(0, 8)} · late arriving at ${nextStop.stop_name} by ${delayMin} min`,
            description:  `Planned ${plannedArrivalAt}, predicted ${prediction.etaAt}. Confidence: ${prediction.confidence}.`,
            severity:     delayMin > 15 ? 'HIGH' : 'MEDIUM',
            context: {
              scheduleId:  schedule.id,
              stopId:      nextStop.id,
              stopName:    nextStop.stop_name,
              plannedAt:   plannedArrivalAt,
              predictedAt: prediction.etaAt,
              delayMinutes: delayMin,
              method:      prediction.method,
            },
          });
        }

        return NextResponse.json({
          stopId: nextStop.id,
          stopName: nextStop.stop_name,
          etaAt: prediction.etaAt,
          method: prediction.method,
          confidence: prediction.confidence,
          remainingKm: prediction.remainingKm,
          reason: prediction.reason,
        }, { headers: { 'Cache-Control': 'no-store' } });
        } catch (e) {
        console.error('[bus-ops/schedules/:id/eta GET]', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to compute ETA' }, { status: 500 });
      }
  });
}

