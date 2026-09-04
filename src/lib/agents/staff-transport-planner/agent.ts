/**
 * Staff Transport Planning Agent — Runner v1.0.0
 * ------------------------------------------------
 * AI Intelligence Layer for Bus-Ops Staff Transport:
 *  - Ingests employee accommodations, work hubs, shifts, and manifests
 *  - Optimizes route clusters, vehicle bin-packing (14/30/50), and departure timing
 *  - Chains cross-shift vehicle reuse (Morning -> Afternoon -> Night)
 *  - Persists actionable plan recommendations to `bus_ops_plan_recommendations`
 */

import { prisma } from '@/lib/prisma';
import { AgentDefinition, AgentEvent, AgentRunResult } from '../types';
import { ensureAgentSchema } from '../schema';
import {
  EmployeePickupRequirement,
  FleetVehicleSpec,
  optimizeStaffTransportPlan,
} from './optimizer';

// Sample enterprise staff transport requirements if DB is unseeded
const DEFAULT_STAFF_REQUIREMENTS: EmployeePickupRequirement[] = [
  // ── Shift 1: Morning 07:00 (Inbound to DXB Airport Terminals & Aviation Hub) ──
  {
    id: 'REQ-M1',
    employeeName: 'Aviation Ground Crew (Sonapur Cluster)',
    pickupName: 'Muhaisnah 2 Staff Complex',
    pickupLat: 25.2680,
    pickupLng: 55.4050,
    zone: 'Muhaisnah / Sonapur',
    destinationName: 'DXB Airport Terminal 3',
    destinationLat: 25.2532,
    destinationLng: 55.3657,
    shiftName: 'MORNING_0700',
    targetArrivalTime: '07:00',
    passengerCount: 28,
  },
  {
    id: 'REQ-M2',
    employeeName: 'Aviation Baggage Team (Sonapur Cluster B)',
    pickupName: 'Sonapur Camp 4 Gate',
    pickupLat: 25.2750,
    pickupLng: 55.4120,
    zone: 'Muhaisnah / Sonapur',
    destinationName: 'DXB Airport Terminal 3',
    destinationLat: 25.2532,
    destinationLng: 55.3657,
    shiftName: 'MORNING_0700',
    targetArrivalTime: '07:00',
    passengerCount: 18,
  },
  {
    id: 'REQ-M3',
    employeeName: 'Hospitality Staff (Al Quoz Cluster)',
    pickupName: 'Al Quoz Industrial 3 Accommodation',
    pickupLat: 25.1320,
    pickupLng: 55.2340,
    zone: 'Al Quoz',
    destinationName: 'DXB Airport Terminal 3',
    destinationLat: 25.2532,
    destinationLng: 55.3657,
    shiftName: 'MORNING_0700',
    targetArrivalTime: '07:00',
    passengerCount: 12,
  },

  // ── Shift 2: Afternoon 15:00 (Inbound to JAFZA Logistics Zone) ───────────────
  {
    id: 'REQ-A1',
    employeeName: 'Logistics Warehouse Team (Al Quoz)',
    pickupName: 'Al Quoz Industrial 1 Camp',
    pickupLat: 25.1450,
    pickupLng: 55.2280,
    zone: 'Al Quoz',
    destinationName: 'JAFZA South Logistics Hub',
    destinationLat: 24.9850,
    destinationLng: 55.0850,
    shiftName: 'AFTERNOON_1500',
    targetArrivalTime: '15:00',
    passengerCount: 26,
  },
  {
    id: 'REQ-A2',
    employeeName: 'Logistics Dispatchers (Sharjah Rolla)',
    pickupName: 'Sharjah Rolla Clock Tower',
    pickupLat: 25.3580,
    pickupLng: 55.3890,
    zone: 'Sharjah Rolla',
    destinationName: 'JAFZA South Logistics Hub',
    destinationLat: 24.9850,
    destinationLng: 55.0850,
    shiftName: 'AFTERNOON_1500',
    targetArrivalTime: '15:00',
    passengerCount: 14,
  },

  // ── Shift 3: Night 23:00 (Inbound to Healthcare City Hospital) ───────────────
  {
    id: 'REQ-N1',
    employeeName: 'Night Nursing Staff (Al Nahda Cluster)',
    pickupName: 'Al Nahda 2 Sahara Center Area',
    pickupLat: 25.2950,
    pickupLng: 55.3720,
    zone: 'Al Nahda',
    destinationName: 'Dubai Healthcare City Hospital',
    destinationLat: 25.2320,
    destinationLng: 55.3210,
    shiftName: 'NIGHT_2300',
    targetArrivalTime: '23:00',
    passengerCount: 24,
  },
  {
    id: 'REQ-N2',
    employeeName: 'Emergency Support Team (Al Quoz)',
    pickupName: 'Al Quoz 4 Residential Complex',
    pickupLat: 25.1210,
    pickupLng: 55.2410,
    zone: 'Al Quoz',
    destinationName: 'Dubai Healthcare City Hospital',
    destinationLat: 25.2320,
    destinationLng: 55.3210,
    shiftName: 'NIGHT_2300',
    targetArrivalTime: '23:00',
    passengerCount: 10,
  },
];

