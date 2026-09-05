/**
 * Smart Dispatch Optimiser Agent v2.1.0
 * ---------------------------------------
 * Evaluates all pending dispatch jobs and scores driver/vehicle combinations
 * using the 15-factor scoring model, adaptive spatial shortlisting,
 * and RoutingIntelligenceService matrix refinement.
 * 
 * Includes:
 *  - Adaptive Spatial Shortlisting (prunes 200+ candidates to Top-20 with fallback expansion)
 *  - Top-5 Policy Road Matrix Refinement via RoutingIntelligenceService
 *  - Live Driver HOS (Hours of Service) shifts & fatigue telemetry
 *  - Vehicle Mulkiya, registration & insurance compliance gating
 *  - Driver commercial licensing validity gating
 *  - Predictive maintenance risk score integration
 *  - Proximity & Deadhead distance to depot optimization
 *  - Semi-Autonomous Auto-Dispatch execution for high-confidence matches (score >= 0.85)
 *  - Avoided routing cost & cache hit telemetry tracking
 *  - Upserting recommendations to `dispatch_optimiser_recommendations`
 */
import { prisma } from '@/lib/prisma';
import { AgentDefinition, AgentEvent, AgentRunResult } from '../types';
import { rankCandidatesWithRouting, DriverCandidate, JobRequirements } from './scoring';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';

interface JobRow {
  id: string;
  service_type: string;
  priority: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  required_capacity: number | null;
  sla_deadline: string | null;
  zone_id: string | null;
  status: string;
  metadata: {
    estimatedDurationMin?: number;
    requiredVehicleTypes?: string[];
    requiredLicenseClass?: string;
    customerLanguage?: string;
    autoDispatch?: boolean;
    autoDispatchThreshold?: number;
  } | null;
}

interface VehicleRow {
  id: string;
  vehicle_code: string;
  vehicle_type: string;
  capacity: number | null;
  status: string;
  current_lat: number | null;
  current_lng: number | null;
  risk_score: number | null;
  registration_expiry: Date | string | null;
  insurance_expiry: Date | string | null;
  mulkiya_expiry: Date | string | null;
  home_depot_id: string | null;
}

interface DriverRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  assigned_vehicle_id: string | null;
  current_lat: number | null;
  current_lng: number | null;
  language: string | null;
  license_class: string | null;
  license_expiry: Date | string | null;
  status: string | null;
  hours_worked_today: number | null;
  shift_start: Date | string | null;
  shift_end: Date | string | null;
}

