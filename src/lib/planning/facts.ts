/**
 * Facts loader for the Planning Constraint Engine.
 *
 * Bridges the DB to the pure `evaluatePlan()` evaluator. Given a plan
 * input (existing trip ids + a proposed trip description), returns
 * fully-denormalised `PlanFacts`:
 *   - trip stops / vehicles / times attached to each trip
 *   - all enabled constraints for the tenant
 *   - the geometry of every zone referenced by ZONE_VEHICLE_RESTRICTION
 *
 * Kept separate from the evaluator so tests can synthesise facts without
 * hitting Postgres and future callers (optimiser, bulk plan scoring) can
 * batch-load the shared parts once.
 */

import { prisma as defaultPrisma } from '@/lib/prisma';
import type { PrismaClient } from '@prisma/client';
import type {
  PlanFacts,
  PlanTripFacts,
  PlanningConstraintFacts,
  ZoneFacts,
} from './evaluate-plan';
import { normaliseZoneFromPlaceRow } from './evaluate-plan';

/**
 * A trip that already exists in the DB — the loader fetches its details.
 * `role` tells the evaluator how to treat it (source of a merge, etc).
 */
export type ExistingTripInput = {
  tripId: string;
  role: 'source' | 'merged' | 'standalone';
};

/**
 * A trip that does NOT exist yet — the optimiser is proposing it. Caller
 * supplies all facts inline. Stops must be denormalised at call time
 * because there's no route_stop row for a plan-only trip.
 */
export type ProposedTripInput = {
  id: string;
  role: 'source' | 'merged' | 'standalone';
  routeId: string;
  vehicleId: string | null;
  driverId: string | null;
  departureTime: Date;
  arrivalTime: Date | null;
  latestArrivalTime: Date | null;
  confirmedCount: number;
  stops: Array<{ placeId: string; lat: number; lng: number; sequence: number }>;
  /** Optional vehicle overrides (else loader looks it up by id). */
  vehicleOverride?: {
    seatingCapacity: number | null;
    vehicleGroup: string | null;
  };
};

export type LoadPlanFactsInput = {
  tenantId: string;
  tenantTimezone?: string;
  existing?: ExistingTripInput[];
  proposed?: ProposedTripInput[];
  /**
   * Prisma client to query with. Defaults to the app-wide singleton;
   * tests inject a mocked client here. Kept as the last positional
   * parameter (not on the shared input type) so production callers
   * don't have to think about it.
   */
};