async function fetchRequirementsFromDb(tenantId: string): Promise<EmployeePickupRequirement[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        r.id::text,
        COALESCE(r.route_name, 'Staff Route') AS "pickupName",
        r.origin_lat::float8 AS "pickupLat",
        r.origin_lng::float8 AS "pickupLng",
        COALESCE(r.zone, 'DXB-CENTRAL') AS zone,
        COALESCE(r.destination_name, 'Main Facility') AS "destinationName",
        r.destination_lat::float8 AS "destinationLat",
        r.destination_lng::float8 AS "destinationLng",
        COALESCE(r.shift_name, 'MORNING_0700') AS "shiftName",
        COALESCE(r.target_arrival_time, '07:00') AS "targetArrivalTime",
        COALESCE(r.passenger_count, 20)::int AS "passengerCount"
      FROM bus_ops_manifests r
      WHERE r.tenant_id = $1
      LIMIT 100
    `, tenantId);

    if (rows && rows.length > 0) {
      return rows.map((r) => ({
        id: r.id,
        pickupName: r.pickupName,
        pickupLat: Number(r.pickupLat ?? 25.2048),
        pickupLng: Number(r.pickupLng ?? 55.2708),
        zone: r.zone,
        destinationName: r.destinationName,
        destinationLat: Number(r.destinationLat ?? 25.2532),
        destinationLng: Number(r.destinationLng ?? 55.3657),
        shiftName: r.shiftName,
        targetArrivalTime: r.targetArrivalTime,
        passengerCount: Number(r.passengerCount ?? 20),
      }));
    }
  } catch {}

  return DEFAULT_STAFF_REQUIREMENTS;
}

async function fetchAvailableVehicles(tenantId: string): Promise<FleetVehicleSpec[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        v.id::text,
        COALESCE(v.vehicle_code, v.plate_number, v.id::text) AS "vehicleCode",
        COALESCE(v.type, 'BUS') AS type,
        COALESCE(v.seating_capacity, 30)::int AS capacity
      FROM vehicles v
      WHERE v.tenant_id = $1
        AND (v.deleted_at IS NULL)
        AND (v.status IN ('AVAILABLE', 'ACTIVE', 'STANDBY') OR v.status IS NULL)
      LIMIT 50
    `, tenantId);

    if (rows && rows.length > 0) {
      return rows.map((r) => ({
        id: r.id,
        vehicleCode: r.vehicleCode,
        type: r.type,
        capacity: Number(r.capacity ?? 30),
      }));
    }
  } catch {}

  return [
    { id: 'V-BUS-01', vehicleCode: 'BUS-01', type: 'COACH', capacity: 50 },
    { id: 'V-BUS-02', vehicleCode: 'BUS-02', type: 'COASTER', capacity: 30 },
    { id: 'V-BUS-03', vehicleCode: 'BUS-03', type: 'COASTER', capacity: 30 },
    { id: 'V-VAN-01', vehicleCode: 'VAN-01', type: 'VAN', capacity: 14 },
    { id: 'V-VAN-02', vehicleCode: 'VAN-02', type: 'VAN', capacity: 14 },
  ];
}

