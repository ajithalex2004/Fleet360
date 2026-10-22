/**
 * src/lib/telematics/gateway-ingest.ts
 *
 * Telematics Gateway Webhook Ingestion Engine (Pattern A).
 *
 * Normalizes telemetry packets from multiple IoT gateways (Flespi, Teltonika,
 * Traccar, Geotab, Generic JSON), matches device IMEI to Fleet360 vehicles,
 * stores GPS pings, updates vehicle state (odometer, fuel, location), and
 * triggers real-time safety & exception alerts.
 */

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { withTenantRls } from '@/lib/rls';
import { raiseAlert } from '@/lib/alerts/raise';
import { evaluateAndRecordStopVisits } from '@/lib/telematics/geofence-evaluator';
import { checkAndTriggerPmOdometerAlerts } from '@/lib/telematics/pm-odometer-sync';
import { evaluateTelemetryTripTransitions } from '@/lib/bus-ops/telemetry-trip-transitions';
import { bestEffortInTx } from '@/lib/db/best-effort';
import { TRIP_IN_FLIGHT_STATUSES } from '@/lib/trip-status';

const PING_SAVEPOINT = 'telematics_ping';

/** A scheduled trip is matched to a ping only this close to its departure. */
const SCHEDULED_MATCH_BEFORE_MS = 2 * 60 * 60_000;
const SCHEDULED_MATCH_AFTER_MS = 6 * 60 * 60_000;
/** An in-flight trip older than this is stale, not the one being driven. */
const IN_FLIGHT_MAX_AGE_MS = 24 * 60 * 60_000;

/**
 * The trip a ping belongs to. Prefers a trip already under way (any
 * spelling — the driver app writes IN_PROGRESS, which the old lookup
 * skipped), most recent departure first; otherwise the scheduled trip
 * departing nearest the ping. The old lookup had no date window and no
 * order, so a vehicle with a stale SCHEDULED row from last week could have
 * today's pings — stop visits, ETA, auto-depart — applied to that trip.
 */
async function findActiveTripForPing(
  tx: Prisma.TransactionClient,
  tenantId: string,
  vehicleId: string,
  occurredAt: Date,
) {
  const select = { id: true, routeId: true, status: true } as const;
  const inFlight = await tx.tripSchedule.findFirst({
    where: {
      tenantId,
      vehicleId,
      deletedAt: null,
      status: { in: [...TRIP_IN_FLIGHT_STATUSES] },
      departureTime: { gte: new Date(occurredAt.getTime() - IN_FLIGHT_MAX_AGE_MS) },
    },
    orderBy: { departureTime: 'desc' },
    select,
  });
  if (inFlight) return inFlight;
  const candidates = await tx.tripSchedule.findMany({
    where: {
      tenantId,
      vehicleId,
      deletedAt: null,
      status: 'SCHEDULED',
      departureTime: {
        gte: new Date(occurredAt.getTime() - SCHEDULED_MATCH_AFTER_MS),
        lte: new Date(occurredAt.getTime() + SCHEDULED_MATCH_BEFORE_MS),
      },
    },
    orderBy: { departureTime: 'asc' },
    select: { ...select, departureTime: true },
    take: 20,
  });
  let best: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    if (!best || Math.abs(c.departureTime.getTime() - occurredAt.getTime())
        < Math.abs(best.departureTime.getTime() - occurredAt.getTime())) best = c;
  }
  return best;
}

export interface NormalizedTelemetryPing {
  imei: string;
  occurredAt: Date;
  latitude: number;
  longitude: number;
  speedKmh: number;
  headingDeg: number;
  altitudeM?: number;
  satellites?: number;
  accuracyM?: number;
  ignition?: boolean;
  odometerKm?: number;
  fuelLevelPercent?: number;
  batteryVoltage?: number;
  engineRpm?: number;
  coolantTempC?: number;
  sosPanic?: boolean;
  harshBraking?: boolean;
  harshAcceleration?: boolean;
  rawPayload?: Record<string, unknown>;
}

export interface IngestResult {
  totalReceived: number;
  processed: number;
  matchedVehicles: number;
  unmatchedImeis: string[];
  alertsTriggered: number;
  errors: string[];
}

