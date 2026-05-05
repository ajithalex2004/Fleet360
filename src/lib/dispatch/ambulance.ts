/**
 * TRIPEXL Ambulance Dispatch — Priority Override + Preemption Layer
 *
 * P1 (cardiac arrest / life-threatening): full preemption from low-priority jobs
 * P2 (trauma / urgent):                  limited preemption (P3 / SCHEDULED only)
 * P3 (scheduled transfer):               normal pipeline, no preemption
 */

import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import type { DispatchJob, DispatchPriority, Candidate } from './types';
import { haversineKm } from './eligibility';

/* ─────────────────────────────────────────────────────────────
   Priority definitions
───────────────────────────────────────────────────────────── */

export const AMBULANCE_PRIORITY_LABELS: Record<string, string> = {
  P1: 'P1 — Life-Threatening (Full Preemption)',
  P2: 'P2 — Urgent / Trauma (Limited Preemption)',
  P3: 'P3 — Scheduled Transfer (Normal Pipeline)',
};

/** Which dispatch priorities can be preempted by each ambulance priority */
export function preemptiblePriorities(priority: DispatchPriority): DispatchPriority[] {
  switch (priority) {
    case 'P1': return ['P3', 'SCHEDULED', 'NORMAL'];   // full preemption
    case 'P2': return ['P3', 'SCHEDULED'];              // limited
    case 'P3': return [];                               // no preemption
    default:   return [];
  }
}

/* ─────────────────────────────────────────────────────────────
   Preemption engine
───────────────────────────────────────────────────────────── */

export interface PreemptionResult {
  preempted:       boolean;
  vehicleId?:      string;
  driverId?:       string;
  displacedJobId?: string;
  reason?:         string;
}

/**
 * Attempt to reclaim the nearest ambulance from a lower-priority job.
 * Returns the preempted vehicle+driver if successful.
 */
export async function attemptPreemption(job: DispatchJob): Promise<PreemptionResult> {
  // Only ambulance jobs can preempt
  if (job.serviceType !== 'AMBULANCE') return { preempted: false };

  const targets = preemptiblePriorities(job.priority as DispatchPriority);
  if (targets.length === 0) return { preempted: false };

  const prioList = targets.map(p => `'${p}'`).join(',');

  type TargetRow = {
    id: string;
    assigned_vehicle_id: string;
    assigned_driver_id: string;
    priority: string;
    lat: string | number;
    lng: string | number;
  };

  // Find nearest OFFERED or ACCEPTED ambulance job with lower priority
  const rows = await prisma.$queryRawUnsafe<TargetRow[]>(`
    SELECT
      dj.id,
      dj.assigned_vehicle_id,
      dj.assigned_driver_id,
      dj.priority,
      COALESCE(vl.lat, 0) AS lat,
      COALESCE(vl.lng, 0) AS lng
    FROM dispatch_jobs dj
    LEFT JOIN vehicle_locations vl ON vl.vehicle_id = dj.assigned_vehicle_id
    WHERE dj.status     IN ('OFFERED', 'ACCEPTED')
      AND dj.service_type = 'AMBULANCE'
      AND dj.priority   IN (${prioList})
      AND dj.tenant_id  =  $1
    ORDER BY
      CASE dj.status WHEN 'OFFERED' THEN 0 ELSE 1 END,  -- prefer offered (not yet in motion)
      created_at ASC
  `, job.tenantId).catch(() => [] as TargetRow[]);

  if (!rows.length) return { preempted: false, reason: 'No preemptible ambulance job found' };

  // Pick closest to the new emergency pickup
  let best = rows[0];
  if (job.pickupLat != null && job.pickupLng != null) {
    const pickup = { lat: job.pickupLat, lng: job.pickupLng };
    best = rows.reduce((prev, cur) => {
      const dPrev = haversineKm({ lat: Number(prev.lat), lng: Number(prev.lng) }, pickup);
      const dCur  = haversineKm({ lat: Number(cur.lat),  lng: Number(cur.lng)  }, pickup);
      return dCur < dPrev ? cur : prev;
    }, rows[0]);
  }

  // Displace the lower-priority job → RETRYING (it will re-enter dispatch queue)
  await prisma.$executeRawUnsafe(`
    UPDATE dispatch_jobs
    SET
      status              = 'RETRYING',
      assigned_vehicle_id = NULL,
      assigned_driver_id  = NULL,
      updated_at          = NOW()
    WHERE id = $1
  `, best.id).catch(() => {});

  // Release lock on displaced driver
  await prisma.$executeRawUnsafe(`
    UPDATE driver_availability SET status = 'AVAILABLE', current_job_id = NULL WHERE driver_id = $1
  `, best.assigned_driver_id).catch(() => {});

  // Audit
  await prisma.$executeRawUnsafe(`
    INSERT INTO audit_logs (entity_type, entity_id, action, details)
    VALUES ('DispatchJob', $1, 'PREEMPTED',
            $2)
  `, best.id,
    `Preempted by ${job.priority} ambulance job ${job.id} — displaced to RETRYING`
  ).catch(() => {});

  return {
    preempted:       true,
    vehicleId:       String(best.assigned_vehicle_id),
    driverId:        String(best.assigned_driver_id),
    displacedJobId:  String(best.id),
  };
}