async function runStaffTransportPlanner(event: AgentEvent): Promise<AgentRunResult> {
  const t0 = Date.now();
  const tenantId = event.tenant_id;
  const runId = crypto.randomUUID();

  await ensureAgentSchema();

  // Log execution start
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_runs (id, agent_id, tenant_id, event_type, status, created_at)
     VALUES ($1, 'staff-transport-planner', $2, $3, 'RUNNING', NOW())`,
    runId,
    tenantId,
    event.event_type,
  ).catch(() => {});

  // Ingest requirements & available fleet
  const [requirements, vehicles] = await Promise.all([
    fetchRequirementsFromDb(tenantId),
    fetchAvailableVehicles(tenantId),
  ]);

  // Execute optimization engine
  const recommendation = optimizeStaffTransportPlan(requirements, vehicles, tenantId);

  // Persist plan recommendation to database
  await prisma.$executeRawUnsafe(
    `INSERT INTO bus_ops_plan_recommendations (
       id, tenant_id, plan_name, shift_coverage,
       total_employees_covered, baseline_vehicles_needed,
       optimized_vehicles_needed, vehicles_saved,
       daily_distance_saved_km, monthly_cost_saved_aed,
       annual_cost_saved_aed, routes, vehicle_reuse_chains,
       status, agent_run_id, created_at, updated_at
     ) VALUES (
       $1::uuid, $2, $3, $4::jsonb,
       $5, $6, $7, $8,
       $9, $10, $11, $12::jsonb, $13::jsonb,
       'SUGGESTED', $14::uuid, NOW(), NOW()
     )`,
    recommendation.id,
    tenantId,
    recommendation.planName,
    JSON.stringify(recommendation.shiftCoverage),
    recommendation.totalEmployeesCovered,
    recommendation.baselineVehiclesNeeded,
    recommendation.optimizedVehiclesNeeded,
    recommendation.vehiclesSaved,
    recommendation.dailyDistanceSavedKm,
    recommendation.monthlyCostSavedAed,
    recommendation.annualCostSavedAed,
    JSON.stringify(recommendation.routes),
    JSON.stringify(recommendation.vehicleReuseChains),
    runId,
  ).catch((err) => {
    console.error('[staff-transport-planner] Failed to persist recommendation:', err);
  });

  const durationMs = Date.now() - t0;

  // Finalize agent run record
  await prisma.$executeRawUnsafe(
    `UPDATE agent_runs SET
       status          = 'COMPLETED',
       items_processed = $1,
       actions_created = $2,
       duration_ms     = $3,
       output          = $4
     WHERE id = $5::uuid`,
    requirements.length,
    recommendation.routes.length,
    durationMs,
    JSON.stringify(recommendation),
    runId,
  ).catch(() => {});

  return {
    agentId: 'staff-transport-planner',
    tenantId,
    eventType: event.event_type,
    status: 'COMPLETED',
    durationMs,
    itemsProcessed: requirements.length,
    actionsCreated: recommendation.routes.length,
    output: recommendation,
  };
}

export const STAFF_TRANSPORT_PLANNER_AGENT: AgentDefinition = {
  id:          'staff-transport-planner',
  name:        'Staff Transport Planning Agent',
  description: 'Analyzes employee accommodations, worksites, shifts, and passenger manifests to recommend optimal route clusters, vehicle sizes (14/30/50), departure timings, and cross-shift vehicle reuse.',
  version:     '1.0.0',
  agentType:   'BATCH',
  subscribedEvents: [
    'bus_ops.shift_schedule_updated',
    'bus_ops.manifest_updated',
    'bus_ops.plan_requested',
    'manual.trigger',
    'schedule.nightly',
  ],
  supportsEntityScan: true,
  run: runStaffTransportPlanner,
};
