/**
 * Predictive Maintenance Agent — 9-Signal Advanced Runner
 * --------------------------------------------------------
 * Evaluates fleet vehicles across all 9 failure estimation dimensions:
 *  1. Historical Repairs & Subsystem Work Logs
 *  2. CAN-bus DTC Fault Codes (SAE J2012 / J1939)
 *  3. Live Telemetry Sensors (Coolant, Oil Pressure, Battery Voltage)
 *  4. Mileage & Cumulative Distance Curve
 *  5. Engine Operating Hours & Urban Idling / PTO Stress
 *  6. Thermal Degradation & High Temperature Warnings
 *  7. Fuel Consumption Baseline vs 30d Anomaly
 *  8. Repeat Subsystem Failures (Chronic Fault Detection)
 *  9. Component History & Subsystem Remaining Useful Life (RUL)
 *
 * Upserts granular risk scores into `fleet_risk_scores` and auto-provisions
 * preventive work orders for CRITICAL / Emergency vehicles.
 */

import { prisma } from '@/lib/prisma';
import { AgentDefinition, AgentEvent, AgentRunResult, VehicleRiskScore } from '../types';
import {
  ComprehensiveVehicleInput,
  HistoricalRepairRecord,
  SensorInputs,
  scoreVehicleComprehensive,
} from './scoring';

// ── Data Collection Interfaces ─────────────────────────────────────────────────

interface VehicleRow {
  id: string;
  vehicle_code: string | null;
  make: string | null;
  model: string | null;
  license_plate: string | null;
  purchase_date: string | null;
  odometer_reading: number | null;
  engine_hours: number | null;
}

interface WoRow {
  vehicle_id: string;
  open_count: number;
  recent_count: number;
}

interface FuelRow {
  vehicle_id: string;
  baseline_l_per_100: number | null;
  recent_l_per_100: number | null;
}

interface ServiceRow {
  vehicle_id: string;
  last_service_date: string | null;
  last_service_odometer: number | null;
}

interface RepairHistoryRow {
  vehicle_id: string;
  subsystem: string;
  completed_at: string;
}

interface TelemetryRow {
  vehicle_id: string;
  coolant_temp_c: number | null;
  oil_pressure_kpa: number | null;
  battery_voltage: number | null;
  transmission_temp_c: number | null;
  engine_hours: number | null;
  dtc_codes: string[] | null;
}

// ── Database Fetchers ──────────────────────────────────────────────────────────

async function fetchVehicles(vehicleId?: string): Promise<VehicleRow[]> {
  const filter = vehicleId ? `AND id = '${vehicleId}'` : '';
  return prisma.$queryRawUnsafe<VehicleRow[]>(
    `SELECT id, vehicle_code, make, model, license_plate, purchase_date,
            COALESCE(odometer_reading, 0)::float8 AS odometer_reading,
            COALESCE(engine_hours, 0)::float8 AS engine_hours
     FROM vehicles
     WHERE deleted_at IS NULL
       AND status NOT IN ('INACTIVE','SOLD')
       ${filter}
     ORDER BY created_at DESC
     LIMIT 500`,
  ).catch(() => []);
}

async function fetchWorkOrderStats(): Promise<WoRow[]> {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  return prisma.$queryRawUnsafe<WoRow[]>(
    `SELECT
       vehicle_id::text,
       COUNT(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS','PENDING_PARTS'))::int AS open_count,
       COUNT(*) FILTER (WHERE created_at >= $1)::int                                 AS recent_count
     FROM fleet_work_orders
     WHERE deleted_at IS NULL
     GROUP BY vehicle_id`,
    cutoff,
  ).catch(() => []);
}

async function fetchFuelStats(): Promise<FuelRow[]> {
  const cutoff90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return prisma.$queryRawUnsafe<FuelRow[]>(
    `SELECT
       vehicle_id::text,
       CASE WHEN SUM(km_driven) FILTER (WHERE fuel_date >= $1 AND km_driven > 0) > 0
            THEN ROUND((SUM(liters) FILTER (WHERE fuel_date >= $1 AND km_driven > 0)
                 / SUM(km_driven) FILTER (WHERE fuel_date >= $1 AND km_driven > 0)) * 100, 2)
            ELSE NULL END AS baseline_l_per_100,
       CASE WHEN SUM(km_driven) FILTER (WHERE fuel_date >= $2 AND km_driven > 0) > 0
            THEN ROUND((SUM(liters) FILTER (WHERE fuel_date >= $2 AND km_driven > 0)
                 / SUM(km_driven) FILTER (WHERE fuel_date >= $2 AND km_driven > 0)) * 100, 2)
            ELSE NULL END AS recent_l_per_100
     FROM fuel_logs
     GROUP BY vehicle_id`,
    cutoff90,
    cutoff30,
  ).catch(() => []);
}