async function runDispatchOptimiser(event: AgentEvent): Promise<AgentRunResult> {
  const t0 = Date.now();
  const tenantId = event.tenant_id;
  const entityId = event.entity_id ?? null;

  await ensureDispatchSchema();

  // 1. Fetch pending jobs — always scoped to tenant; optionally single job
  const jobs = await (
    entityId
      ? prisma.$queryRawUnsafe<JobRow[]>(`
          SELECT id::text, service_type, priority, status,
                 pickup_lat::float8, pickup_lng::float8,
                 dropoff_lat::float8, dropoff_lng::float8,
                 required_capacity::int, sla_deadline::text, zone_id, metadata
          FROM dispatch_jobs
          WHERE tenant_id = $1
            AND id = $2::uuid
            AND status IN ('PENDING', 'SEARCHING', 'RETRYING')
          LIMIT 1
        `, tenantId, entityId)
      : prisma.$queryRawUnsafe<JobRow[]>(`
          SELECT id::text, service_type, priority, status,
                 pickup_lat::float8, pickup_lng::float8,
                 dropoff_lat::float8, dropoff_lng::float8,
                 required_capacity::int, sla_deadline::text, zone_id, metadata
          FROM dispatch_jobs
          WHERE tenant_id = $1
            AND status IN ('PENDING', 'SEARCHING', 'RETRYING')
          ORDER BY
            CASE priority
              WHEN 'P1' THEN 1 WHEN 'EMERGENCY' THEN 2
              WHEN 'P2' THEN 3 WHEN 'URGENT' THEN 4
              WHEN 'P3' THEN 5 WHEN 'NORMAL' THEN 6 ELSE 7
            END,
            created_at ASC
          LIMIT 100
        `, tenantId)
  ).catch((err) => {
    console.error('[dispatch-optimiser] Failed to fetch jobs:', err);
    return [] as JobRow[];
  });

  if (jobs.length === 0) {
    return {
      agentId: 'dispatch-optimiser', tenantId, eventType: event.event_type,
      status: 'COMPLETED', durationMs: Date.now() - t0,
      itemsProcessed: 0, actionsCreated: 0,
      output: { summary: 'No pending dispatch jobs to optimise.', recommendations: [] },
    };
  }

  // 2. Fetch available vehicles with registration & insurance compliance fields and risk scores
  const vehicles = await prisma.$queryRawUnsafe<VehicleRow[]>(`
    SELECT v.id::text,
           COALESCE(v.vehicle_code, v.plate_number, v.id::text) AS vehicle_code,
           COALESCE(v.type, v.vehicle_group, 'SEDAN') AS vehicle_type,
           COALESCE(v.seating_capacity, 4)::int AS capacity,
           v.status,
           vl.lat::float8 AS current_lat,
           vl.lng::float8 AS current_lng,
           r.risk_score::float8,
           v.registration_expiry,
           v.insurance_expiry,
           v.mulkiya_expiry,
           v.home_depot_id::text
    FROM vehicles v
    LEFT JOIN vehicle_locations vl ON vl.vehicle_id = v.id::text
    LEFT JOIN fleet_risk_scores r ON r.vehicle_id = v.id
    WHERE v.tenant_id = $1
      AND (v.deleted_at IS NULL)
      AND (v.status IN ('AVAILABLE', 'STANDBY', 'ACTIVE') OR v.status IS NULL)
    LIMIT 200
  `, tenantId).catch((err) => {
    console.error('[dispatch-optimiser] Failed to fetch vehicles:', err);
    return [] as VehicleRow[];
  });

  // 3. Fetch available drivers with licensing compliance and live availability/HOS
  const drivers = await prisma.$queryRawUnsafe<DriverRow[]>(`
    SELECT d.id::text,
           d.first_name,
           d.last_name,
           d.assigned_vehicle_id::text,
           da.status AS availability_status,
           da.hours_worked_today::float8,
           da.shift_start,
           da.shift_end,
           vl.lat::float8 AS current_lat,
           vl.lng::float8 AS current_lng,
           d.communication_language AS language,
           COALESCE(d.license_type, 'LIGHT') AS license_class,
           d.license_expiry,
           d.status
    FROM drivers d
    LEFT JOIN driver_availability da ON da.driver_id = d.id::text
    LEFT JOIN vehicle_locations vl ON vl.vehicle_id = d.assigned_vehicle_id::text
    WHERE d.tenant_id = $1
      AND (d.deleted_at IS NULL)
      AND (d.status IN ('ACTIVE', 'AVAILABLE', 'ON_SHIFT') OR d.status IS NULL)
    LIMIT 200
  `, tenantId).catch((err) => {
    console.error('[dispatch-optimiser] Failed to fetch drivers:', err);
    return [] as DriverRow[];
  });

  // 4. Build vehicle map
  const vehicleMap = new Map(vehicles.map(v => [v.id, v]));

  // Helper date checker
  const now = new Date();
  const isFutureDate = (d: Date | string | null | undefined): boolean => {
    if (!d) return true; // if not tracked, assume valid
    const dateObj = typeof d === 'string' ? new Date(d) : d;
    return dateObj.getTime() > now.getTime();
  };

  // 5. Build candidates — driver + their assigned or available vehicle
  const candidates: DriverCandidate[] = [];
  for (const d of drivers) {
    const veh = d.assigned_vehicle_id ? vehicleMap.get(d.assigned_vehicle_id) : (vehicles.length > 0 ? vehicles[0] : null);
    if (!veh) continue;

    const hoursWorked = d.hours_worked_today ?? 0;
    const hoursRemaining = Math.max(0, 10 - hoursWorked); // Max 10h shift standard

    const isRegValid = isFutureDate(veh.registration_expiry) && isFutureDate(veh.mulkiya_expiry);
    const isInsValid = isFutureDate(veh.insurance_expiry);
    const isLicValid = isFutureDate(d.license_expiry) && d.status !== 'SUSPENDED' && d.status !== 'INACTIVE';

    candidates.push({
      driverId:            d.id,
      driverName:          `${d.first_name ?? 'Driver'} ${d.last_name ?? d.id.slice(0, 6)}`.trim(),
      vehicleId:           veh.id,
      vehicleCode:         veh.vehicle_code,
      vehicleType:         veh.vehicle_type ?? 'SEDAN',
      capacity:            veh.capacity ?? 4,
      currentLat:          d.current_lat ?? veh.current_lat ?? 25.2048,
      currentLng:          d.current_lng ?? veh.current_lng ?? 55.2708,
      avgSpeedKmh:         40,
      hoursRemainingToday: hoursRemaining,
      ragScore:            88, // standard high baseline
      fatigueScore:        Math.min(1.0, hoursWorked / 10 * 0.7), // fatigue scales with shift hours
      currentJobCount:     0,
      languages:           d.language ? [d.language, 'en'] : ['en', 'ar'],
      licenseClasses:      d.license_class ? [d.license_class] : ['LIGHT'],
      vehicleRiskScore:    veh.risk_score ?? 0.15,
      zonesServed:         [],
      isVehicleRegistered: isRegValid,
      isVehicleInsured:    isInsValid,
      isDriverLicensed:    isLicValid,
      baseDepotLat:        25.2048,
      baseDepotLng:        55.2708,
    });
  }

  let processed = 0;
  let autoDispatchedCount = 0;
  let totalMatrixElements = 0;
  let totalCacheHits = 0;
  let totalCostAvoidedAed = 0;
  const recommendations: Record<string, unknown>[] = [];

  // 6. Score each job with Spatial Shortlist & Top-5 Road Matrix Refinement
  for (const job of jobs) {
    if (candidates.length === 0) break;

    const meta = job.metadata ?? {};
    const jobReq: JobRequirements = {
      jobId:                job.id,
      serviceType:          job.service_type,
      priority:             job.priority,
      pickupLat:            job.pickup_lat ?? 25.2048,
      pickupLng:            job.pickup_lng ?? 55.2708,
      dropoffLat:           job.dropoff_lat ?? null,
      dropoffLng:           job.dropoff_lng ?? null,
      requiredCapacity:     job.required_capacity ?? 1,
      requiredVehicleTypes: meta.requiredVehicleTypes ?? [],
      requiredLicenseClass: meta.requiredLicenseClass ?? null,
      slaDeadline:          job.sla_deadline ? new Date(job.sla_deadline) : null,
      estimatedDurationMin: meta.estimatedDurationMin ?? 45,
      customerLanguage:     meta.customerLanguage ?? null,
      zoneId:               job.zone_id,
    };

    const routingResult = await rankCandidatesWithRouting(candidates, jobReq, {
      maxCandidates: 20,
      topKRefineMatrix: 5,
      tenantId,
    });

    const ranked = routingResult.ranked;
    if (ranked.length === 0) continue;

    totalMatrixElements += routingResult.matrixElementsQueried;
    totalCacheHits += routingResult.cacheHits;
    totalCostAvoidedAed += routingResult.costAvoidedAed;

    const top = ranked[0];

    // Determine auto-dispatch eligibility:
    // If job has autoDispatch enabled or score exceeds 0.85 and candidate is not blocked
    const autoDispatchThreshold = meta.autoDispatchThreshold ?? 0.85;
    const shouldAutoDispatch = !top.isBlocked && top.compositeScore >= autoDispatchThreshold && (meta.autoDispatch === true || job.priority === 'P1' || job.priority === 'EMERGENCY');

    let recStatus = 'SUGGESTED';

    if (shouldAutoDispatch) {
      try {
        await prisma.$executeRawUnsafe(`
          UPDATE dispatch_jobs
          SET status              = 'OFFERED',
              assigned_driver_id  = $1,
              assigned_vehicle_id = $2,
              dispatch_score      = $3,
              current_attempt     = current_attempt + 1,
              updated_at          = NOW()
          WHERE id = $4::uuid
        `, top.driverId, top.vehicleId, top.compositeScore, job.id);

        await prisma.$executeRawUnsafe(`
          INSERT INTO dispatch_attempts (
            dispatch_job_id, attempt_number, driver_id, vehicle_id,
            score, distance_km, eta_minutes, offered_at, score_breakdown
          ) VALUES ($1::uuid, 1, $2, $3, $4, $5, $6, NOW(), $7::jsonb)
        `, job.id, top.driverId, top.vehicleId, top.compositeScore, top.distanceKm, top.etaMinutes, JSON.stringify(top.factors));

        recStatus = 'APPLIED';
        autoDispatchedCount++;
      } catch (assignErr) {
        console.error(`[dispatch-optimiser] Failed to auto-dispatch job ${job.id}:`, assignErr);
      }
    }

    await prisma.$executeRawUnsafe(`
      INSERT INTO dispatch_optimiser_recommendations (
        job_id, job_service_type, job_priority,
        recommended_driver_id, recommended_vehicle_id,
        composite_score, factor_scores, candidates_evaluated,
        reason, confidence, status, applied_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11, CASE WHEN $11 = 'APPLIED' THEN NOW() ELSE NULL END)
      ON CONFLICT (job_id) DO UPDATE SET
        recommended_driver_id  = EXCLUDED.recommended_driver_id,
        recommended_vehicle_id = EXCLUDED.recommended_vehicle_id,
        composite_score        = EXCLUDED.composite_score,
        factor_scores          = EXCLUDED.factor_scores,
        candidates_evaluated   = EXCLUDED.candidates_evaluated,
        reason                 = EXCLUDED.reason,
        confidence             = EXCLUDED.confidence,
        status                 = EXCLUDED.status,
        applied_at             = EXCLUDED.applied_at,
        updated_at             = NOW()
    `,
      job.id, job.service_type, job.priority,
      top.driverId, top.vehicleId,
      top.compositeScore,
      JSON.stringify(top.factors),
      ranked.length,
      top.reason,
      top.compositeScore,
      recStatus,
    );

    recommendations.push({
      jobId:              job.id,
      serviceType:        job.service_type,
      priority:           job.priority,
      recommendedDriver:  top.driverName,
      recommendedVehicle: top.vehicleCode,
      score:              top.compositeScore,
      candidates:         ranked.length,
      distanceKm:         top.distanceKm,
      etaMinutes:         top.etaMinutes,
      isMatrixRefined:    top.isMatrixRefined ?? false,
      status:             recStatus,
      isBlocked:          top.isBlocked,
      reason:             top.reason,
    });

    processed++;
  }

  return {
    agentId: 'dispatch-optimiser', tenantId, eventType: event.event_type,
    status: 'COMPLETED', durationMs: Date.now() - t0,
    itemsProcessed: jobs.length, actionsCreated: processed,
    telemetry: {
      matrixElementsQueried: totalMatrixElements,
      cacheHits: totalCacheHits,
      costAvoidedAed: totalCostAvoidedAed,
    },
    output: {
      summary: `Evaluated ${jobs.length} job(s) across ${candidates.length} candidates (spatially pre-filtered to Top-20 with Top-5 road matrix refinement). Generated ${processed} recommendation(s) (${autoDispatchedCount} auto-dispatched). Avoided ${totalCostAvoidedAed.toFixed(2)} AED in routing matrix calls.${entityId ? ` [single-job mode: ${entityId}]` : ''}`,
      recommendations,
      routingStats: {
        matrixElementsQueried: totalMatrixElements,
        cacheHits: totalCacheHits,
        costAvoidedAed: totalCostAvoidedAed,
      },
    },
  };
}

export const DISPATCH_OPTIMISER_AGENT: AgentDefinition = {
  id:          'dispatch-optimiser',
  name:        'Smart Dispatch Optimiser Agent',
  description: '15-factor statistical scoring model that evaluates live HOS, compliance, deadhead, maintenance risk, and proximity with spatial shortlisting to execute semi-autonomous dispatch.',
  version:     '2.1.0',
  agentType:   'BATCH',
  subscribedEvents: ['dispatch.job_created', 'dispatch.job_reassign', 'manual.trigger', 'schedule.hourly'],
  supportsEntityScan: true,
  run: runDispatchOptimiser,
};