/**
 * Normalizes an incoming raw JSON object or packet into the standard NormalizedTelemetryPing schema.
 * Handles Flespi, Teltonika, Traccar, and Generic formats.
 */
export function normalizeTelemetryPacket(raw: Record<string, unknown>): NormalizedTelemetryPing | null {
  if (!raw || typeof raw !== 'object') return null;

  // The nested `position`/`location` sub-objects and the vendor-specific
  // io/attributes/params bag are all genuinely unstructured (they vary by
  // gateway vendor), so they're narrowed once here rather than cast at each
  // of the many read sites below.
  const position = raw.position as Record<string, unknown> | undefined;
  const location = raw.location as Record<string, unknown> | undefined;

  // 1. Extract IMEI / Device Identifier
  const imei = String(
    raw.imei ||
    raw.deviceId ||
    raw.device_id ||
    raw.ident ||
    raw.id ||
    raw.trackerId ||
    raw.serial ||
    ''
  ).trim();

  if (!imei) return null;

  // 2. Extract Timestamp
  let occurredAt: Date = new Date();
  if (raw.timestamp) {
    if (typeof raw.timestamp === 'number') {
      // Check if unix seconds vs milliseconds
      occurredAt = new Date(raw.timestamp < 1e11 ? raw.timestamp * 1000 : raw.timestamp);
    } else {
      occurredAt = new Date(raw.timestamp as string);
    }
  } else if (raw.occurredAt || raw.occurred_at || raw.fixTime || raw.time || raw.event_time) {
    occurredAt = new Date((raw.occurredAt || raw.occurred_at || raw.fixTime || raw.time || raw.event_time) as string);
  }

  if (isNaN(occurredAt.getTime())) {
    occurredAt = new Date();
  }

  // 3. Extract Coordinates
  const latitude = Number(
    raw.latitude ??
    raw.lat ??
    raw['position.latitude'] ??
    position?.latitude ??
    location?.lat ??
    raw.y
  );

  const longitude = Number(
    raw.longitude ??
    raw.lng ??
    raw.lon ??
    raw['position.longitude'] ??
    position?.longitude ??
    location?.lng ??
    raw.x
  );

  if (isNaN(latitude) || isNaN(longitude) || (latitude === 0 && longitude === 0)) {
    return null; // Invalid coordinate packet
  }

  // 4. Movement & Orientation
  const speedKmh = Number(
    raw.speedKmh ??
    raw.speed_kmh ??
    raw.speed ??
    raw['position.speed'] ??
    position?.speed ??
    0
  );

  const headingDeg = Number(
    raw.headingDeg ??
    raw.heading_deg ??
    raw.heading ??
    raw.angle ??
    raw.course ??
    raw['position.direction'] ??
    position?.direction ??
    0
  );

  const altitudeM = raw.altitude ?? raw['position.altitude'] ?? position?.altitude ? Number(raw.altitude ?? raw['position.altitude'] ?? position?.altitude) : undefined;
  const satellites = raw.satellites ?? raw['position.satellites'] ?? position?.satellites ? Number(raw.satellites ?? raw['position.satellites'] ?? position?.satellites) : undefined;
  const accuracyM = raw.accuracy ?? raw.hdop ? Number(raw.accuracy ?? raw.hdop) : undefined;

  // 5. Vehicle State & CAN-bus
  const io = (raw.io || raw.attributes || raw.params || {}) as Record<string, unknown>;
  const ignition = (
    raw.ignition !== undefined ? Boolean(raw.ignition) :
    raw['engine.ignition.status'] !== undefined ? Boolean(raw['engine.ignition.status']) :
    io.ignition !== undefined ? Boolean(io.ignition) :
    io.acc !== undefined ? Boolean(io.acc) :
    raw.acc !== undefined ? Boolean(raw.acc) :
    undefined
  );

  const odometerKm = (
    raw.odometerKm ??
    raw.odometer ??
    raw['can.vehicle.mileage'] ??
    raw.vehicle_mileage ??
    io.odometer ??
    io.total_distance ??
    io['can.vehicle.mileage']
  ) ? Number(
    raw.odometerKm ??
    raw.odometer ??
    raw['can.vehicle.mileage'] ??
    raw.vehicle_mileage ??
    io.odometer ??
    io.total_distance ??
    io['can.vehicle.mileage']
  ) : undefined;

  const fuelLevelPercent = (
    raw.fuelLevelPercent ??
    raw.fuelLevel ??
    raw.fuel_level ??
    raw['can.fuel.level'] ??
    io.fuel ??
    io.fuelLevel ??
    io['can.fuel.level']
  ) ? Number(
    raw.fuelLevelPercent ??
    raw.fuelLevel ??
    raw.fuel_level ??
    raw['can.fuel.level'] ??
    io.fuel ??
    io.fuelLevel ??
    io['can.fuel.level']
  ) : undefined;

  const batteryVoltage = (
    raw.batteryVoltage ??
    raw.battery_voltage ??
    raw['battery.voltage'] ??
    io.battery ??
    io.battery_voltage ??
    io.batteryVoltage ??
    io.power
  ) ? Number(
    raw.batteryVoltage ??
    raw.battery_voltage ??
    raw['battery.voltage'] ??
    io.battery ??
    io.battery_voltage ??
    io.batteryVoltage ??
    io.power
  ) : undefined;

  const engineRpm = (
    raw.engineRpm ??
    raw.engine_rpm ??
    raw['can.engine.rpm'] ??
    io.rpm ??
    io.engine_rpm ??
    io.engineRpm
  ) ? Number(
    raw.engineRpm ??
    raw.engine_rpm ??
    raw['can.engine.rpm'] ??
    io.rpm ??
    io.engine_rpm ??
    io.engineRpm
  ) : undefined;

  const coolantTempC = (
    raw.coolantTempC ??
    raw.coolant_temp ??
    raw['can.engine.coolant.temperature'] ??
    io.coolant_temp ??
    io.coolantTemp ??
    io.temp
  ) ? Number(
    raw.coolantTempC ??
    raw.coolant_temp ??
    raw['can.engine.coolant.temperature'] ??
    io.coolant_temp ??
    io.coolantTemp ??
    io.temp
  ) : undefined;

  // 6. Safety Events
  const sosPanic = Boolean(
    raw.sosPanic ||
    raw.sos ||
    raw.panic ||
    raw.alarm === 'sos' ||
    io.sos ||
    io.panic ||
    io.alarm === 'sos'
  );

  const harshBraking = Boolean(
    raw.harshBraking ||
    raw.harsh_braking ||
    raw.event === 'harsh_braking' ||
    io.harsh_braking
  );

  const harshAcceleration = Boolean(
    raw.harshAcceleration ||
    raw.harsh_acceleration ||
    raw.event === 'harsh_acceleration' ||
    io.harsh_acceleration
  );

  return {
    imei,
    occurredAt,
    latitude,
    longitude,
    speedKmh: Math.max(0, speedKmh),
    headingDeg: Math.max(0, Math.min(360, headingDeg)),
    altitudeM,
    satellites,
    accuracyM,
    ignition,
    odometerKm: odometerKm && !isNaN(odometerKm) ? (odometerKm > 10000000 ? odometerKm / 1000 : odometerKm) : undefined,
    fuelLevelPercent: fuelLevelPercent && !isNaN(fuelLevelPercent) ? Math.min(100, Math.max(0, fuelLevelPercent)) : undefined,
    batteryVoltage,
    engineRpm,
    coolantTempC,
    sosPanic,
    harshBraking,
    harshAcceleration,
    rawPayload: raw,
  };
}