async function fetchServiceHistory(): Promise<ServiceRow[]> {
  return prisma.$queryRawUnsafe<ServiceRow[]>(
    `SELECT DISTINCT ON (vehicle_id)
       vehicle_id::text,
       event_date::TEXT AS last_service_date,
       odometer_reading::float8 AS last_service_odometer
     FROM fleet_lifecycle_events
     WHERE event_type IN ('MAINTENANCE','SERVICE','REPAIR')
       AND status = 'COMPLETED'
     ORDER BY vehicle_id, event_date DESC`,
  ).catch(() => []);
}

async function fetchRepairSubsystemHistory(): Promise<RepairHistoryRow[]> {
  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  return prisma.$queryRawUnsafe<RepairHistoryRow[]>(
    `SELECT
       vehicle_id::text,
       COALESCE(category, 'GENERAL') AS subsystem,
       COALESCE(completed_at, created_at)::text AS completed_at
     FROM fleet_work_orders
     WHERE deleted_at IS NULL
       AND created_at >= $1
     ORDER BY created_at DESC`,
    cutoff,
  ).catch(() => []);
}

async function fetchLatestTelematicsAndDTC(): Promise<TelemetryRow[]> {
  // Query latest telematics readings or diagnostics logs if available
  return prisma.$queryRawUnsafe<TelemetryRow[]>(
    `SELECT DISTINCT ON (vehicle_id)
       vehicle_id::text,
       (payload->'sensors'->>'coolantTempC')::float8       AS coolant_temp_c,
       (payload->'sensors'->>'oilPressureKpa')::float8      AS oil_pressure_kpa,
       (payload->'sensors'->>'batteryVoltage')::float8      AS battery_voltage,
       (payload->'sensors'->>'transmissionTempC')::float8   AS transmission_temp_c,
       (payload->'sensors'->>'engineHours')::float8         AS engine_hours,
       CASE WHEN payload ? 'dtcCodes'
            THEN ARRAY(SELECT jsonb_array_elements_text(payload->'dtcCodes'))
            ELSE ARRAY[]::text[] END                       AS dtc_codes
     FROM telematics_events
     WHERE event_type IN ('CANBUS_TELEMETRY', 'DTC_ALERT', 'DIAGNOSTIC_FRAME')
     ORDER BY vehicle_id, created_at DESC`,
  ).catch(() => []);
}

async function getExistingPredictiveWOs(): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<{ vehicle_id: string }[]>(
    `SELECT DISTINCT vehicle_id::text FROM fleet_work_orders
     WHERE title ILIKE '%predictive maintenance%'
       AND status IN ('OPEN','IN_PROGRESS','PENDING_PARTS')
       AND deleted_at IS NULL`,
  ).catch(() => []);
  return new Set(rows.map((r) => r.vehicle_id));
}

// ── Work Order Auto-Creation ───────────────────────────────────────────────────
async function autoCreateWorkOrder(score: VehicleRiskScore): Promise<string | null> {
  try {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const priority = score.riskLevel === 'CRITICAL' ? 'CRITICAL' : 'HIGH';
    const title = `[Predictive Maintenance] ${score.make ?? ''} ${score.model ?? ''} — ${score.riskLevel} Risk`;

    const dtcList = score.factors.activeDtcCodes?.length > 0
      ? `Active DTC Faults: ${score.factors.activeDtcCodes.join(', ')} (${score.factors.dtcSeveritySummary})\n`
      : '';

    const sensorAlerts = score.factors.sensorWarningList?.length > 0
      ? `Sensor Telemetry Alerts: ${score.factors.sensorWarningList.join('; ')}\n`
      : '';

    const description =
      `Auto-generated by 9-Signal Predictive Maintenance Agent (Score: ${score.riskScore.toFixed(3)}).\n` +
      `Risk Level: ${score.riskLevel} | Predicted Failure Window: ${score.predictedFailureWindow}\n` +
      `Primary Trigger: ${score.primaryFailureReason ?? 'Multi-factor degradation'}\n` +
      `Action: ${score.recommendedAction}\n` +
      dtcList +
      sensorAlerts +
      `Subsystem RUL: Powertrain: ${score.factors.subsystemRUL?.powertrainPct ?? 100}% | ` +
      `Brakes: ${score.factors.subsystemRUL?.brakeSystemPct ?? 100}% | ` +
      `Electrical: ${score.factors.subsystemRUL?.electricalPct ?? 100}% | ` +
      `HVAC: ${score.factors.subsystemRUL?.hvacPct ?? 100}%\n` +
      `Service Overdue: ${score.factors.serviceOverdueDays} days / ${score.factors.serviceOverdueKm} km | ` +
      `Fuel Anomaly Score: ${Math.round(score.factors.fuelAnomalyScore * 100)}%`;

    await prisma.$executeRawUnsafe(
      `INSERT INTO fleet_work_orders (
         id, vehicle_id, title, description, status, priority,
         work_order_type, requested_by, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,'OPEN',$5,'PREVENTIVE','Predictive Maintenance Agent',$6,$7)`,
      id,
      score.vehicleId,
      title,
      description,
      priority,
      now,
      now,
    );
    return id;
  } catch {
    return null;
  }
}

