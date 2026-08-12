/**
 * POST /api/bus-ops/vehicles/[id]/location
 *
 * Ingest bus GPS pings. Called by the driver mobile app during an active
 * trip, or by an external vehicle tracker device.
 *
 * Two shapes accepted:
 *
 *   SINGLE PING (typical driver-app case):
 *     { latitude, longitude, occurredAt?, scheduleId?, speedKmh?, headingDeg?, accuracyM?, source? }
 *
 *   BATCH PING (bandwidth-constrained tracker uploading a window):
 *     { pings: [ { latitude, longitude, occurredAt, ... }, ... ], scheduleId? }
 *
 * Side effects on each ping when scheduleId is provided:
 *   1. Store the raw ping (bus_gps_pings)
 *   2. Evaluate against the schedule's route stops
 *   3. For each state transition:
 *        APPROACH → send passengers-waiting-at-this-stop a "bus arriving" notification (Gap E)
 *        ENTER    → upsert TripStopVisit.enteredAt ("bus at stop")
 *        EXIT     → set TripStopVisit.leftAt ("bus left stop")
 *
 * Auth: tenant session (x-tenant-id from middleware). No HMAC yet — the
 * MVP flow is driver-app-authenticated. External-tracker HMAC can layer on
 * the same handler later without a breaking change.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import {
  ensureBusGpsTables,
  evaluateStopTransitions,
  type BusPing,
  type StopWithGeo,
  type PriorVisit,
  type StopTransition,
} from '@/lib/bus-gps';
import { sendWhatsApp } from '@/lib/whatsapp';
import { upsertFleetPosition } from '@/app/api/bus-ops/fleet-positions/route';

export const runtime = 'nodejs';

interface SinglePingBody {
  latitude?: number;
  longitude?: number;
  occurredAt?: string;
  scheduleId?: string | null;
  speedKmh?: number | null;
  headingDeg?: number | null;
  accuracyM?: number | null;
  source?: string | null;
}

interface BatchBody {
  pings?: SinglePingBody[];
  scheduleId?: string | null;
}

interface StopRow { id: string; sequence: number; stop_name: string; gps_lat: number | null; gps_lng: number | null; geofence_radius_m: number | null }
interface VisitRow { stop_id: string; approached_at: Date | null; entered_at: Date | null; left_at: Date | null; approach_notified_at: Date | null }
interface PassengerRow { id: string; employee_name: string | null; contact_number: string | null; email: string | null }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: vehicleId } = await params;
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: SinglePingBody & BatchBody;
  try { body = (await req.json()) as SinglePingBody & BatchBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Normalise single vs batch into a uniform list. Single-ping callers usually
  // want the sync path (see transitions in the response); batch callers accept
  // that we evaluate transitions only against the newest ping.
  const rawPings: SinglePingBody[] = Array.isArray(body.pings) && body.pings.length > 0
    ? body.pings
    : [{ latitude: body.latitude, longitude: body.longitude, occurredAt: body.occurredAt,
         scheduleId: body.scheduleId, speedKmh: body.speedKmh, headingDeg: body.headingDeg,
         accuracyM: body.accuracyM, source: body.source }];

  const scheduleId = body.scheduleId ?? rawPings[0]?.scheduleId ?? null;

  const validPings: Array<Required<Pick<SinglePingBody, 'latitude' | 'longitude'>> & SinglePingBody> = [];
  for (const p of rawPings) {
    if (typeof p.latitude !== 'number' || typeof p.longitude !== 'number') continue;
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
    validPings.push({ ...p, latitude: p.latitude, longitude: p.longitude });
  }
  if (validPings.length === 0) {
    return NextResponse.json({ error: 'At least one ping with valid latitude+longitude is required' }, { status: 400 });
  }

  try {
    await ensureBusGpsTables();

    // Persist every ping. Batched insert would be cleaner but N pings per call
    // is tiny in practice (driver app sends 1; tracker sends ~10-30 per batch).
    const nowIso = new Date().toISOString();
    for (const p of validPings) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO fleet.bus_gps_pings (id, tenant_id, vehicle_id, schedule_id, latitude, longitude,
           speed_kmh, heading_deg, accuracy_m, occurred_at, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        randomUUID(), tenantId, vehicleId, scheduleId, p.latitude, p.longitude,
        p.speedKmh ?? null, p.headingDeg ?? null, p.accuracyM ?? null,
        new Date(p.occurredAt ?? nowIso), p.source ?? 'DRIVER_APP',
      );
    }

    // Latest ping for the fleet-live-map upsert (used in both branches below).
    const latestPingForFeed = validPings[validPings.length - 1];

    // No scheduleId → nothing to evaluate against a route, but still push the
    // vehicle onto the live-map so unattached vehicles ("garage sweep",
    // pre-trip warm-up) are visible.
    if (!scheduleId) {
      await upsertFleetPosition({
        tenantId, vehicleId,
        lat: latestPingForFeed.latitude, lng: latestPingForFeed.longitude,
        speedKmh: latestPingForFeed.speedKmh ?? 0,
        headingDeg: latestPingForFeed.headingDeg ?? 0,
        status: 'IDLE',
      }).catch(err => console.warn('[bus-ops/location] fleet-position upsert failed:', err));
      return NextResponse.json({ stored: validPings.length, transitions: [], approachNotifications: 0 });
    }

    // Load the schedule's route stops (with GPS) and the prior visit state.
    // Both queries hit the same tenant so we can trust the join. Route stops
    // are cheap (typically <30 per route); prior visits scale with # of stops.
    const schedule = await prisma.tripSchedule.findFirst({
      where: { id: scheduleId, tenantId },
      select: {
        id: true, routeId: true, vehicleId: true, driverId: true,
        status: true, confirmedCount: true,
        route:   { select: { name: true } },
      },
    });
    if (!schedule) {
      return NextResponse.json({ stored: validPings.length, transitions: [], approachNotifications: 0, note: 'Schedule not found; ping stored only.' });
    }

    const [stopRows, visitRows] = await Promise.all([
      prisma.$queryRawUnsafe<StopRow[]>(
        `SELECT id, sequence, stop_name, gps_lat, gps_lng, geofence_radius_m
           FROM route_stops
          WHERE route_id = $1 AND gps_lat IS NOT NULL AND gps_lng IS NOT NULL
          ORDER BY sequence ASC`,
        schedule.routeId,
      ),
      prisma.$queryRawUnsafe<VisitRow[]>(
        `SELECT stop_id, approached_at, entered_at, left_at, approach_notified_at
           FROM trip_stop_visits WHERE schedule_id = $1`,
        scheduleId,
      ),
    ]);

    const stops: StopWithGeo[] = stopRows.map(r => ({
      id: r.id, sequence: r.sequence, stopName: r.stop_name,
      gpsLat: r.gps_lat as number, gpsLng: r.gps_lng as number,
      geofenceRadiusM: r.geofence_radius_m,
    }));
    const priorVisits: PriorVisit[] = visitRows.map(r => ({
      stopId: r.stop_id,
      approachedAt: r.approached_at?.toISOString() ?? null,
      enteredAt:    r.entered_at?.toISOString() ?? null,
      leftAt:       r.left_at?.toISOString() ?? null,
      approachNotifiedAt: r.approach_notified_at?.toISOString() ?? null,
    }));

    // Evaluate transitions only against the LATEST ping — older pings in a
    // batch are stored for the history/ETA feature but shouldn't retroactively
    // flip visit state. If a tracker uploads a 30-minute batch after a signal
    // outage, only the "now" position drives what fires.
    const latest = validPings[validPings.length - 1];
    const latestPing: BusPing = {
      latitude: latest.latitude, longitude: latest.longitude,
      occurredAt: latest.occurredAt ?? nowIso,
    };
    const { transitions, visitPatches } = evaluateStopTransitions(latestPing, stops, priorVisits);

    // Persist visit patches — upsert per (schedule, stop). Doing this with an
    // INSERT ... ON CONFLICT is a bit noisy but bulletproof under concurrent
    // pings (two workers, same schedule).
    for (const patch of visitPatches) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO trip_stop_visits (id, tenant_id, schedule_id, stop_id, approached_at, entered_at, left_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (schedule_id, stop_id) DO UPDATE SET
           approached_at = COALESCE(trip_stop_visits.approached_at, EXCLUDED.approached_at),
           entered_at    = COALESCE(trip_stop_visits.entered_at,    EXCLUDED.entered_at),
           left_at       = COALESCE(trip_stop_visits.left_at,       EXCLUDED.left_at),
           updated_at    = NOW()`,
        randomUUID(), tenantId, scheduleId, patch.stopId,
        patch.approachedAt ? new Date(patch.approachedAt) : null,
        patch.enteredAt    ? new Date(patch.enteredAt)    : null,
        patch.leftAt       ? new Date(patch.leftAt)       : null,
      );
    }

    // Approach notifications (Gap E). Fire once per (schedule, stop) — the
    // approach_notified_at column is the idempotency gate. Best-effort: a
    // WhatsApp send failure logs but doesn't fail the ingest.
    const approaches = transitions.filter((t): t is Extract<StopTransition, { type: 'APPROACH' }> => t.type === 'APPROACH');
    let approachNotifiedCount = 0;
    for (const t of approaches) {
      const prior = priorVisits.find(v => v.stopId === t.stopId);
      if (prior?.approachNotifiedAt) continue; // already sent for this visit
      try {
        approachNotifiedCount += await notifyApproachingPassengers(scheduleId, t.stopId, t.stopName);
        await prisma.$executeRawUnsafe(
          `UPDATE trip_stop_visits SET approach_notified_at = NOW() WHERE schedule_id = $1 AND stop_id = $2`,
          scheduleId, t.stopId,
        );
      } catch (err) {
        console.warn('[bus-ops/location] approach notify failed', { scheduleId, stopId: t.stopId, err });
      }
    }

    // Live-map feed — best-effort. Any failure here is logged and swallowed
    // so it can never break the actual GPS ingest.
    try {
      // Driver name is not selected in the schedule query (TripSchedule has no
      // direct relation to Driver — only driverId). Leave it null here; the
      // fleet-positions feed falls back to the Driver table via its own join.
      const driverFullName: string | null = null;
      // Vehicle-status mapping. Two axes:
      //   (1) trip lifecycle → base motion state
      //         SCHEDULED   → IDLE      (bus is present but the trip hasn't started)
      //         DEPARTED    → EN_ROUTE  (bus just left origin)
      //         IN_TRANSIT  → EN_ROUTE  (bus is moving between stops)
      //         COMPLETED   → IDLE      (bus finished the trip)
      //         CANCELLED   → IDLE      (trip aborted)
      //   (2) geofence override — if the bus is currently INSIDE any stop's
      //         geofence (entered_at set, left_at not yet set), we override
      //         the base state to AT_STOP so the live map shows the stopover
      //         even when the trip is in IN_TRANSIT.
      // Prior bug: SCHEDULED fell through to EN_ROUTE via a lazy ternary
      // fallback, so vehicles on scheduled-but-not-departed trips lit up
      // on the map as en-route. Fixed by treating SCHEDULED explicitly.
      const baseStatus =
        schedule.status === 'DEPARTED' || schedule.status === 'IN_TRANSIT' ? 'EN_ROUTE' :
        'IDLE';
      const atStopRows = await prisma.$queryRawUnsafe<Array<{ stop_id: string }>>(
        `SELECT stop_id FROM trip_stop_visits
          WHERE schedule_id = $1 AND entered_at IS NOT NULL AND left_at IS NULL
          LIMIT 1`,
        scheduleId,
      ).catch(() => [] as Array<{ stop_id: string }>);
      const mappedStatus = atStopRows.length > 0 ? 'AT_STOP' : baseStatus;
      await upsertFleetPosition({
        tenantId, vehicleId,
        lat: latestPingForFeed.latitude, lng: latestPingForFeed.longitude,
        speedKmh: latestPingForFeed.speedKmh ?? 0,
        headingDeg: latestPingForFeed.headingDeg ?? 0,
        routeId: schedule.routeId,
        routeName: schedule.route?.name ?? null,
        tripId: scheduleId,
        vehiclePlate: null, // TripSchedule has no Vehicle relation; plate resolved downstream
        driverName: driverFullName || null,
        status: mappedStatus,
        passengersOnboard: schedule.confirmedCount ?? 0,
      });
    } catch (err) {
      console.warn('[bus-ops/location] fleet-position upsert failed:', err);
    }

    return NextResponse.json({
      stored: validPings.length,
      transitions,
      approachNotifications: approachNotifiedCount,
    });
  } catch (e) {
    console.error('[bus-ops/vehicles/:id/location POST]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to ingest location' }, { status: 500 });
  }
}

/**
 * Send an approach-notification (WhatsApp) to every CONFIRMED passenger whose
 * boarding stop matches. Returns the count actually sent. Silent per-passenger
 * failures — we don't want one bad phone number to block the trip.
 */
async function notifyApproachingPassengers(scheduleId: string, stopId: string, stopName: string): Promise<number> {
  const passengers = await prisma.$queryRawUnsafe<PassengerRow[]>(
    `SELECT tp.id, tp.employee_name, sm.contact_number, sm.email
       FROM trip_passengers tp
       LEFT JOIN staff_members sm ON sm.id = tp.staff_member_id
      WHERE tp.trip_id = $1
        AND tp.boarding_stop_id = $2
        AND tp.status = 'CONFIRMED'
        AND tp.deleted_at IS NULL`,
    scheduleId, stopId,
  ).catch(() => [] as PassengerRow[]);

  let sent = 0;
  for (const p of passengers) {
    if (!p.contact_number) continue;
    try {
      await sendWhatsApp({
        to: p.contact_number,
        body: `🚌 Your staff bus is approaching ${stopName}. Please be ready at the stop.`,
      });
      sent++;
    } catch (err) {
      console.warn('[bus-ops/location] whatsapp send failed', { passengerId: p.id, err });
    }
  }
  return sent;
}