/**
 * Normalizes raw input containing either a single JSON packet or an array of packets.
 */
export function normalizeTelemetryBatch(input: unknown): NormalizedTelemetryPing[] {
  if (!input) return [];

  let items: unknown[] = [];
  if (Array.isArray(input)) {
    items = input;
  } else if (typeof input === 'object') {
    // Check if wrapped in data or records
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.data)) items = obj.data;
    else if (Array.isArray(obj.records)) items = obj.records;
    else if (Array.isArray(obj.pings)) items = obj.pings;
    else items = [obj];
  }

  return items
    .map((item) => normalizeTelemetryPacket(item as Record<string, unknown>))
    .filter((p): p is NormalizedTelemetryPing => p !== null);
}

/**
 * Ingests a batch of normalized telemetry pings for a specific tenant or auto-resolved tenant.
 */
export async function processTelemetryBatch(
  tenantId: string,
  pings: NormalizedTelemetryPing[],
): Promise<IngestResult> {
  const result: IngestResult = {
    totalReceived: pings.length,
    processed: 0,
    matchedVehicles: 0,
    unmatchedImeis: [],
    alertsTriggered: 0,
    errors: [],
  };

  if (pings.length === 0) return result;

  return withTenantRls(prisma, tenantId, async (tx) => {
    // 1. Fetch vehicles matching these device IDs / IMEIs in the tenant
    const uniqueImeis = Array.from(new Set(pings.map((p) => p.imei)));

    const vehicles = await tx.vehicle.findMany({
      where: {
        tenantId,
        OR: [
          { deviceId: { in: uniqueImeis } },
          { vehicleCode: { in: uniqueImeis } },
          { licensePlate: { in: uniqueImeis } },
        ],
      },
      select: {
        id: true,
        vehicleCode: true,
        licensePlate: true,
        deviceId: true,
        odometerReading: true,
        fuelLevel: true,
      },
    });

    const vehicleMap = new Map<string, typeof vehicles[0]>();
    for (const v of vehicles) {
      if (v.deviceId) vehicleMap.set(v.deviceId.trim().toLowerCase(), v);
      if (v.vehicleCode) vehicleMap.set(v.vehicleCode.trim().toLowerCase(), v);
      if (v.licensePlate) vehicleMap.set(v.licensePlate.trim().toLowerCase(), v);
    }

    const unmatchedSet = new Set<string>();

    for (const ping of pings) {
      const key = ping.imei.trim().toLowerCase();
      const vehicle = vehicleMap.get(key);

      if (!vehicle) {
        unmatchedSet.add(ping.imei);
        continue;
      }

      // Each ping runs in its own savepoint. A failed statement aborts the
      // whole Postgres transaction (25P02); catching it without rolling back
      // made every later ping fail and the COMMIT silently roll back the
      // entire batch while the result still reported most pings processed.
      const counters = { processed: result.processed, matched: result.matchedVehicles, alerts: result.alertsTriggered };
      await tx.$executeRawUnsafe(`SAVEPOINT ${PING_SAVEPOINT}`);
      try {

        // 2. Insert into BusGpsPing
        await tx.busGpsPing.create({
          data: {
            tenantId,
            vehicleId: vehicle.id,
            latitude: ping.latitude,
            longitude: ping.longitude,
            speedKmh: ping.speedKmh,
            headingDeg: ping.headingDeg,
            accuracyM: ping.accuracyM,
            occurredAt: ping.occurredAt,
            source: 'GATEWAY',
          },
        });

        // 3. Update Vehicle current state
        const updateData: Prisma.VehicleUpdateInput = {
          updatedAt: new Date(),
        };

        if (ping.odometerKm !== undefined) {
          updateData.odometerReading = BigInt(Math.round(ping.odometerKm));
          updateData.currentMileage = BigInt(Math.round(ping.odometerKm));
        }

        if (ping.fuelLevelPercent !== undefined) {
          updateData.fuelLevel = ping.fuelLevelPercent;
        }

        await tx.vehicle.update({
          where: { id: vehicle.id },
          data: updateData,
        });

        result.processed++;
        result.matchedVehicles++;

        // 4. Geofencing & Operational Automation (Phase 2)
        // A. Active Trip Stop Visits & Live Destination ETA
        const activeTrip = await findActiveTripForPing(tx, tenantId, vehicle.id, ping.occurredAt);

        if (activeTrip && activeTrip.routeId) {
          // Optional enrichment, each in a nested savepoint: a failure is
          // logged and undone without losing the ping itself. Awaited — a
          // `void` call on `tx` could run after the commit ("Transaction
          // already closed") and its writes were lost.
          await bestEffortInTx(tx, 'telematics-ingest.stop-visits', () => evaluateAndRecordStopVisits(
            tx,
            tenantId,
            {
              latitude: ping.latitude,
              longitude: ping.longitude,
              speedKmh: ping.speedKmh,
              occurredAt: ping.occurredAt,
            },
            activeTrip.id,
            activeTrip.routeId as string,
          ));

          // Evaluate auto-depart and auto-complete transitions.
          // Note: TelemetryPing has no `headingDeg`/`source` fields (grep
          // confirms telemetry-trip-transitions.ts never reads either), so
          // they're omitted rather than passed and silently dropped.
          await bestEffortInTx(tx, 'telematics-ingest.trip-transitions', () => evaluateTelemetryTripTransitions(tx, {
            tenantId,
            vehicleId: vehicle.id,
            scheduleId: activeTrip.id,
            latitude: ping.latitude,
            longitude: ping.longitude,
            speedKmh: ping.speedKmh,
            accuracyM: ping.accuracyM,
            occurredAt: ping.occurredAt,
          }));
        }

        // B. Preventive Maintenance (PM) Odometer Threshold Alerts
        if (ping.odometerKm !== undefined && ping.odometerKm > 0) {
          const odometerKm = ping.odometerKm;
          await bestEffortInTx(tx, 'telematics-ingest.pm-odometer', () => checkAndTriggerPmOdometerAlerts(
            tx,
            tenantId,
            vehicle,
            odometerKm,
          ));
        }

        // 5. Check & Trigger Event Alerts
        // A. SOS / Panic Button Alert
        if (ping.sosPanic) {
          result.alertsTriggered++;
          // Awaited and NOT best-effort: raiseAlert writes to the outbox on
          // this transaction, so a `void` call was lost after the commit. If
          // it fails, the ping fails with it and the gateway sees the error
          // and retries, rather than an SOS vanishing.
          await raiseAlert({
            tenantId,
            code: 'SOS_PANIC_TRIGGERED',
            sourceModule: 'telematics',
            subjectType: 'Vehicle',
            subjectId: vehicle.id,
            severity: 'CRITICAL',
            title: `EMERGENCY SOS: Vehicle ${vehicle.vehicleCode || vehicle.licensePlate}`,
            description: `Driver emergency panic switch triggered at Lat: ${ping.latitude.toFixed(5)}, Lng: ${ping.longitude.toFixed(5)}. Speed: ${ping.speedKmh.toFixed(0)} km/h.`,
            dedupeKey: `SOS_PANIC:${vehicle.id}:${Math.floor(ping.occurredAt.getTime() / 60000)}`,
            // raiseAlert swallows publish errors by default — opt into
            // strict mode so a failed SOS really fails the ping.
            throwOnError: true,
          });
        }

        // B. Excessive Speeding Alert (> 120 km/h)
        if (ping.speedKmh > 120) {
          result.alertsTriggered++;
          await bestEffortInTx(tx, 'telematics-ingest.speeding-alert', () => raiseAlert({
            tenantId,
            code: 'OVERSPEEDING_DETECTED',
            sourceModule: 'telematics',
            subjectType: 'Vehicle',
            subjectId: vehicle.id,
            severity: 'HIGH',
            title: `Speeding Alert: ${vehicle.vehicleCode || vehicle.licensePlate} (${ping.speedKmh.toFixed(0)} km/h)`,
            description: `Vehicle exceeded commercial speed threshold (120 km/h) with measured speed of ${ping.speedKmh.toFixed(0)} km/h.`,
            dedupeKey: `OVERSPEEDING:${vehicle.id}:${Math.floor(ping.occurredAt.getTime() / 300000)}`,
          }));
        }
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${PING_SAVEPOINT}`);
      } catch (err) {
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${PING_SAVEPOINT}`);
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${PING_SAVEPOINT}`);
        result.processed = counters.processed;
        result.matchedVehicles = counters.matched;
        result.alertsTriggered = counters.alerts;
        result.errors.push(err instanceof Error ? err.message : 'Ping ingestion failed');
      }
    }

    result.unmatchedImeis = Array.from(unmatchedSet);
    return result;
  });
}