// ── Upsert Granular Risk Score ─────────────────────────────────────────────────
async function upsertRiskScore(score: VehicleRiskScore, runId: string, woId?: string | null): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO fleet_risk_scores (
       vehicle_id, vehicle_code, make, model, license_plate,
       risk_score, risk_level, factors, recommended_action,
       predicted_failure_window, auto_work_order_id, agent_run_id, scored_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
     ON CONFLICT (vehicle_id) DO UPDATE SET
       vehicle_code = EXCLUDED.vehicle_code,
       make = EXCLUDED.make,
       model = EXCLUDED.model,
       license_plate = EXCLUDED.license_plate,
       risk_score = EXCLUDED.risk_score,
       risk_level = EXCLUDED.risk_level,
       factors = EXCLUDED.factors,
       recommended_action = EXCLUDED.recommended_action,
       predicted_failure_window = EXCLUDED.predicted_failure_window,
       auto_work_order_id = COALESCE(EXCLUDED.auto_work_order_id, fleet_risk_scores.auto_work_order_id),
       agent_run_id = EXCLUDED.agent_run_id,
       scored_at = NOW()`,
    score.vehicleId,
    score.vehicleCode,
    score.make,
    score.model,
    score.licensePlate,
    score.riskScore,
    score.riskLevel,
    JSON.stringify(score.factors),
    score.recommendedAction,
    score.predictedFailureWindow,
    woId ?? null,
    runId,
  );
}

// ── Agent Runner Implementation ────────────────────────────────────────────────
async function run(event: AgentEvent): Promise<AgentRunResult> {
  const started = Date.now();
  const runId = crypto.randomUUID();

  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_runs (id, agent_id, tenant_id, event_type, entity_id, status, created_at)
     VALUES ($1,'predictive-maintenance',$2,$3,$4,'RUNNING',NOW())`,
    runId,
    event.tenant_id,
    event.event_type,
    event.entity_id ?? null,
  ).catch(() => {});

  const [
    vehicles,
    woStats,
    fuelStats,
    serviceHistory,
    repairHistory,
    telemetryData,
    existingPredWOs,
  ] = await Promise.all([
    fetchVehicles(event.entity_id),
    fetchWorkOrderStats(),
    fetchFuelStats(),
    fetchServiceHistory(),
    fetchRepairSubsystemHistory(),
    fetchLatestTelematicsAndDTC(),
    getExistingPredictiveWOs(),
  ]);

  // Build lookup maps
  const woMap         = new Map(woStats.map((r) => [r.vehicle_id, r]));
  const fuelMap       = new Map(fuelStats.map((r) => [r.vehicle_id, r]));
  const serviceMap    = new Map(serviceHistory.map((r) => [r.vehicle_id, r]));
  const telemetryMap  = new Map(telemetryData.map((r) => [r.vehicle_id, r]));

  // Group repair history by vehicle
  const repairMap = new Map<string, HistoricalRepairRecord[]>();
  for (const rep of repairHistory) {
    const list = repairMap.get(rep.vehicle_id) ?? [];
    let sub: HistoricalRepairRecord['subsystem'] = 'GENERAL';
    const cat = rep.subsystem.toUpperCase();
    if (cat.includes('BRAKE')) sub = 'BRAKES';
    else if (cat.includes('ENGINE') || cat.includes('TRANS') || cat.includes('POWERTRAIN')) sub = 'POWERTRAIN';
    else if (cat.includes('ELEC') || cat.includes('BATTERY')) sub = 'ELECTRICAL';
    else if (cat.includes('AC') || cat.includes('HVAC') || cat.includes('COOLING')) sub = 'HVAC';
    else if (cat.includes('SUSPENSION') || cat.includes('TIRE')) sub = 'SUSPENSION';

    list.push({ subsystem: sub, completedAt: rep.completed_at });
    repairMap.set(rep.vehicle_id, list);
  }

  // Fleet-wide average WOs per 90 days
  const totalWo90 = woStats.reduce((s, r) => s + Number(r.recent_count ?? 0), 0);
  const fleetAvgWo = vehicles.length > 0 ? totalWo90 / vehicles.length : 0;

  const now = Date.now();
  const scores: VehicleRiskScore[] = [];
  let actionsCreated = 0;

  for (const v of vehicles) {
    const wo      = woMap.get(v.id);
    const fuel    = fuelMap.get(v.id);
    const svc     = serviceMap.get(v.id);
    const telem   = telemetryMap.get(v.id);
    const repairs = repairMap.get(v.id) ?? [];

    // Service overdue calculation
    const lastSvcDate = svc?.last_service_date ? new Date(svc.last_service_date) : null;
    const daysSinceLastService = lastSvcDate
      ? Math.floor((now - lastSvcDate.getTime()) / (1000 * 60 * 60 * 24))
      : SERVICE_INTERVAL_DAYS;

    const currentOdometer = Number(v.odometer_reading ?? 0);
    const lastSvcOdometer = Number(svc?.last_service_odometer ?? 0);
    const kmSinceLastService = Math.max(currentOdometer - lastSvcOdometer, 0);

    const sensors: SensorInputs = {
      coolantTempC: telem?.coolant_temp_c ?? undefined,
      oilPressureKpa: telem?.oil_pressure_kpa ?? undefined,
      batteryVoltage: telem?.battery_voltage ?? undefined,
      transmissionTempC: telem?.transmission_temp_c ?? undefined,
    };

    const input: ComprehensiveVehicleInput = {
      id:                   v.id,
      vehicleCode:          v.vehicle_code ?? '',
      make:                 v.make ?? '',
      model:                v.model ?? '',
      licensePlate:         v.license_plate ?? '',
      purchaseDate:         v.purchase_date,
      odometerReading:      currentOdometer,
      daysSinceLastService,
      kmSinceLastService,
      baselineFuelLper100:   fuel ? Number(fuel.baseline_l_per_100) : null,
      recentFuelLper100:     fuel ? Number(fuel.recent_l_per_100)   : null,
      openWorkOrders:        Number(wo?.open_count ?? 0),
      workOrdersLast90Days:  Number(wo?.recent_count ?? 0),
      historicalRepairs:     repairs,
      activeDtcCodes:        telem?.dtc_codes ?? [],
      sensors,
      engineOperatingHours:  telem?.engine_hours ?? v.engine_hours ?? null,
    };

    const score = scoreVehicleComprehensive(input, fleetAvgWo);
    scores.push(score);

    // Auto-create Preventive Work Order for CRITICAL vehicles
    let woId: string | null = null;
    if (score.riskLevel === 'CRITICAL' && !existingPredWOs.has(v.id)) {
      woId = await autoCreateWorkOrder(score);
      if (woId) actionsCreated++;
    }

    await upsertRiskScore(score, runId, woId);
  }

  const durationMs = Date.now() - started;

  await prisma.$executeRawUnsafe(
    `UPDATE agent_runs SET
       status='COMPLETED', items_processed=$1, actions_created=$2,
       duration_ms=$3, output=$4
     WHERE id=$5`,
    scores.length,
    actionsCreated,
    durationMs,
    JSON.stringify({ summary: buildSummary(scores), scored: scores.length }),
    runId,
  ).catch(() => {});

  return {
    agentId:        'predictive-maintenance',
    tenantId:       event.tenant_id,
    eventType:      event.event_type,
    entityId:       event.entity_id,
    status:         'COMPLETED',
    durationMs,
    itemsProcessed: scores.length,
    actionsCreated,
    output: {
      summary: buildSummary(scores),
      scores,
    },
  };
}

