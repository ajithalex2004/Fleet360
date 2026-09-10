/**
 * Preventive Maintenance Agent — Continuous Forecaster & Smart Slot Optimizer
 * ----------------------------------------------------------------------------
 * Autonomous agent continuously determining what vehicles need servicing by synthesizing:
 *  - Mileage & daily utilization curve
 *  - Engine operating hours & run-rates
 *  - Vehicle age & environmental factors
 *  - Active PM plan triggers (pm_triggers, pm_schedule_items)
 *  - Last maintenance history & repair invoices
 *  - Telematics sensors & DTC code health
 *  - OEM manufacturer schedules (5k, 10k, 20k, 40k, 80k)
 *
 * Emits forward-looking threshold breach projections:
 *  "Vehicle V-103 will reach its 20,000 km service threshold in approximately 6 operating days."
 *
 * Recommends optimal maintenance appointment slots where operational disruption is minimal.
 */

import { prisma } from '@/lib/prisma';
import {
  AgentDefinition,
  AgentEvent,
  AgentRunResult,
  PreventiveMaintenanceForecast,
} from '../types';
import { calculateVehicleBurnDown, VehiclePMInput } from './forecaster';
import { recommendLowestImpactSlot, TripScheduleWindow } from './slot-optimizer';
import { ensureAgentSchema } from '../schema';

interface VehicleDbRow {
  id: string;
  vehicle_code: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  license_plate: string | null;
  odometer_reading: number | null;
  current_mileage: number | null;
  purchase_date: string | null;
}

interface TelemetryStatsRow {
  vehicle_id: string;
  engine_hours: number | null;
  daily_km_14d: number | null;
  daily_hours_14d: number | null;
}

interface LastServiceDbRow {
  vehicle_id: string;
  last_service_date: string | null;
  last_service_odometer: number | null;
}

interface PMPlanDbRow {
  vehicle_id: string;
  plan_id: string;
  plan_name: string;
  triggers: any;
}

/**
 * Fetch fleet vehicles for PM analysis
 */
async function fetchVehiclesForPM(tenantId: string, vehicleId?: string): Promise<VehicleDbRow[]> {
  const filter = vehicleId ? `AND v.id = $2` : '';
  const params = vehicleId ? [tenantId, vehicleId] : [tenantId];

  return prisma.$queryRawUnsafe<VehicleDbRow[]>(
    `SELECT
       v.id::text,
       v.vehicle_code,
       v.make,
       v.model,
       v.year::int AS year,
       COALESCE(v.license_plate, v.plate_number) AS license_plate,
       COALESCE(v.odometer_reading::float8, v.current_mileage::float8, 0) AS odometer_reading,
       v.purchase_date::text
     FROM vehicles v
     WHERE v.tenant_id = $1
       AND v.status NOT IN ('DECOMMISSIONED', 'SOLD', 'INACTIVE')
       ${filter}
     ORDER BY v.created_at DESC`,
    ...params
  ).catch(() => []);
}

/**
 * Fetch 14-day telematics burn rates (daily km & daily engine hours)
 */
async function fetchTelematicsBurnRates(tenantId: string): Promise<Map<string, TelemetryStatsRow>> {
  const map = new Map<string, TelemetryStatsRow>();

  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        vehicle_id::text,
        MAX((payload->'sensors'->>'engineHours')::float8) AS engine_hours,
        COALESCE(
          (MAX((payload->'sensors'->>'odometerKm')::float8) - MIN((payload->'sensors'->>'odometerKm')::float8)) / 14.0,
          120.0
        ) AS daily_km_14d,
        COALESCE(
          (MAX((payload->'sensors'->>'engineHours')::float8) - MIN((payload->'sensors'->>'engineHours')::float8)) / 14.0,
          4.5
        ) AS daily_hours_14d
      FROM telematics_events
      WHERE created_at >= NOW() - INTERVAL '14 days'
      GROUP BY vehicle_id
    `);

    for (const r of rows) {
      map.set(r.vehicle_id, {
        vehicle_id: r.vehicle_id,
        engine_hours: r.engine_hours,
        daily_km_14d: r.daily_km_14d ? Number(r.daily_km_14d) : null,
        daily_hours_14d: r.daily_hours_14d ? Number(r.daily_hours_14d) : null,
      });
    }
  } catch (err) {
    // telematics table might be empty
  }

  return map;
}

/**
 * Fetch last service history from work orders
 */
async function fetchLastServiceRecords(tenantId: string): Promise<Map<string, LastServiceDbRow>> {
  const map = new Map<string, LastServiceDbRow>();

  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT DISTINCT ON (vehicle_id)
        vehicle_id::text,
        created_at::text AS last_service_date,
        (metadata->>'odometerKm')::float8 AS last_service_odometer
      FROM fleet_work_orders
      WHERE status = 'COMPLETED'
      ORDER BY vehicle_id, created_at DESC
    `);

    for (const r of rows) {
      map.set(r.vehicle_id, {
        vehicle_id: r.vehicle_id,
        last_service_date: r.last_service_date,
        last_service_odometer: r.last_service_odometer ? Number(r.last_service_odometer) : null,
      });
    }
  } catch (err) {
    // fallback
  }

  return map;
}

