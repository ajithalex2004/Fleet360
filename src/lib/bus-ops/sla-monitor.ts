/**
 * src/lib/bus-ops/sla-monitor.ts
 *
 * Shift Arrival SLA Monitoring & Destination ETA Prediction Engine
 *
 * Enterprise staff transport operates with hard arrival commitments
 * (shift start times, e.g. 07:00 AM factory/hospital start).
 *
 * This module:
 *  1. Evaluates all active running / upcoming shift trips for a tenant.
 *  2. Extrapolates predicted ETA to the FINAL destination work-site stop.
 *  3. Compares against both planned arrival and `latestArrivalTime` (the shift SLA).
 *  4. Categorizes into:
 *       - ON_TIME:    predicted ETA <= planned + 5 min tolerance
 *       - AT_RISK:    delay 5 - 15 min, but still <= latestArrivalTime
 *       - SLA_BREACH: delay > 15 min OR predicted ETA > latestArrivalTime
 *  5. Automatically raises structured alerts through the Alert Engine.
 */

import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { predictEta, type TrackingPoint } from '@/lib/logistics/eta-predictor';
import { raiseAlert } from '@/lib/alerts/raise';

export type SlaStatus = 'ON_TIME' | 'AT_RISK' | 'SLA_BREACH' | 'COMPLETED' | 'CANCELLED';

export interface TripSlaEvaluation {
  tripId: string;
  tripNumber: string | null;
  routeId: string;
  routeName: string;
  origin: string;
  destination: string;
  vehicleId: string | null;
  vehicleCode: string | null;
  driverId: string | null;
  driverName: string | null;
  shiftType: string | null;
  direction: string | null;
  status: string;
  departureTime: string;
  plannedArrivalTime: string | null;
  latestArrivalTime: string | null;
  predictedArrivalTime: string | null;
  delayMinutes: number;
  slaStatus: SlaStatus;
  confidence: 'high' | 'medium' | 'low';
  predictionMethod: string;
  remainingKm: number | null;
  totalPassengers: number;
  boardedPassengers: number;
  nextStopName: string | null;
  nextStopEta: string | null;
  destinationStopName: string | null;
  evaluatedAt: string;
}

export interface SlaMonitorSummary {
  totalActiveTrips: number;
  onTimeCount: number;
  atRiskCount: number;
  breachCount: number;
  onTimeRatePercent: number;
  totalImpactedPassengers: number;
  trips: TripSlaEvaluation[];
  evaluatedAt: string;
}

interface PingRow {
  latitude: number;
  longitude: number;
  occurred_at: Date;
}

interface StopRow {
  id: string;
  sequence: number;
  stop_name: string;
  gps_lat: number | null;
  gps_lng: number | null;
  estimated_arrival_mins: number | null;
}

interface VisitRow {
  stop_id: string;
  entered_at: Date | null;
}

const ON_TIME_TOLERANCE_MIN = 5;
const AT_RISK_THRESHOLD_MIN = 15;

/**
 * Evaluates a single trip schedule for destination SLA health.
 */
