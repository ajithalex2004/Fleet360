/**
 * Smart Dispatch Optimiser Agent
 * --------------------------------
 * Evaluates all pending dispatch jobs and scores every available
 * driver/vehicle combination using the 15-factor scoring model.
 * Upserts top recommendations to dispatch_optimiser_recommendations.
 */
import { prisma } from '@/lib/prisma';
import { AgentDefinition, AgentEvent, AgentRunResult } from '../types';
import { rankCandidates, DriverCandidate, JobRequirements } from './scoring';

interface JobRow {
  id: string;
  service_type: string;
  priority: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  required_capacity: number | null;
  sla_deadline: string | null;
  zone_id: string | null;
  metadata: { estimatedDurationMin?: number; requiredVehicleTypes?: string[]; requiredLicenseClass?: string; customerLanguage?: string } | null;
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
}

interface DriverRow {
  id: string;
  first_name: string;
  last_name: string;
  assigned_vehicle_id: string | null;
  current_lat: number | null;
  current_lng: number | null;
  language: string | null;
  license_class: string | null;
}

async function runDispatchOptimiser(event: AgentEvent): Promise<AgentRunResult> {
  const t0 = Date.now();
  const tenantId = event.tenant_id;
  // When entity_id is provided (job_created / job_reassign), score only that one job.
  // When absent (manual.trigger / schedule.hourly), score all pending jobs for the tenant.
  const entityId = event.entity_id ?? null;

  // 1. Fetch pending jobs — always scoped to tenant; optionally single job
  const jobs = await (
    entityId
      ? prisma.$queryRawUnsafe<JobRow[]>(`
          SELECT id::text, service_type, priority,
                 pickup_lat::float8, pickup_lng::float8,
                 required_capacity::int, sla_deadline::text, zone_id, metadata
          FROM dispatch_jobs
          WHERE tenant_id = $1
            AND id = $2::uuid
            AND status IN ('PENDING', 'SEARCHING', 'RETRYING')
          LIMIT 1
        `, tenantId, entityId)
      : prisma.$queryRawUnsafe<JobRow[]>(`
          SELECT id::text, service_type, priority,
                 pickup_lat::float8, pickup_lng::float8,
                 required_capacity::int, sla_deadline::text, zone_id, metadata
          FROM dispatch_jobs
          WHERE tenant_id = $1
            AND status IN ('PENDING', 'SEARCHING', 'RETRYING')
          ORDER BY
            CASE priority
              WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'EMERGENCY' THEN 3
              WHEN 'URGENT' THEN 4 WHEN 'NORMAL' THEN 5 ELSE 6
            END,
            created_at ASC
          LIMIT 100
        `, tenantId)
  ).catch(() => [] as JobRow[]);

  if (jobs.length === 0) {
    return {
      agentId: 'dispatch-optimiser', tenantId, eventType: event.event_type,
      status: 'COMPLETED', durationMs: Date.now() - t0,
      itemsProcessed: 0, actionsCreated: 0,
      output: { summary: 'No pending dispatch jobs to optimise.', recommendations: [] },
    };
  }

  // 2. Fetch available vehicles — scoped to tenant
  const vehicles = await prisma.$queryRawUnsafe<VehicleRow[]>(`
    SELECT v.id::text, v.vehicle_code, v.vehicle_type,
           v.capacity::int, v.status,
           v.current_lat::float8, v.current_lng::float8,
           r.risk_score::float8
    FROM vehicles v
    LEFT JOIN fleet_risk_scores r ON r.vehicle_id = v.id
    WHERE v.tenant_id = $1
      AND v.status IN ('AVAILABLE', 'STANDBY')
    LIMIT 200
  `, tenantId).catch(() => [] as VehicleRow[]);

  // 3. Fetch available drivers — scoped to tenant
  const drivers = await prisma.$queryRawUnsafe<DriverRow[]>(`
    SELECT d.id::text, d.first_name, d.last_name,
           d.assigned_vehicle_id::text,
           d.current_lat::float8, d.current_lng::float8,
           d.language, d.license_class
    FROM drivers d
    WHERE d.tenant_id = $1
      AND d.status IN ('AVAILABLE', 'ON_SHIFT')
    LIMIT 200
  `, tenantId).catch(() => [] as DriverRow[]);

  // 4. Build vehicle map
  const vehicleMap = new Map(vehicles.map(v => [v.id, v]));

  // 5. Build candidates — driver + their assigned vehicle
  const candidates: DriverCandidate[] = [];
  for (const d of drivers) {
    const veh = d.assigned_vehicle_id ? vehicleMap.get(d.assigned_vehicle_id) : null;
    if (!veh) continue;

    candidates.push({
      driverId:        d.id,
      driverName:      `${d.first_name} ${d.last_name}`,
      vehicleId:       veh.id,
      vehicleCode:     veh.vehicle_code,
      vehicleType:     veh.vehicle_type ?? 'UNKNOWN',
      capacity:        veh.capacity ?? 4,
      currentLat:      d.current_lat ?? veh.current_lat,
      currentLng:      d.current_lng ?? veh.current_lng,
      avgSpeedKmh:     40,
      hoursRemainingToday: 8, // default — real HOS data comes from hos tables
      ragScore:        null,
      fatigueScore:    0.2,
      currentJobCount: 0,
      languages:       d.language ? [d.language] : ['en'],
      licenseClasses:  d.license_class ? [d.license_class] : [],
      vehicleRiskScore: veh.risk_score ?? 0.2,
      zonesServed:     [],
    });
  }

  let processed = 0;
  const recommendations: Record<string, unknown>[] = [];

  // 6. Score each job
  for (const job of jobs) {
    if (candidates.length === 0) break;

    const meta = job.metadata ?? {};
    const jobReq: JobRequirements = {
      jobId:                job.id,
      serviceType:          job.service_type,
      priority:             job.priority,
      pickupLat:            job.pickup_lat ?? 25.2048,
      pickupLng:            job.pickup_lng ?? 55.2708,
      requiredCapacity:     job.required_capacity ?? 1,
      requiredVehicleTypes: meta.requiredVehicleTypes ?? [],
      requiredLicenseClass: meta.requiredLicenseClass ?? null,
      slaDeadline:          job.sla_deadline ? new Date(job.sla_deadline) : null,
      estimatedDurationMin: meta.estimatedDurationMin ?? 45,
      customerLanguage:     meta.customerLanguage ?? null,
      zoneId:               job.zone_id,
    };

    const ranked = rankCandidates(candidates, jobReq);
    if (ranked.length === 0) continue;

    const top = ranked[0];

    await prisma.$executeRawUnsafe(`
      INSERT INTO dispatch_optimiser_recommendations (
        job_id, job_service_type, job_priority,
        recommended_driver_id, recommended_vehicle_id,
        composite_score, factor_scores, candidates_evaluated,
        reason, confidence, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,'SUGGESTED')
      ON CONFLICT (job_id) DO UPDATE SET
        recommended_driver_id  = EXCLUDED.recommended_driver_id,
        recommended_vehicle_id = EXCLUDED.recommended_vehicle_id,
        composite_score        = EXCLUDED.composite_score,
        factor_scores          = EXCLUDED.factor_scores,
        candidates_evaluated   = EXCLUDED.candidates_evaluated,
        reason                 = EXCLUDED.reason,
        confidence             = EXCLUDED.confidence,
        status                 = 'SUGGESTED',
        updated_at             = NOW()
    `,
      job.id, job.service_type, job.priority,
      top.driverId, top.vehicleId,
      top.compositeScore,
      JSON.stringify(top.factors),
      ranked.length,
      top.reason,
      top.compositeScore,
    );

    recommendations.push({
      jobId:          job.id,
      serviceType:    job.service_type,
      priority:       job.priority,
      recommendedDriver: top.driverName,
      recommendedVehicle: top.vehicleCode,
      score:          top.compositeScore,
      candidates:     ranked.length,
      reason:         top.reason,
    });

    processed++;
  }

  return {
    agentId: 'dispatch-optimiser', tenantId, eventType: event.event_type,
    status: 'COMPLETED', durationMs: Date.now() - t0,
    itemsProcessed: jobs.length, actionsCreated: processed,
    output: {
      summary: `Evaluated ${jobs.length} job(s) across ${candidates.length} candidates. Generated ${processed} recommendation(s).${entityId ? ` [single-job mode: ${entityId}]` : ''}`,
      recommendations,
    },
  };
}

export const DISPATCH_OPTIMISER_AGENT: AgentDefinition = {
  id:          'dispatch-optimiser',
  name:        'Smart Dispatch Optimiser Agent',
  description: '15-factor statistical scoring model that ranks every available driver/vehicle against each pending job to recommend optimal assignments.',
  version:     '1.0.0',
  agentType:   'BATCH',
  subscribedEvents: ['dispatch.job_created', 'dispatch.job_reassign', 'manual.trigger', 'schedule.hourly'],
  supportsEntityScan: true,
  run: runDispatchOptimiser,
};