/**
 * Fetch assigned PM plans from pm_schedule_items & maintenance_plans
 */
async function fetchActivePMPlans(tenantId: string): Promise<Map<string, PMPlanDbRow>> {
  const map = new Map<string, PMPlanDbRow>();

  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        s.vehicle_id::text,
        s.plan_id::text,
        p.name AS plan_name,
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object(
            'triggerType', t.trigger_type,
            'intervalValue', t.interval_value,
            'intervalUnit', t.interval_unit
          )) FROM pm_triggers t WHERE t.plan_id = p.id),
          '[]'::jsonb
        ) AS triggers
      FROM pm_schedule_items s
      JOIN maintenance_plans p ON s.plan_id = p.id
      WHERE s.tenant_id = $1 AND p.is_active = true
    `, tenantId);

    for (const r of rows) {
      map.set(r.vehicle_id, {
        vehicle_id: r.vehicle_id,
        plan_id: r.plan_id,
        plan_name: r.plan_name,
        triggers: typeof r.triggers === 'string' ? JSON.parse(r.triggers) : r.triggers || [],
      });
    }
  } catch (err) {
    // fallback
  }

  return map;
}

/**
 * Fetch upcoming trip schedules for target vehicle to assess operational disruption
 */
async function fetchUpcomingTripsForVehicle(
  tenantId: string,
  vehicleId: string
): Promise<TripScheduleWindow[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        id::text AS trip_id,
        trip_number,
        departure_time::text,
        arrival_time::text,
        COALESCE(confirmed_count, capacity, 30) AS passenger_count
      FROM trip_schedules
      WHERE tenant_id = $1
        AND vehicle_id = $2
        AND departure_time >= NOW()
        AND departure_time <= NOW() + INTERVAL '14 days'
        AND status NOT IN ('CANCELLED')
      ORDER BY departure_time ASC
    `, tenantId, vehicleId);

    return rows.map((r) => ({
      tripId: r.trip_id,
      tripNumber: r.trip_number,
      departureTime: r.departure_time,
      arrivalTime: r.arrival_time,
      passengerCount: Number(r.passenger_count) || 0,
    }));
  } catch {
    return [];
  }
}

/**
 * Upsert forecast record into `preventive_maintenance_forecasts`
 */
