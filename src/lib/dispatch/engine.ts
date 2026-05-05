/**
 * TRIPEXL Dispatch Orchestrator
 * Core brain — runs the full dispatch pipeline for a given dispatch_job.
 *
 * Flow:
 *   1. Load job + config
 *   2. Ambulance P1/P2: attempt preemption first
 *   3. Build eligible candidate pool
 *   4. Score + rank candidates
 *   5. Try each in order: lock → offer → notify → wait
 *   6. On exhaustion: escalate to manual
 */

import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { ensureDispatchSchema, loadDispatchConfig } from './schema';
import { getEligibleCandidates, getAmbulanceEligibleCandidates } from './eligibility';
import { rankCandidates } from './scoring';
import { attemptPreemption, ambulanceFallback } from './ambulance';
import { notifyDriver } from './notifications';
import type { DispatchJob, Candidate, ServiceType, DispatchPriority } from './types';

type Row = Record<string, unknown>;
const n = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const s = (v: unknown) => String(v ?? '');
const j = <T>(v: unknown, fb: T): T => {
  if (!v) return fb;
  try { return (typeof v === 'string' ? JSON.parse(v) : v) as T; }
  catch { return fb; }
};

/* ─────────────────────────────────────────────────────────────
   Load dispatch job from DB
───────────────────────────────────────────────────────────── */
async function loadJob(jobId: string): Promise<DispatchJob | null> {
  const [r] = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT * FROM dispatch_jobs WHERE id = $1`, jobId
  ).catch(() => [] as Row[]);
  if (!r) return null;

  return {
    id:               s(r.id),
    tenantId:         s(r.tenant_id),
    bookingId:        r.booking_id ? s(r.booking_id) : undefined,
    serviceType:      s(r.service_type) as ServiceType,
    priority:         s(r.priority)     as DispatchPriority,
    status:           s(r.status)       as any,
    currentAttempt:   n(r.current_attempt),
    maxAttempts:      n(r.max_attempts),
    pickupLat:        r.pickup_lat  != null ? n(r.pickup_lat)  : undefined,
    pickupLng:        r.pickup_lng  != null ? n(r.pickup_lng)  : undefined,
    dropoffLat:       r.dropoff_lat != null ? n(r.dropoff_lat) : undefined,
    dropoffLng:       r.dropoff_lng != null ? n(r.dropoff_lng) : undefined,
    zoneId:           r.zone_id ? s(r.zone_id) : undefined,
    slaDeadline:      r.sla_deadline ? new Date(s(r.sla_deadline)) : undefined,
    metadata:         j<Record<string, unknown>>(r.metadata, {}),
    createdAt:        new Date(s(r.created_at)),
    updatedAt:        new Date(s(r.updated_at)),
  };
}

/* ─────────────────────────────────────────────────────────────
   Atomic lock via SELECT FOR UPDATE SKIP LOCKED
───────────────────────────────────────────────────────────── */
async function lockCandidate(candidate: Candidate): Promise<boolean> {
  try {
    const [row] = await prisma.$queryRawUnsafe<{ driver_id: string }[]>(`
      SELECT driver_id FROM driver_availability
      WHERE driver_id = $1 AND status = 'AVAILABLE'
      FOR UPDATE SKIP LOCKED
    `, candidate.driverId);
    if (!row) return false;

    await prisma.$executeRawUnsafe(`
      UPDATE driver_availability
      SET status = 'BUSY', current_job_id = NULL, updated_at = NOW()
      WHERE driver_id = $1
    `, candidate.driverId).catch(() => {});

    await prisma.$executeRawUnsafe(`
      UPDATE vehicles SET status = 'IN_USE'
      WHERE id::text = $1
    `, candidate.vehicleId).catch(() => {});

    return true;
  } catch {
    return false;
  }
}

async function releaseLock(candidate: Candidate): Promise<void> {
  await prisma.$executeRawUnsafe(`
    UPDATE driver_availability
    SET status = 'AVAILABLE', current_job_id = NULL
    WHERE driver_id = $1
  `, candidate.driverId).catch(() => {});

  await prisma.$executeRawUnsafe(`
    UPDATE vehicles SET status = 'AVAILABLE' WHERE id::text = $1
  `, candidate.vehicleId).catch(() => {});
}

/* ─────────────────────────────────────────────────────────────
   Create dispatch attempt + generate accept token
───────────────────────────────────────────────────────────── */
async function createAttempt(
  jobId:         string,
  attemptNumber: number,
  candidate:     Candidate,
): Promise<string> {
  const token = randomUUID();
  await prisma.$executeRawUnsafe(`
    INSERT INTO dispatch_attempts
      (id, dispatch_job_id, attempt_number, driver_id, vehicle_id,
       score, distance_km, eta_minutes, offered_at, score_breakdown, accept_token)
    VALUES
      (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), $8::jsonb, $9)
  `,
    jobId,
    attemptNumber,
    candidate.driverId,
    candidate.vehicleId,
    candidate.score    ?? 0,
    candidate.distanceKm,
    candidate.etaMinutes,
    JSON.stringify(candidate.scoreBreakdown ?? {}),
    token,
  ).catch(() => {});
  return token;
}

/* ─────────────────────────────────────────────────────────────
   Main orchestrator
───────────────────────────────────────────────────────────── */
export async function runDispatch(
  jobId:   string,
  baseUrl: string = '',
): Promise<{ status: string; jobId: string; candidatesFound: number }> {
  await ensureDispatchSchema();

  const job = await loadJob(jobId);
  if (!job) return { status: 'JOB_NOT_FOUND', jobId, candidatesFound: 0 };

  // Guard: only process jobs in PENDING or RETRYING state
  if (!['PENDING', 'RETRYING'].includes(job.status)) {
    return { status: 'ALREADY_PROCESSED', jobId, candidatesFound: 0 };
  }

  const config = await loadDispatchConfig(job.tenantId, job.serviceType, job.priority);

  // ── Update status → SEARCHING ──────────────────────────────
  await prisma.$executeRawUnsafe(`
    UPDATE dispatch_jobs SET status = 'SEARCHING', updated_at = NOW() WHERE id = $1
  `, jobId).catch(() => {});

  // ── AMBULANCE P1 / P2: try preemption first ────────────────
  if (job.serviceType === 'AMBULANCE' && ['P1', 'P2'].includes(job.priority)) {
    const preempt = await attemptPreemption(job);
    if (preempt.preempted && preempt.vehicleId && preempt.driverId) {
      const token = await createAttempt(jobId, 1, {
        driverId:        preempt.driverId,
        vehicleId:       preempt.vehicleId,
        distanceKm:      0,
        etaMinutes:      0,
        driverRating:    0,
        vehicleCapacity: 1,
        utilizationScore: 0,
        costPerKm:       0,
      });

      await prisma.$executeRawUnsafe(`
        UPDATE dispatch_jobs
        SET status              = 'OFFERED',
            assigned_driver_id  = $2,
            assigned_vehicle_id = $3,
            current_attempt     = 1,
            updated_at          = NOW()
        WHERE id = $1
      `, jobId, preempt.driverId, preempt.vehicleId).catch(() => {});

      await notifyDriver(
        { driverId: preempt.driverId, vehicleId: preempt.vehicleId, distanceKm: 0, etaMinutes: 0, driverRating: 0, vehicleCapacity: 1, utilizationScore: 0, costPerKm: 0 },
        job, token, baseUrl,
      );

      return { status: 'PREEMPTION_OFFERED', jobId, candidatesFound: 1 };
    }
  }

  // ── Build candidate pool ───────────────────────────────────
  let candidates: Candidate[];
  if (job.serviceType === 'AMBULANCE') {
    candidates = await getAmbulanceEligibleCandidates(
      job,
      config.dispatchRadiusKm,
      config.crossZoneAllowed,
    );
  } else {
    candidates = await getEligibleCandidates(
      job,
      config.dispatchRadiusKm,
      config.preferSameZone,
    );
  }

  if (candidates.length === 0) {
    // Ambulance fallback: escalate + alert
    if (job.serviceType === 'AMBULANCE') {
      await ambulanceFallback(job, []);
    } else {
      await prisma.$executeRawUnsafe(`
        UPDATE dispatch_jobs
        SET status = 'ESCALATED', escalated_at = NOW(), updated_at = NOW()
        WHERE id = $1
      `, jobId).catch(() => {});
    }
    return { status: 'NO_CANDIDATES', jobId, candidatesFound: 0 };
  }

  // ── Score + rank ───────────────────────────────────────────
  const ranked: Candidate[] = rankCandidates(candidates, job, config.weights);

  // ── Try each candidate ─────────────────────────────────────
  let attempt = job.currentAttempt;
  for (const candidate of ranked) {
    if (attempt >= config.maxAttempts) break;
    attempt++;

    await prisma.$executeRawUnsafe(`
      UPDATE dispatch_jobs SET current_attempt = $2, updated_at = NOW() WHERE id = $1
    `, jobId, attempt).catch(() => {});

    const locked = await lockCandidate(candidate);
    if (!locked) continue;   // already taken by concurrent dispatch

    const token = await createAttempt(jobId, attempt, candidate);

    await prisma.$executeRawUnsafe(`
      UPDATE dispatch_jobs
      SET status              = 'OFFERED',
          assigned_driver_id  = $2,
          assigned_vehicle_id = $3,
          dispatch_score      = $4,
          updated_at          = NOW()
      WHERE id = $1
    `, jobId, candidate.driverId, candidate.vehicleId, candidate.score ?? 0).catch(() => {});

    // Notify driver — fire-and-forget
    await notifyDriver(candidate, job, token, baseUrl);

    // Driver response handled asynchronously via /api/dispatch/respond
    return { status: 'OFFERED', jobId, candidatesFound: candidates.length };
  }

  // ── All candidates exhausted → escalate ───────────────────
  if (job.serviceType === 'AMBULANCE') {
    await ambulanceFallback(job, candidates);
  } else {
    await prisma.$executeRawUnsafe(`
      UPDATE dispatch_jobs
      SET status = 'ESCALATED', escalated_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, jobId).catch(() => {});
  }

  return { status: 'ESCALATED', jobId, candidatesFound: candidates.length };
}