/* ─────────────────────────────────────────────────────────────
   Ambulance fallback
   If no ideal ambulance found after full preemption attempt:
   1. Assign closest partially-compliant unit (BLS if ALS required)
   2. Simultaneously alert command center
───────────────────────────────────────────────────────────── */

export async function ambulanceFallback(
  job: DispatchJob,
  partialCandidates: Candidate[],
): Promise<{ assigned: boolean; candidate?: Candidate }> {
  // Escalate regardless
  await prisma.$executeRawUnsafe(`
    UPDATE dispatch_jobs
    SET status = 'ESCALATED', escalated_at = NOW(), updated_at = NOW()
    WHERE id = $1
  `, job.id).catch(() => {});

  await prisma.$executeRawUnsafe(`
    INSERT INTO audit_logs (entity_type, entity_id, action, details)
    VALUES ('DispatchJob', $1, 'ESCALATED',
            'No fully compliant ambulance found — command center alerted')
  `, job.id).catch(() => {});

  // If partially-compliant candidate exists, assign it as emergency backup
  if (partialCandidates.length > 0) {
    const backup = partialCandidates.sort((a, b) => a.etaMinutes - b.etaMinutes)[0];
    await prisma.$executeRawUnsafe(`
      UPDATE dispatch_jobs
      SET assigned_driver_id  = $2,
          assigned_vehicle_id = $3,
          updated_at = NOW()
      WHERE id = $1
    `, job.id, backup.driverId, backup.vehicleId).catch(() => {});

    await prisma.$executeRawUnsafe(`
      INSERT INTO audit_logs (entity_type, entity_id, action, details)
      VALUES ('DispatchJob', $1, 'FALLBACK_ASSIGNED',
              $2)
    `, job.id,
      `Fallback unit ${backup.vehicleId} (${backup.ambulanceLevel ?? 'UNKNOWN'}) assigned — ETA ${backup.etaMinutes} min`
    ).catch(() => {});

    return { assigned: true, candidate: backup };
  }

  return { assigned: false };
}

/* ─────────────────────────────────────────────────────────────
   Dynamic priority tier info for UI / API
───────────────────────────────────────────────────────────── */

export const AMBULANCE_TIERS = [
  {
    priority:    'P1' as const,
    label:       'P1 — Life-Threatening',
    examples:    'Cardiac arrest, respiratory failure, severe trauma',
    preemption:  'Full — reclaims P3 / SCHEDULED / NORMAL ambulances',
    etaWeight:   '70%',
    crossZone:   true,
    color:       'rose',
  },
  {
    priority:    'P2' as const,
    label:       'P2 — Urgent',
    examples:    'Trauma, stroke symptoms, severe allergic reaction',
    preemption:  'Limited — reclaims P3 / SCHEDULED ambulances only',
    etaWeight:   '60%',
    crossZone:   true,
    color:       'amber',
  },
  {
    priority:    'P3' as const,
    label:       'P3 — Scheduled Transfer',
    examples:    'Non-emergency hospital transfer, outpatient pickup',
    preemption:  'None — runs through normal dispatch pipeline',
    etaWeight:   '40%',
    crossZone:   false,
    color:       'blue',
  },
];