function buildSummary(scores: VehicleRiskScore[]) {
  return {
    total:    scores.length,
    critical: scores.filter((s) => s.riskLevel === 'CRITICAL').length,
    high:     scores.filter((s) => s.riskLevel === 'HIGH').length,
    medium:   scores.filter((s) => s.riskLevel === 'MEDIUM').length,
    low:      scores.filter((s) => s.riskLevel === 'LOW').length,
    avgScore: scores.length > 0
      ? parseFloat((scores.reduce((a, s) => a + s.riskScore, 0) / scores.length).toFixed(3))
      : 0,
  };
}

const SERVICE_INTERVAL_DAYS = 90;

export const PREDICTIVE_MAINTENANCE_AGENT: AgentDefinition = {
  id:          'predictive-maintenance',
  name:        'Predictive Maintenance Agent',
  description: '9-factor failure estimation engine analyzing DTCs, sensors, engine hours, thermal stress, repair history, repeat faults, and component RUL.',
  version:     '2.0.0',
  agentType:   'BATCH',
  subscribedEvents: [
    'vehicle.odometer_updated',
    'vehicle.fuel_log_added',
    'vehicle.work_order_created',
    'manual.trigger',
    'schedule.nightly',
  ],
  supportsEntityScan: true,
  run,
};