/* ─────────────────────────────────────────────────────────────
   Handle driver response (accept / reject / timeout)
───────────────────────────────────────────────────────────── */
export async function handleDriverResponse(
  acceptToken: string,
  action:      'accept' | 'reject' | 'timeout',
  reason?:     string,
  baseUrl?:    string,
): Promise<{ ok: boolean; jobId?: string; message: string }> {
  type AttemptRow = Row & {
    id: string; dispatch_job_id: string; driver_id: string; vehicle_id: string;
  };

  const [attempt] = await prisma.$queryRawUnsafe<AttemptRow[]>(`
    SELECT * FROM dispatch_attempts WHERE accept_token = $1
  `, acceptToken).catch(() => [] as AttemptRow[]);

  if (!attempt) return { ok: false, message: 'Invalid or expired token' };

  const jobId    = s(attempt.dispatch_job_id);
  const driverId = s(attempt.driver_id);
  const vehicleId = s(attempt.vehicle_id);

  // Mark attempt responded
  const response = action === 'accept' ? 'ACCEPTED' : action === 'reject' ? 'REJECTED' : 'TIMEOUT';
  await prisma.$executeRawUnsafe(`
    UPDATE dispatch_attempts
    SET response = $2, rejection_reason = $3, responded_at = NOW()
    WHERE accept_token = $1
  `, acceptToken, response, reason ?? null).catch(() => {});

  if (action === 'accept') {
    // Confirm dispatch
    await prisma.$executeRawUnsafe(`
      UPDATE dispatch_jobs
      SET status = 'ACCEPTED', updated_at = NOW()
      WHERE id = $1 AND status = 'OFFERED'
    `, jobId).catch(() => {});

    // Update driver availability
    await prisma.$executeRawUnsafe(`
      UPDATE driver_availability
      SET status = 'BUSY', current_job_id = $2
      WHERE driver_id = $1
    `, driverId, jobId).catch(() => {});

    return { ok: true, jobId, message: 'Dispatch accepted' };
  } else {
    // Release lock
    await releaseLock({ driverId, vehicleId, distanceKm: 0, etaMinutes: 0, driverRating: 0, vehicleCapacity: 0, utilizationScore: 0, costPerKm: 0 });

    // Re-trigger dispatch (next candidate)
    await prisma.$executeRawUnsafe(`
      UPDATE dispatch_jobs
      SET status = 'RETRYING', updated_at = NOW()
      WHERE id = $1
    `, jobId).catch(() => {});

    // Fire re-dispatch (async)
    if (baseUrl) {
      fetch(`${baseUrl}/api/dispatch/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      }).catch(() => {});
    }

    return { ok: true, jobId, message: `Dispatch ${action}ed — re-dispatching` };
  }
}

/* ─────────────────────────────────────────────────────────────
   Manual override (admin)
───────────────────────────────────────────────────────────── */
export async function manualOverride(
  jobId:     string,
  driverId:  string,
  vehicleId: string,
  adminId?:  string,
): Promise<void> {
  await prisma.$executeRawUnsafe(`
    UPDATE dispatch_jobs
    SET status              = 'ACCEPTED',
        assigned_driver_id  = $2,
        assigned_vehicle_id = $3,
        updated_at          = NOW()
    WHERE id = $1
  `, jobId, driverId, vehicleId).catch(() => {});

  await prisma.$executeRawUnsafe(`
    UPDATE driver_availability SET status = 'BUSY' WHERE driver_id = $1
  `, driverId).catch(() => {});

  await prisma.$executeRawUnsafe(`
    INSERT INTO audit_logs (entity_type, entity_id, action, user_id, details)
    VALUES ('DispatchJob', $1, 'MANUAL_OVERRIDE', $2, $3)
  `, jobId, adminId ?? 'system',
    `Admin manually assigned driver ${driverId} / vehicle ${vehicleId}`
  ).catch(() => {});
}