export function evaluateTripSlaSync(params: {
  trip: {
    id: string;
    tripNumber: string | null;
    routeId: string;
    vehicleId: string | null;
    driverId: string | null;
    departureTime: Date;
    arrivalTime: Date | null;
    latestArrivalTime: Date | null;
    status: string | null;
    shiftType: string | null;
    direction: string | null;
    route?: { name?: string | null; origin?: string | null; destination?: string | null };
    vehicle?: { vehicleCode?: string | null; licensePlate?: string | null };
    driver?: { firstName?: string | null; lastName?: string | null };
    passengers?: Array<{ id: string; status?: string | null; boardedAt?: Date | null }>;
  };
  stops: StopRow[];
  visits: VisitRow[];
  pings: PingRow[];
  now?: string;
}): TripSlaEvaluation {
  const nowIso = params.now || new Date().toISOString();
  const { trip, stops, visits, pings } = params;

  const visitedSet = new Set(visits.map(v => v.stop_id));
  const unvisitedStops = stops.filter(s => !visitedSet.has(s.id));
  const nextStop = unvisitedStops[0] || null;
  const destinationStop = stops[stops.length - 1] || null;

  const plannedArrivalIso = trip.arrivalTime ? trip.arrivalTime.toISOString() : null;
  const latestArrivalIso = trip.latestArrivalTime ? trip.latestArrivalTime.toISOString() : null;

  // Format tracking points newest first -> reverse for predictor
  const trackingPoints: TrackingPoint[] = pings
    .map(p => ({
      latitude: p.latitude,
      longitude: p.longitude,
      occurredAt: p.occurred_at.toISOString(),
    }))
    .reverse();

  // Predict ETA to destination stop
  let predictedArrivalIso: string | null = plannedArrivalIso;
  let method = 'planned';
  let confidence: 'high' | 'medium' | 'low' = 'low';
  let remainingKm: number | null = null;

  if (destinationStop && destinationStop.gps_lat != null && destinationStop.gps_lng != null) {
    const plannedForDest = destinationStop.estimated_arrival_mins != null
      ? new Date(trip.departureTime.getTime() + destinationStop.estimated_arrival_mins * 60_000).toISOString()
      : plannedArrivalIso;

    const prediction = predictEta({
      trackingPoints,
      destination: { latitude: destinationStop.gps_lat, longitude: destinationStop.gps_lng },
      now: nowIso,
      plannedArrivalAt: plannedForDest,
    });

    predictedArrivalIso = prediction.etaAt;
    method = prediction.method;
    confidence = prediction.confidence;
    remainingKm = prediction.remainingKm;
  }

  // Predict next stop ETA if different from destination
  let nextStopEta: string | null = null;
  if (nextStop && nextStop.gps_lat != null && nextStop.gps_lng != null) {
    const plannedForNext = nextStop.estimated_arrival_mins != null
      ? new Date(trip.departureTime.getTime() + nextStop.estimated_arrival_mins * 60_000).toISOString()
      : null;

    const nextPrediction = predictEta({
      trackingPoints,
      destination: { latitude: nextStop.gps_lat, longitude: nextStop.gps_lng },
      now: nowIso,
      plannedArrivalAt: plannedForNext,
    });
    nextStopEta = nextPrediction.etaAt;
  }

  // Calculate delay relative to planned arrival
  let delayMinutes = 0;
  if (predictedArrivalIso && plannedArrivalIso) {
    const diffMs = new Date(predictedArrivalIso).getTime() - new Date(plannedArrivalIso).getTime();
    delayMinutes = Math.round(diffMs / 60_000);
  }

  // SLA Status classification
  let slaStatus: SlaStatus = 'ON_TIME';
  if (trip.status === 'COMPLETED') {
    slaStatus = 'COMPLETED';
  } else if (trip.status === 'CANCELLED') {
    slaStatus = 'CANCELLED';
  } else {
    const isPastLatestSla = latestArrivalIso && predictedArrivalIso
      ? new Date(predictedArrivalIso).getTime() > new Date(latestArrivalIso).getTime()
      : false;

    if (isPastLatestSla || delayMinutes > AT_RISK_THRESHOLD_MIN) {
      slaStatus = 'SLA_BREACH';
    } else if (delayMinutes > ON_TIME_TOLERANCE_MIN) {
      slaStatus = 'AT_RISK';
    } else {
      slaStatus = 'ON_TIME';
    }
  }

  const passengers = trip.passengers || [];
  const totalPassengers = passengers.length;
  const boardedPassengers = passengers.filter(p => p.boardedAt != null || p.status === 'BOARDED').length;

  const driverName = trip.driver
    ? `${trip.driver.firstName || ''} ${trip.driver.lastName || ''}`.trim() || null
    : null;

  return {
    tripId: trip.id,
    tripNumber: trip.tripNumber,
    routeId: trip.routeId,
    routeName: trip.route?.name || 'Unnamed Route',
    origin: trip.route?.origin || 'Origin',
    destination: trip.route?.destination || destinationStop?.stop_name || 'Destination',
    vehicleId: trip.vehicleId,
    vehicleCode: trip.vehicle?.vehicleCode || trip.vehicle?.licensePlate || null,
    driverId: trip.driverId,
    driverName,
    shiftType: trip.shiftType,
    direction: trip.direction,
    status: trip.status || 'SCHEDULED',
    departureTime: trip.departureTime.toISOString(),
    plannedArrivalTime: plannedArrivalIso,
    latestArrivalTime: latestArrivalIso,
    predictedArrivalTime: predictedArrivalIso,
    delayMinutes: Math.max(0, delayMinutes),
    slaStatus,
    confidence,
    predictionMethod: method,
    remainingKm,
    totalPassengers,
    boardedPassengers,
    nextStopName: nextStop?.stop_name || null,
    nextStopEta,
    destinationStopName: destinationStop?.stop_name || trip.route?.destination || null,
    evaluatedAt: nowIso,
  };
}