export async function loadPlanFacts(
  input: LoadPlanFactsInput,
  prisma: PrismaClient = defaultPrisma
): Promise<PlanFacts> {
  const tenantTimezone = input.tenantTimezone ?? 'Asia/Dubai';
  const existingIds = (input.existing ?? []).map((e) => e.tripId);

  const [existingTrips, constraints] = await Promise.all([
    existingIds.length === 0
      ? Promise.resolve([])
      : prisma.tripSchedule.findMany({
          where: { id: { in: existingIds }, tenantId: input.tenantId, deletedAt: null },
          include: {
            route: {
              select: {
                id: true,
                stops: {
                  select: {
                    placeId: true,
                    gpsLat: true,
                    gpsLng: true,
                    sequence: true,
                  },
                  orderBy: { sequence: 'asc' },
                },
              },
            },
          },
        }),
    loadConstraintsForTenant(prisma, input.tenantId),
  ]);

  const vehicleIds = new Set<string>();
  for (const t of existingTrips) if (t.vehicleId) vehicleIds.add(t.vehicleId);
  for (const p of input.proposed ?? []) if (p.vehicleId && !p.vehicleOverride) vehicleIds.add(p.vehicleId);

  const vehicles =
    vehicleIds.size === 0
      ? []
      : await prisma.vehicle.findMany({
          where: { id: { in: [...vehicleIds] }, tenantId: input.tenantId, deletedAt: null },
          select: { id: true, seatingCapacity: true, vehicleGroup: true },
        });
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));

  const trips: PlanTripFacts[] = [];

  for (const t of existingTrips) {
    const role = input.existing!.find((e) => e.tripId === t.id)!.role;
    const vehicle = t.vehicleId ? vehicleById.get(t.vehicleId) ?? null : null;
    trips.push({
      id: t.id,
      role,
      routeId: t.routeId,
      vehicleId: t.vehicleId,
      driverId: t.driverId,
      departureTime: t.departureTime,
      arrivalTime: t.arrivalTime,
      latestArrivalTime: t.latestArrivalTime,
      confirmedCount: t.confirmedCount ?? 0,
      stops: (t.route.stops ?? [])
        .filter((s) => s.gpsLat != null && s.gpsLng != null && s.placeId != null)
        .map((s) => ({
          placeId: s.placeId as string,
          lat: s.gpsLat as number,
          lng: s.gpsLng as number,
          sequence: s.sequence,
        })),
      vehicle: vehicle
        ? {
            id: vehicle.id,
            seatingCapacity: vehicle.seatingCapacity,
            vehicleGroup: vehicle.vehicleGroup,
          }
        : null,
    });
  }

  for (const p of input.proposed ?? []) {
    const vehicleFacts = p.vehicleOverride
      ? { id: p.vehicleId ?? p.id, ...p.vehicleOverride }
      : p.vehicleId
        ? vehicleById.get(p.vehicleId) ?? null
        : null;
    trips.push({
      id: p.id,
      role: p.role,
      routeId: p.routeId,
      vehicleId: p.vehicleId,
      driverId: p.driverId,
      departureTime: p.departureTime,
      arrivalTime: p.arrivalTime,
      latestArrivalTime: p.latestArrivalTime,
      confirmedCount: p.confirmedCount,
      stops: p.stops,
      vehicle: vehicleFacts
        ? {
            id: vehicleFacts.id,
            seatingCapacity: vehicleFacts.seatingCapacity,
            vehicleGroup: vehicleFacts.vehicleGroup,
          }
        : null,
    });
  }

  const zones = await loadZonesReferencedBy(prisma, input.tenantId, constraints);

  return { trips, constraints, zones, tenantTimezone };
}

async function loadConstraintsForTenant(
  prisma: PrismaClient,
  tenantId: string
): Promise<PlanningConstraintFacts[]> {
  const rows = await prisma.planningConstraint.findMany({
    where: { tenantId, deletedAt: null, isEnabled: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    action: (r.action === 'WARN' || r.action === 'PENALTY' ? r.action : 'BLOCK') as
      | 'BLOCK'
      | 'WARN'
      | 'PENALTY',
    penaltyScore: r.penaltyScore ? Number(r.penaltyScore) : null,
    params: (r.params ?? {}) as Record<string, unknown>,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    reason: r.reason,
    isEnabled: r.isEnabled,
  }));
}

async function loadZonesReferencedBy(
  prisma: PrismaClient,
  tenantId: string,
  constraints: PlanningConstraintFacts[]
): Promise<ZoneFacts> {
  const zoneIds = new Set<string>();
  for (const c of constraints) {
    const zid = (c.params as { zonePlaceId?: string }).zonePlaceId;
    if (typeof zid === 'string' && zid.length > 0) zoneIds.add(zid);
  }
  if (zoneIds.size === 0) return new Map();

  const places = await prisma.place.findMany({
    where: { id: { in: [...zoneIds] }, tenantId, deletedAt: null, active: true },
    select: {
      id: true,
      name: true,
      shape: true,
      polygon: true,
      centerLat: true,
      centerLng: true,
      radiusM: true,
    },
  });
  const map: ZoneFacts = new Map();
  for (const p of places) {
    const shape = normaliseZoneFromPlaceRow(p);
    if (shape) map.set(p.id, shape);
  }
  return map;
}