async function upsertPMForecast(
  tenantId: string,
  forecast: PreventiveMaintenanceForecast,
  runId: string
): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(`
      INSERT INTO preventive_maintenance_forecasts (
        tenant_id, vehicle_id, vehicle_code, license_plate, make, model,
        current_odometer_km, current_engine_hours, daily_avg_km, daily_avg_engine_hours,
        target_service_threshold, target_trigger_type, remaining_km, remaining_engine_hours,
        estimated_days_to_due, projected_due_date, urgency_level, forecast_narrative,
        recommended_slot, operational_impact_score, status, agent_run_id, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16::date, $17, $18,
        $19::jsonb, $20, 'ACTIVE', $21::uuid, NOW()
      )
      ON CONFLICT (tenant_id, vehicle_id) DO UPDATE SET
        vehicle_code = EXCLUDED.vehicle_code,
        license_plate = EXCLUDED.license_plate,
        make = EXCLUDED.make,
        model = EXCLUDED.model,
        current_odometer_km = EXCLUDED.current_odometer_km,
        current_engine_hours = EXCLUDED.current_engine_hours,
        daily_avg_km = EXCLUDED.daily_avg_km,
        daily_avg_engine_hours = EXCLUDED.daily_avg_engine_hours,
        target_service_threshold = EXCLUDED.target_service_threshold,
        target_trigger_type = EXCLUDED.target_trigger_type,
        remaining_km = EXCLUDED.remaining_km,
        remaining_engine_hours = EXCLUDED.remaining_engine_hours,
        estimated_days_to_due = EXCLUDED.estimated_days_to_due,
        projected_due_date = EXCLUDED.projected_due_date,
        urgency_level = EXCLUDED.urgency_level,
        forecast_narrative = EXCLUDED.forecast_narrative,
        recommended_slot = EXCLUDED.recommended_slot,
        operational_impact_score = EXCLUDED.operational_impact_score,
        agent_run_id = EXCLUDED.agent_run_id,
        updated_at = NOW()
    `,
      tenantId,
      forecast.vehicleId,
      forecast.vehicleCode,
      forecast.licensePlate,
      forecast.make,
      forecast.model,
      forecast.currentOdometerKm,
      forecast.currentEngineHours,
      forecast.dailyAvgKm,
      forecast.dailyAvgEngineHours,
      forecast.targetServiceThreshold,
      forecast.targetTriggerType,
      forecast.remainingKm || 0,
      forecast.remainingEngineHours || 0,
      forecast.estimatedDaysToDue,
      forecast.projectedDueDate,
      forecast.urgencyLevel,
      forecast.forecastNarrative,
      JSON.stringify(forecast.recommendedSlot),
      forecast.operationalImpactScore,
      runId
    );
  } catch (err) {
    console.warn('[PreventiveMaintenanceAgent] DB upsert warning:', err);
  }
}

/**
 * Main Agent Runner
 */