/**
 * Evaluates all active trips for a tenant and optionally raises alerts for at-risk/breached trips.
 */
export async function evaluateTenantSla(tenantId: string, options: {
  raiseAlerts?: boolean;
  statusFilter?: string[];
} = {}): Promise<SlaMonitorSummary> {
  const shouldRaiseAlerts = options.raiseAlerts ?? true;
  const targetStatuses = options.statusFilter || ['EN_ROUTE', 'STARTED', 'IN_TRANSIT', 'DEPARTED', 'SCHEDULED'];

  return withTenantRls(prisma, tenantId, async (tx) => {
    // 1. Fetch active trips (today / running)
    const now = new Date();
    const startOfWindow = new Date(now.getTime() - 4 * 3600_000); // 4 hours ago
    const endOfWindow = new Date(now.getTime() + 2 * 3600_000);   // next 2 hours

    const activeTrips = await tx.tripSchedule.findMany({
      where: {
        tenantId,
        status: { in: targetStatuses },
        departureTime: { gte: startOfWindow, lte: endOfWindow },
      },
      include: {
        route: { select: { name: true, origin: true, destination: true } },
        passengers: { select: { id: true, status: true, boardedAt: true } },
      },
      orderBy: { departureTime: 'asc' },
    });

    if (activeTrips.length === 0) {
      return {
        totalActiveTrips: 0,
        onTimeCount: 0,
        atRiskCount: 0,
        breachCount: 0,
        onTimeRatePercent: 100,
        totalImpactedPassengers: 0,
        trips: [],
        evaluatedAt: now.toISOString(),
      };
    }

    const evaluations: TripSlaEvaluation[] = [];

    for (const trip of activeTrips) {
      // Fetch stops for this trip
      const stops = trip.routeVariantVersionId
        ? await tx.$queryRawUnsafe<StopRow[]>(
            `SELECT id, sequence, stop_name, gps_lat, gps_lng, estimated_arrival_mins
               FROM route_stops
              WHERE variant_version_id = $1
                AND gps_lat IS NOT NULL AND gps_lng IS NOT NULL
              ORDER BY sequence ASC`,
            trip.routeVariantVersionId,
          )
        : await tx.$queryRawUnsafe<StopRow[]>(
            `SELECT id, sequence, stop_name, gps_lat, gps_lng, estimated_arrival_mins
               FROM route_stops
              WHERE route_id = $1
                AND variant_version_id IS NULL
                AND gps_lat IS NOT NULL AND gps_lng IS NOT NULL
              ORDER BY sequence ASC`,
            trip.routeId,
          );

      // Fetch stop visits
      const visits = await tx.$queryRawUnsafe<VisitRow[]>(
        `SELECT stop_id, entered_at FROM trip_stop_visits WHERE schedule_id = $1 AND entered_at IS NOT NULL`,
        trip.id,
      );

      // Fetch recent pings
      const pings = await tx.$queryRawUnsafe<PingRow[]>(
        `SELECT latitude, longitude, occurred_at
           FROM fleet.bus_gps_pings
          WHERE schedule_id = $1
          ORDER BY occurred_at DESC
          LIMIT 10`,
        trip.id,
      );

      // Fetch driver info if assigned
      let driver: { firstName?: string; lastName?: string } | undefined = undefined;
      if (trip.driverId) {
        const d = await tx.driver.findFirst({
          where: { id: trip.driverId, tenantId },
          select: { firstName: true, lastName: true },
        });
        if (d) driver = d;
      }

      // Fetch vehicle info if assigned
      let vehicle: { vehicleCode?: string; licensePlate?: string } | undefined = undefined;
      if (trip.vehicleId) {
        const v = await tx.vehicle.findFirst({
          where: { id: trip.vehicleId, tenantId },
          select: { vehicleCode: true, licensePlate: true },
        });
        if (v) vehicle = { vehicleCode: v.vehicleCode, licensePlate: v.licensePlate || undefined };
      }

      const evaluation = evaluateTripSlaSync({
        trip: {
          ...trip,
          driver,
          vehicle,
        },
        stops,
        visits,
        pings,
        now: now.toISOString(),
      });

      evaluations.push(evaluation);

      // Raise alerts if needed
      if (shouldRaiseAlerts && (evaluation.slaStatus === 'SLA_BREACH' || evaluation.slaStatus === 'AT_RISK')) {
        const isBreach = evaluation.slaStatus === 'SLA_BREACH';
        const code = isBreach ? 'SHIFT_ARRIVAL_SLA_BREACH' : 'SHIFT_ARRIVAL_AT_RISK';
        const severity = isBreach ? 'CRITICAL' : 'HIGH';

        void raiseAlert({
          tenantId,
          code,
          sourceModule: 'bus-ops',
          subjectType: 'TripSchedule',
          subjectId: trip.id,
          dedupeKey: `${code}:${trip.id}`,
          title: `Shift SLA ${isBreach ? 'BREACH' : 'Warning'}: ${evaluation.routeName} (${evaluation.delayMinutes}m delay)`,
          description: `Trip ${trip.tripNumber || trip.id.slice(0, 8)} carrying ${evaluation.totalPassengers} staff is delayed by ${evaluation.delayMinutes} min. Predicted destination arrival: ${evaluation.predictedArrivalTime || 'Unknown'}. Shift SLA: ${evaluation.latestArrivalTime || evaluation.plannedArrivalTime || 'Unknown'}.`,
          severity,
          context: {
            tripId: trip.id,
            tripNumber: trip.tripNumber,
            routeId: trip.routeId,
            routeName: evaluation.routeName,
            shiftType: trip.shiftType,
            delayMinutes: evaluation.delayMinutes,
            slaStatus: evaluation.slaStatus,
            totalPassengers: evaluation.totalPassengers,
            plannedArrival: evaluation.plannedArrivalTime,
            latestArrival: evaluation.latestArrivalTime,
            predictedArrival: evaluation.predictedArrivalTime,
            vehicleCode: evaluation.vehicleCode,
            driverName: evaluation.driverName,
          },
        });
      }
    }

    const totalActiveTrips = evaluations.length;
    const breachCount = evaluations.filter(e => e.slaStatus === 'SLA_BREACH').length;
    const atRiskCount = evaluations.filter(e => e.slaStatus === 'AT_RISK').length;
    const onTimeCount = evaluations.filter(e => e.slaStatus === 'ON_TIME').length;
    const onTimeRatePercent = totalActiveTrips > 0 ? Math.round((onTimeCount / totalActiveTrips) * 100) : 100;

    const totalImpactedPassengers = evaluations
      .filter(e => e.slaStatus === 'SLA_BREACH' || e.slaStatus === 'AT_RISK')
      .reduce((sum, e) => sum + e.totalPassengers, 0);

    return {
      totalActiveTrips,
      onTimeCount,
      atRiskCount,
      breachCount,
      onTimeRatePercent,
      totalImpactedPassengers,
      trips: evaluations,
      evaluatedAt: now.toISOString(),
    };
  });
}
