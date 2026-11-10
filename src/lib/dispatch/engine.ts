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
import type { DispatchJob, Candidate, ServiceType, DispatchPriority, DispatchStatus } from './types';

type Row = Record<string, unknown>;
const n = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const s = (v: unknown) => String(v ?? '');
const j = <T>(v: unknown, fb: T): T => {
  if (!v) return fb;
  try { return (typeof v === 'string' ? JSON.parse(v) : v) as T; }
  catch { return fb; }
};

/* ─────────────────────────────────────────────────────────────
   Load dispatch job from DB (supports both pickup_* and origin_* columns)
───────────────────────────────────────────────────────────── */
async function loadJob(jobId: string): Promise<DispatchJob | null> {
  const [r] = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT * FROM dispatch_jobs WHERE id = $1::uuid`, jobId
  ).catch(() => [] as Row[]);
  if (!r) return null;

  const rawPickupLat  = r.pickup_lat  ?? r.origin_lat;
  const rawPickupLng  = r.pickup_lng  ?? r.origin_lng;
  const rawDropoffLat = r.dropoff_lat ?? r.dest_lat;
  const rawDropoffLng = r.dropoff_lng ?? r.dest_lng;
  const rawMeta       = r.metadata    ?? r.meta;

  return {
    id:                 s(r.id),
    tenantId:           s(r.tenant_id),
    bookingId:          r.booking_id ? s(r.booking_id) : undefined,
    serviceType:        s(r.service_type) as ServiceType,
    priority:           s(r.priority)     as DispatchPriority,
    status:             s(r.status)       as DispatchStatus,
    currentAttempt:     n(r.current_attempt),
    maxAttempts:        n(r.max_attempts) || 3,
    pickupLat:          rawPickupLat  != null ? n(rawPickupLat)  : undefined,
    pickupLng:          rawPickupLng  != null ? n(rawPickupLng)  : undefined,
    dropoffLat:         rawDropoffLat != null ? n(rawDropoffLat) : undefined,
    dropoffLng:         rawDropoffLng != null ? n(rawDropoffLng) : undefined,
    originAddress:      r.origin_address ? s(r.origin_address) : undefined,
    destinationAddress: r.destination_address ? s(r.destination_address) : undefined,
    scheduledPickup:    r.scheduled_pickup ? new Date(s(r.scheduled_pickup)) : undefined,
    passengerCount:     r.passenger_count != null ? n(r.passenger_count) : undefined,
    zoneId:             r.zone_id ? s(r.zone_id) : undefined,
    slaDeadline:        r.sla_deadline ? new Date(s(r.sla_deadline)) : undefined,
    assignedDriverId:   (r.assigned_driver_id ?? r.driver_id) ? s(r.assigned_driver_id ?? r.driver_id) : undefined,
    assignedVehicleId:  (r.assigned_vehicle_id ?? r.vehicle_id) ? s(r.assigned_vehicle_id ?? r.vehicle_id) : undefined,
    metadata:           j<Record<string, unknown>>(rawMeta, {}),
    createdAt:          new Date(s(r.created_at)),
    updatedAt:          new Date(s(r.updated_at)),
  };
}

/* ─────────────────────────────────────────────────────────────
   Atomic lock via interactive transaction + SELECT FOR UPDATE SKIP LOCKED
───────────────────────────────────────────────────────────── */
async function lockCandidate(candidate: Candidate, jobId: string): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRawUnsafe<{ driver_id: string }[]>(`
        SELECT driver_id FROM driver_availability
        WHERE driver_id = $1 AND status = 'AVAILABLE'
        FOR UPDATE SKIP LOCKED
      `, candidate.driverId);
      if (!row) return false;

      const vUpdated = await tx.$executeRawUnsafe(`
        UPDATE vehicles SET status = 'IN_USE'
        WHERE id::text = $1 AND status = 'AVAILABLE'
      `, candidate.vehicleId);
      if (!vUpdated) return false;

      await tx.$executeRawUnsafe(`
        UPDATE driver_availability
        SET status = 'BUSY', current_job_id = $2::uuid, updated_at = NOW()
        WHERE driver_id = $1
      `, candidate.driverId, jobId);

      return true;
    });
  } catch {
    return false;
  }
}

async function releaseLock(candidate: { driverId: string; vehicleId: string }, jobId?: string): Promise<void> {
  if (candidate.driverId) {
    if (jobId) {
      await prisma.$executeRawUnsafe(`
        UPDATE driver_availability
        SET status = 'AVAILABLE', current_job_id = NULL, updated_at = NOW()
        WHERE driver_id = $1 AND (current_job_id IS NULL OR current_job_id = $2::uuid)
      `, candidate.driverId, jobId).catch(() => {});
    } else {
      await prisma.$executeRawUnsafe(`
        UPDATE driver_availability
        SET status = 'AVAILABLE', current_job_id = NULL, updated_at = NOW()
        WHERE driver_id = $1
      `, candidate.driverId).catch(() => {});
    }
  }

  if (candidate.vehicleId) {
    await prisma.$executeRawUnsafe(`
      UPDATE vehicles SET status = 'AVAILABLE' WHERE id::text = $1
    `, candidate.vehicleId).catch(() => {});
  }
}

/* ─────────────────────────────────────────────────────────────
   Sync dispatch assignment to linked Booking record (if any)
───────────────────────────────────────────────────────────── */
async function syncBookingAssignment(
  bookingId: string | undefined,
  tenantId: string,
  driverId: string,
  vehicleId: string,
  status: 'CONFIRMED' | 'ACTIVE' = 'CONFIRMED',
): Promise<void> {
  if (!bookingId) return;
  await prisma.$executeRawUnsafe(`
    UPDATE bookings
    SET status     = $3,
        driver_id  = CASE WHEN $4 ~* '^[0-9a-f-]{36}$' THEN $4::uuid ELSE driver_id END,
        vehicle_id = CASE WHEN $5 ~* '^[0-9a-f-]{36}$' THEN $5::uuid ELSE vehicle_id END,
        updated_at = NOW()
    WHERE (id::text = $1 OR booking_ref = $1)
      AND tenant_id::text = $2
  `, bookingId, tenantId, status, driverId, vehicleId).catch(() => {});
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
      (gen_random_uuid(), $1::uuid, $2, $3, $4, $5, $6, $7, NOW(), $8::jsonb, $9)
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
    UPDATE dispatch_jobs SET status = 'SEARCHING', updated_at = NOW() WHERE id = $1::uuid
  `, jobId).catch(() => {});

  // ── AMBULANCE P1 / P2: try preemption first ────────────────
  if (job.serviceType === 'AMBULANCE' && ['P1', 'P2'].includes(job.priority) && config.allowPreemption) {
    const preempt = await attemptPreemption(job);
    if (preempt.preempted && preempt.vehicleId && preempt.driverId) {
      const preemptCandidate: Candidate = {
        driverId:        preempt.driverId,
        vehicleId:       preempt.vehicleId,
        driverPhone:     preempt.driverPhone,
        distanceKm:      0,
        etaMinutes:      0,
        driverRating:    4.5,
        vehicleCapacity: 1,
        utilizationScore: 0,
        costPerKm:       0,
      };
      const token = await createAttempt(jobId, 1, preemptCandidate);

      await prisma.$executeRawUnsafe(`
        UPDATE dispatch_jobs
        SET status              = 'OFFERED',
            assigned_driver_id  = $2,
            assigned_vehicle_id = $3,
            driver_id           = $2,
            vehicle_id          = $3,
            current_attempt     = 1,
            updated_at          = NOW()
        WHERE id = $1::uuid
      `, jobId, preempt.driverId, preempt.vehicleId).catch(() => {});

      await notifyDriver(preemptCandidate, job, token, baseUrl, preempt.driverPhone);

      // Re-dispatch the displaced lower-priority job asynchronously so it isn't orphaned
      if (preempt.displacedJobId) {
        void runDispatch(preempt.displacedJobId, baseUrl).catch(() => {});
      }

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
        WHERE id = $1::uuid
      `, jobId).catch(() => {});
    }
    return { status: 'NO_CANDIDATES', jobId, candidatesFound: 0 };
  }

  // ── Score + rank ───────────────────────────────────────────
  const ranked: Candidate[] = rankCandidates(candidates, job, config.weights);

  // ── Try each candidate ─────────────────────────────────────
  let attempt = job.currentAttempt;
  const maxAttempts = Math.max(config.maxAttempts, job.maxAttempts || 3);
  for (const candidate of ranked) {
    if (attempt >= maxAttempts) break;
    attempt++;

    await prisma.$executeRawUnsafe(`
      UPDATE dispatch_jobs SET current_attempt = $2, updated_at = NOW() WHERE id = $1::uuid
    `, jobId, attempt).catch(() => {});

    const locked = await lockCandidate(candidate, jobId);
    if (!locked) continue;   // already taken by concurrent dispatch

    const token = await createAttempt(jobId, attempt, candidate);

    await prisma.$executeRawUnsafe(`
      UPDATE dispatch_jobs
      SET status              = 'OFFERED',
          assigned_driver_id  = $2,
          assigned_vehicle_id = $3,
          driver_id           = $2,
          vehicle_id          = $3,
          dispatch_score      = $4,
          updated_at          = NOW()
      WHERE id = $1::uuid
    `, jobId, candidate.driverId, candidate.vehicleId, candidate.score ?? 0).catch(() => {});

    // Notify driver — passes candidate.driverPhone so WhatsApp + DB notification fire
    await notifyDriver(candidate, job, token, baseUrl, candidate.driverPhone);

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
      WHERE id = $1::uuid
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
  await ensureDispatchSchema();

  type AttemptRow = Row & {
    id: string;
    dispatch_job_id: string;
    driver_id: string;
    vehicle_id: string;
    response?: string | null;
  };

  const [attempt] = await prisma.$queryRawUnsafe<AttemptRow[]>(`
    SELECT * FROM dispatch_attempts WHERE accept_token = $1
  `, acceptToken).catch(() => [] as AttemptRow[]);

  if (!attempt) return { ok: false, message: 'Invalid or expired token' };

  const jobId     = s(attempt.dispatch_job_id);
  const driverId  = s(attempt.driver_id);
  const vehicleId = s(attempt.vehicle_id);

  // Guard against duplicate / out-of-order responses on an already-settled attempt
  if (attempt.response && attempt.response !== 'PENDING') {
    return {
      ok: false,
      jobId,
      message: `Dispatch offer was already ${String(attempt.response).toLowerCase()}`,
    };
  }

  // Load current job state to prevent late rejections/timeouts from clobbering an accepted job
  const job = await loadJob(jobId);
  if (!job) return { ok: false, message: 'Dispatch job not found' };

  const response = action === 'accept' ? 'ACCEPTED' : action === 'reject' ? 'REJECTED' : 'TIMEOUT';
  await prisma.$executeRawUnsafe(`
    UPDATE dispatch_attempts
    SET response = $2, rejection_reason = $3, responded_at = NOW()
    WHERE accept_token = $1 AND (response IS NULL OR response = 'PENDING')
  `, acceptToken, response, reason ?? null).catch(() => {});

  if (action === 'accept') {
    if (!['OFFERED', 'SEARCHING', 'RETRYING'].includes(job.status)) {
      return { ok: false, jobId, message: `Job is no longer available (current status: ${job.status})` };
    }

    // Confirm dispatch on both column conventions
    await prisma.$executeRawUnsafe(`
      UPDATE dispatch_jobs
      SET status              = 'ACCEPTED',
          assigned_driver_id  = $2,
          assigned_vehicle_id = $3,
          driver_id           = $2,
          vehicle_id          = $3,
          updated_at          = NOW()
      WHERE id = $1::uuid
    `, jobId, driverId, vehicleId).catch(() => {});

    // Update driver availability
    await prisma.$executeRawUnsafe(`
      UPDATE driver_availability
      SET status = 'BUSY', current_job_id = $2::uuid, updated_at = NOW()
      WHERE driver_id = $1
    `, driverId, jobId).catch(() => {});

    // Sync driver & vehicle assignment back to the linked booking record
    await syncBookingAssignment(job.bookingId, job.tenantId, driverId, vehicleId, 'CONFIRMED');

    return { ok: true, jobId, message: 'Dispatch accepted' };
  } else {
    // Only release lock and re-dispatch if the job is still OFFERED to this driver
    if (job.status === 'OFFERED' && (!job.assignedDriverId || job.assignedDriverId === driverId)) {
      await releaseLock({ driverId, vehicleId }, jobId);

      await prisma.$executeRawUnsafe(`
        UPDATE dispatch_jobs
        SET status              = 'RETRYING',
            assigned_driver_id  = NULL,
            assigned_vehicle_id = NULL,
            driver_id           = NULL,
            vehicle_id          = NULL,
            updated_at          = NOW()
        WHERE id = $1::uuid AND status = 'OFFERED'
      `, jobId).catch(() => {});

      // Directly invoke runDispatch in-process so re-dispatch never fails due to missing HTTP auth headers
      await runDispatch(jobId, baseUrl ?? '');
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
  tenantId?: string,
): Promise<boolean> {
  await ensureDispatchSchema();

  const job = await loadJob(jobId);
  if (!job) return false;
  if (tenantId && job.tenantId !== tenantId) return false;

  // If the job had a different driver/vehicle previously locked, release them
  if (job.assignedDriverId && job.assignedDriverId !== driverId) {
    await releaseLock({
      driverId: job.assignedDriverId,
      vehicleId: job.assignedVehicleId ?? '',
    }, jobId);
  }

  await prisma.$executeRawUnsafe(`
    UPDATE dispatch_jobs
    SET status              = 'ACCEPTED',
        assigned_driver_id  = $2,
        assigned_vehicle_id = $3,
        driver_id           = $2,
        vehicle_id          = $3,
        updated_at          = NOW()
    WHERE id = $1::uuid AND tenant_id = $4
  `, jobId, driverId, vehicleId, job.tenantId).catch(() => {});

  await prisma.$executeRawUnsafe(`
    UPDATE driver_availability
    SET status = 'BUSY', current_job_id = $2::uuid, updated_at = NOW()
    WHERE driver_id = $1
  `, driverId, jobId).catch(() => {});

  await prisma.$executeRawUnsafe(`
    UPDATE vehicles SET status = 'IN_USE' WHERE id::text = $1 AND tenant_id::text = $2
  `, vehicleId, job.tenantId).catch(() => {});

  await syncBookingAssignment(job.bookingId, job.tenantId, driverId, vehicleId, 'CONFIRMED');

  await prisma.$executeRawUnsafe(`
    INSERT INTO audit_logs (entity_type, entity_id, action, user_id, details)
    VALUES ('DispatchJob', $1, 'MANUAL_OVERRIDE', $2, $3)
  `, jobId, adminId ?? 'system',
    `Admin manually assigned driver ${driverId} / vehicle ${vehicleId}`
  ).catch(() => {});

  return true;
}
