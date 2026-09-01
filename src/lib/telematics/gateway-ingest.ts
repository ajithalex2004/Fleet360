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
import { withTenantRls } from '@/lib/rls';
import { raiseAlert } from '@/lib/alerts/raise';
import { evaluateAndRecordStopVisits } from '@/lib/telematics/geofence-evaluator';
import { checkAndTriggerPmOdometerAlerts } from '@/lib/telematics/pm-odometer-sync';
import { evaluateTelemetryTripTransitions } from '@/lib/bus-ops/telemetry-trip-transitions';

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
export function normalizeTelemetryPacket(raw: Record<string, any>): NormalizedTelemetryPing | null {
  if (!raw || typeof raw !== 'object') return null;

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
      occurredAt = new Date(raw.timestamp);
    }
  } else if (raw.occurredAt || raw.occurred_at || raw.fixTime || raw.time || raw.event_time) {
    occurredAt = new Date(raw.occurredAt || raw.occurred_at || raw.fixTime || raw.time || raw.event_time);
  }

  if (isNaN(occurredAt.getTime())) {
    occurredAt = new Date();
  }

  // 3. Extract Coordinates
  const latitude = Number(
    raw.latitude ??
    raw.lat ??
    raw['position.latitude'] ??
    raw.position?.latitude ??
    raw.location?.lat ??
    raw.y
  );

  const longitude = Number(
    raw.longitude ??
    raw.lng ??
    raw.lon ??
    raw['position.longitude'] ??
    raw.position?.longitude ??
    raw.location?.lng ??
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
    raw.position?.speed ??
    0
  );

  const headingDeg = Number(
    raw.headingDeg ??
    raw.heading_deg ??
    raw.heading ??
    raw.angle ??
    raw.course ??
    raw['position.direction'] ??
    raw.position?.direction ??
    0
  );

  const altitudeM = raw.altitude ?? raw['position.altitude'] ?? raw.position?.altitude ? Number(raw.altitude ?? raw['position.altitude'] ?? raw.position?.altitude) : undefined;
  const satellites = raw.satellites ?? raw['position.satellites'] ?? raw.position?.satellites ? Number(raw.satellites ?? raw['position.satellites'] ?? raw.position?.satellites) : undefined;
  const accuracyM = raw.accuracy ?? raw.hdop ? Number(raw.accuracy ?? raw.hdop) : undefined;

  // 5. Vehicle State & CAN-bus
  const io = raw.io || raw.attributes || raw.params || {};
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

  let items: any[] = [];
  if (Array.isArray(input)) {
    items = input;
  } else if (typeof input === 'object') {
    // Check if wrapped in data or records
    const obj = input as Record<string, any>;
    if (Array.isArray(obj.data)) items = obj.data;
    else if (Array.isArray(obj.records)) items = obj.records;
    else if (Array.isArray(obj.pings)) items = obj.pings;
    else items = [obj];
  }

  return items
    .map((item) => normalizeTelemetryPacket(item))
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
      try {
        const key = ping.imei.trim().toLowerCase();
        const vehicle = vehicleMap.get(key);

        if (!vehicle) {
          unmatchedSet.add(ping.imei);
          continue;
        }

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
        const updateData: Record<string, any> = {
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
        const activeTrip = await tx.tripSchedule.findFirst({
          where: {
            tenantId,
            vehicleId: vehicle.id,
            status: { in: ['SCHEDULED', 'DEPARTED', 'IN_TRANSIT'] },
          },
          select: {
            id: true,
            routeId: true,
            status: true,
          },
        });

        if (activeTrip && activeTrip.routeId) {
          await evaluateAndRecordStopVisits(
            tx,
            tenantId,
            {
              latitude: ping.latitude,
              longitude: ping.longitude,
              speedKmh: ping.speedKmh,
              occurredAt: ping.occurredAt,
            },
            activeTrip.id,
            activeTrip.routeId,
          ).catch((err) => console.warn('[telematics-ingest] Stop visit eval failed:', err));

          // Evaluate auto-depart and auto-complete transitions
          void evaluateTelemetryTripTransitions(tx as any, {
            tenantId,
            vehicleId: vehicle.id,
            scheduleId: activeTrip.id,
            latitude: ping.latitude,
            longitude: ping.longitude,
            speedKmh: ping.speedKmh,
            headingDeg: ping.headingDeg,
            accuracyM: ping.accuracyM,
            occurredAt: ping.occurredAt,
            source: 'GATEWAY',
          } as any).catch((err) => console.warn('[telematics-ingest] Trip transition eval failed:', err));
        }

        // B. Preventive Maintenance (PM) Odometer Threshold Alerts
        if (ping.odometerKm !== undefined && ping.odometerKm > 0) {
          void checkAndTriggerPmOdometerAlerts(
            tx,
            tenantId,
            vehicle,
            ping.odometerKm,
          ).catch((err) => console.warn('[telematics-ingest] PM alert check failed:', err));
        }

        // 5. Check & Trigger Event Alerts
        // A. SOS / Panic Button Alert
        if (ping.sosPanic) {
          result.alertsTriggered++;
          void raiseAlert({
            tenantId,
            code: 'SOS_PANIC_TRIGGERED',
            sourceModule: 'telematics',
            subjectType: 'Vehicle',
            subjectId: vehicle.id,
            severity: 'CRITICAL',
            title: `EMERGENCY SOS: Vehicle ${vehicle.vehicleCode || vehicle.licensePlate}`,
            description: `Driver emergency panic switch triggered at Lat: ${ping.latitude.toFixed(5)}, Lng: ${ping.longitude.toFixed(5)}. Speed: ${ping.speedKmh.toFixed(0)} km/h.`,
            dedupeKey: `SOS_PANIC:${vehicle.id}:${Math.floor(ping.occurredAt.getTime() / 60000)}`,
          }).catch((err) => console.warn('[telematics-ingest] SOS alert error:', err));
        }

        // B. Excessive Speeding Alert (> 120 km/h)
        if (ping.speedKmh > 120) {
          result.alertsTriggered++;
          void raiseAlert({
            tenantId,
            code: 'OVERSPEEDING_DETECTED',
            sourceModule: 'telematics',
            subjectType: 'Vehicle',
            subjectId: vehicle.id,
            severity: 'HIGH',
            title: `Speeding Alert: ${vehicle.vehicleCode || vehicle.licensePlate} (${ping.speedKmh.toFixed(0)} km/h)`,
            description: `Vehicle exceeded commercial speed threshold (120 km/h) with measured speed of ${ping.speedKmh.toFixed(0)} km/h.`,
            dedupeKey: `OVERSPEEDING:${vehicle.id}:${Math.floor(ping.occurredAt.getTime() / 300000)}`,
          }).catch((err) => console.warn('[telematics-ingest] Speeding alert error:', err));
        }
      } catch (err) {
        result.errors.push(err instanceof Error ? err.message : 'Ping ingestion failed');
      }
    }

    result.unmatchedImeis = Array.from(unmatchedSet);
    return result;
  });
}
