/**
 * src/lib/telematics/geofence-evaluator.ts
 *
 * Automated Route Stop Geofence Evaluator.
 *
 * Compares incoming GPS telemetry against scheduled RouteStops:
 *   - Approach detection (< 800m): sets approachedAt on TripStopVisit
 *   - Arrival detection (< 100m or custom geofenceRadiusM): sets enteredAt
 *   - Departure detection (exited arrival radius after entering): sets leftAt
 *   - Calculates real-time distance and estimated arrival time to final destination.
 */

import type { Prisma } from '@prisma/client';
import { raiseAlert } from '@/lib/alerts/raise';

export const DEFAULT_APPROACH_RADIUS_M = 800;
export const DEFAULT_ARRIVAL_RADIUS_M = 100;

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface RouteStopContext {
  id: string;
  stopName: string;
  sequence: number;
  gpsLat: number;
  gpsLng: number;
  geofenceRadiusM?: number | null;
  estimatedArrivalMins?: number | null;
}

export interface StopVisitStatus {
  stopId: string;
  stopName: string;
  sequence: number;
  approachedAt?: Date | null;
  enteredAt?: Date | null;
  leftAt?: Date | null;
  distanceMeters: number;
  state: 'PENDING' | 'APPROACHING' | 'AT_STOP' | 'DEPARTED';
}

/**
 * Calculates distance in meters between two lat/lng coordinates using the Haversine formula.
 */
export function calculateHaversineDistanceM(p1: Coordinates, p2: Coordinates): number {
  const R = 6371e3; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(p2.lat - p1.lat);
  const dLng = toRad(p2.lng - p1.lng);
  const lat1 = toRad(p1.lat);
  const lat2 = toRad(p2.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Evaluates current stop visit state against all route stops synchronously.
 */
export function evaluateStopVisitsSync(
  currentPos: Coordinates,
  stops: RouteStopContext[],
  existingVisits: Array<{
    stopId: string;
    approachedAt?: Date | null;
    enteredAt?: Date | null;
    leftAt?: Date | null;
  }> = [],
  occurredAt: Date = new Date(),
): StopVisitStatus[] {
  const visitMap = new Map(existingVisits.map((v) => [v.stopId, v]));

  return stops
    .sort((a, b) => a.sequence - b.sequence)
    .map((stop) => {
      const distance = calculateHaversineDistanceM(currentPos, {
        lat: stop.gpsLat,
        lng: stop.gpsLng,
      });

      const arrivalRadius = stop.geofenceRadiusM || DEFAULT_ARRIVAL_RADIUS_M;
      const approachRadius = Math.max(DEFAULT_APPROACH_RADIUS_M, arrivalRadius * 2);

      const existing = visitMap.get(stop.id);
      let approachedAt = existing?.approachedAt || null;
      let enteredAt = existing?.enteredAt || null;
      let leftAt = existing?.leftAt || null;

      let state: 'PENDING' | 'APPROACHING' | 'AT_STOP' | 'DEPARTED' = 'PENDING';

      if (enteredAt && leftAt) {
        state = 'DEPARTED';
      } else if (enteredAt) {
        if (distance > arrivalRadius + 30) {
          // Bus exited after entering
          leftAt = leftAt || occurredAt;
          state = 'DEPARTED';
        } else {
          state = 'AT_STOP';
        }
      } else {
        if (distance <= arrivalRadius) {
          enteredAt = enteredAt || occurredAt;
          approachedAt = approachedAt || occurredAt;
          state = 'AT_STOP';
        } else if (distance <= approachRadius) {
          approachedAt = approachedAt || occurredAt;
          state = 'APPROACHING';
        } else {
          state = 'PENDING';
        }
      }

      return {
        stopId: stop.id,
        stopName: stop.stopName,
        sequence: stop.sequence,
        approachedAt,
        enteredAt,
        leftAt,
        distanceMeters: distance,
        state,
      };
    });
}

/**
 * Evaluates and records stop visits in the database for an active trip.
 */
export async function evaluateAndRecordStopVisits(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ping: { latitude: number; longitude: number; speedKmh: number; occurredAt: Date },
  scheduleId: string,
  routeId: string,
) {
  // 1. Fetch route stops
  const stops = await tx.routeStop.findMany({
    where: {
      tenantId,
      routeId,
      gpsLat: { not: null },
      gpsLng: { not: null },
    },
    orderBy: { sequence: 'asc' },
  });

  if (stops.length === 0) return [];

  // 2. Fetch existing visits for this trip schedule
  const existingVisits = await tx.tripStopVisit.findMany({
    where: {
      tenantId,
      scheduleId,
    },
  });

  const stopContexts: RouteStopContext[] = stops.map((s) => ({
    id: s.id,
    stopName: s.stopName,
    sequence: s.sequence,
    gpsLat: s.gpsLat!,
    gpsLng: s.gpsLng!,
    geofenceRadiusM: s.geofenceRadiusM,
    estimatedArrivalMins: s.estimatedArrivalMins,
  }));

  const evaluated = evaluateStopVisitsSync(
    { lat: ping.latitude, lng: ping.longitude },
    stopContexts,
    existingVisits,
    ping.occurredAt,
  );

  // 3. Upsert changed visits
  for (const item of evaluated) {
    const existing = existingVisits.find((v) => v.stopId === item.stopId);

    const hasNewApproach = item.approachedAt && (!existing || !existing.approachedAt);
    const hasNewEntry = item.enteredAt && (!existing || !existing.enteredAt);
    const hasNewLeave = item.leftAt && (!existing || !existing.leftAt);

    if (hasNewApproach || hasNewEntry || hasNewLeave) {
      await tx.tripStopVisit.upsert({
        where: {
          scheduleId_stopId: {
            scheduleId,
            stopId: item.stopId,
          },
        },
        create: {
          tenantId,
          scheduleId,
          stopId: item.stopId,
          approachedAt: item.approachedAt,
          enteredAt: item.enteredAt,
          leftAt: item.leftAt,
        },
        update: {
          approachedAt: item.approachedAt || undefined,
          enteredAt: item.enteredAt || undefined,
          leftAt: item.leftAt || undefined,
        },
      });
    }
  }

  // 4. Update TripSchedule estimated arrival to final stop if in transit
  const lastStop = evaluated[evaluated.length - 1];
  if (lastStop && lastStop.state !== 'DEPARTED') {
    const distKm = lastStop.distanceMeters / 1000;
    const avgSpeed = Math.max(25, ping.speedKmh || 30);
    const remainingMinutes = Math.round((distKm / avgSpeed) * 60) + 2;
    const estimatedArrival = new Date(ping.occurredAt.getTime() + remainingMinutes * 60 * 1000);

    await tx.tripSchedule.update({
      where: { id: scheduleId },
      data: {
        estimatedArrival,
      },
    }).catch(() => {});
  }

  return evaluated;
}