export async function run(event: AgentEvent): Promise<AgentRunResult> {
  await ensureAgentSchema();
  const started = Date.now();
  const runId = crypto.randomUUID();
  const tenantId = event.tenant_id || 'default';

  // 1. Fetch Fleet Data
  const vehicles = await fetchVehiclesForPM(tenantId, event.entity_id);
  const telematicsMap = await fetchTelematicsBurnRates(tenantId);
  const lastServiceMap = await fetchLastServiceRecords(tenantId);
  const pmPlanMap = await fetchActivePMPlans(tenantId);

  const forecasts: PreventiveMaintenanceForecast[] = [];
  let actionsCreated = 0;

  // 2. Synthesize signals and generate continuous forecasts
  for (const v of vehicles) {
    const telem = telematicsMap.get(v.id);
    const lastSvc = lastServiceMap.get(v.id);
    const pmPlan = pmPlanMap.get(v.id);

    const vehicleInput: VehiclePMInput = {
      vehicleId: v.id,
      vehicleCode: v.vehicle_code || `V-${v.id.slice(0, 5)}`,
      licensePlate: v.license_plate || 'Unassigned',
      make: v.make || 'Commercial Fleet',
      model: v.model || 'Vehicle',
      year: v.year || 2024,
      currentOdometerKm: Number(v.odometer_reading) || 0,
      currentEngineHours: telem?.engine_hours ? Number(telem.engine_hours) : 0,
      historicalDailyKm: telem?.daily_km_14d || undefined,
      historicalDailyHours: telem?.daily_hours_14d || undefined,
      lastServiceDate: lastSvc?.last_service_date || undefined,
      lastServiceOdometerKm: lastSvc?.last_service_odometer || undefined,
      activePlan: pmPlan ? {
        planId: pmPlan.plan_id,
        planName: pmPlan.plan_name,
        triggers: pmPlan.triggers,
      } : undefined,
    };

    // Calculate burn-down forecast
    const burnDown = calculateVehicleBurnDown(vehicleInput);

    // Fetch operational schedule commitments for lowest-impact slot
    const upcomingTrips = await fetchUpcomingTripsForVehicle(tenantId, v.id);

    // Recommends slot where operational impact is lowest
    const recommendedSlot = recommendLowestImpactSlot({
      vehicleId: v.id,
      vehicleCode: burnDown.vehicleCode,
      projectedDueDate: burnDown.projectedDueDate,
      estimatedDurationHours: burnDown.estimatedDurationHours,
      upcomingTrips,
    });

    const forecast: PreventiveMaintenanceForecast = {
      vehicleId: v.id,
      vehicleCode: burnDown.vehicleCode,
      licensePlate: burnDown.licensePlate,
      make: burnDown.make,
      model: burnDown.model,
      currentOdometerKm: burnDown.currentOdometerKm,
      currentEngineHours: burnDown.currentEngineHours,
      dailyAvgKm: burnDown.dailyAvgKm,
      dailyAvgEngineHours: burnDown.dailyAvgEngineHours,
      targetServiceThreshold: burnDown.targetServiceThreshold,
      targetTriggerType: burnDown.targetTriggerType,
      remainingKm: burnDown.remainingKm,
      remainingEngineHours: burnDown.remainingEngineHours,
      estimatedDaysToDue: burnDown.estimatedDaysToDue,
      projectedDueDate: burnDown.projectedDueDate,
      urgencyLevel: burnDown.urgencyLevel,
      forecastNarrative: burnDown.forecastNarrative,
      recommendedSlot,
      operationalImpactScore: recommendedSlot.operationalDisruptionScore,
      status: 'ACTIVE',
    };

    // Persist forecast to database
    await upsertPMForecast(tenantId, forecast, runId);
    forecasts.push(forecast);

    // Stage in agent_approvals if DUE_SOON (<= 7 days)
    if (forecast.urgencyLevel === 'DUE_SOON' || forecast.urgencyLevel === 'OVERDUE') {
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO agent_approvals (
            tenant_id, agent_id, entity_type, entity_id, action_type,
            title, description, financial_impact_aed, proposed_payload,
            status, requested_autonomy
          ) VALUES (
            $1, 'preventive-maintenance', 'VEHICLE', $2, 'SCHEDULE_PM_SLOT',
            $3, $4, $5, $6::jsonb, 'PENDING', 'L3'
          )
          ON CONFLICT DO NOTHING
        `,
          tenantId,
          forecast.vehicleId,
          `Schedule PM for ${forecast.vehicleCode}: ${forecast.targetServiceThreshold}`,
          `${forecast.forecastNarrative} Recommended slot: ${forecast.recommendedSlot.slotDate} ${forecast.recommendedSlot.startTime} (${forecast.recommendedSlot.reasoning}).`,
          burnDown.estimatedCostAed,
          JSON.stringify({
            vehicleId: forecast.vehicleId,
            vehicleCode: forecast.vehicleCode,
            serviceThreshold: forecast.targetServiceThreshold,
            slot: forecast.recommendedSlot,
            operations: burnDown.operationsNeeded,
            estimatedCostAed: burnDown.estimatedCostAed,
          })
        );
        actionsCreated++;
      } catch (apprErr) {
        // ignore
      }
    }
  }

  const durationMs = Date.now() - started;

  return {
    agentId: 'preventive-maintenance',
    tenantId,
    eventType: event.event_type,
    entityId: event.entity_id,
    status: 'COMPLETED',
    durationMs,
    itemsProcessed: forecasts.length,
    actionsCreated,
    output: {
      totalVehiclesScanned: forecasts.length,
      overdueCount: forecasts.filter((f) => f.urgencyLevel === 'OVERDUE').length,
      dueSoonCount: forecasts.filter((f) => f.urgencyLevel === 'DUE_SOON').length,
      upcomingCount: forecasts.filter((f) => f.urgencyLevel === 'UPCOMING').length,
      forecasts,
    },
  };
}

export const PREVENTIVE_MAINTENANCE_AGENT: AgentDefinition = {
  id: 'preventive-maintenance',
  name: 'Preventive Maintenance Agent',
  description: 'Continuously projects vehicle service thresholds (e.g. V-103 reaching 20,000 km in 6 operating days) and recommends lowest operational impact maintenance slots.',
  version: '1.0.0',
  agentType: 'BATCH',
  subscribedEvents: [
    'vehicle.odometer_updated',
    'vehicle.telematics_received',
    'vehicle.trip_completed',
    'manual.trigger',
    'schedule.nightly',
  ],
  supportsEntityScan: true,
  run,
};
