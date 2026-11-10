/**
 * Event-Driven Merge Trigger
 *
 * Called immediately after a new dispatch job is inserted.
 * Runs a targeted merge scan for the new job against all eligible
 * PENDING/SEARCHING jobs in the same tenant, and persists the best
 * candidates to `dispatch_merge_suggestions`.
 */

import { prisma }              from '@/lib/prisma';
import { haversineKm,
         getMergeCandidates,
         loadMergeConfigPublic } from '@/lib/dispatch/merge';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';

/* ─────────────────────────────────────────────────────────────
   Service types eligible for merge
───────────────────────────────────────────────────────────── */
const MERGEABLE_TYPES = new Set(['PASSENGER', 'FREIGHT', 'DELIVERY']);

/* ─────────────────────────────────────────────────────────────
   The new job shape passed from the creation endpoint
───────────────────────────────────────────────────────────── */
export interface NewJobPayload {
  id:           string;
  tenant_id:    string;
  service_type: string;
  priority:     string;
  origin_lat?:  number;
  origin_lng?:  number;
  dest_lat?:    number;
  dest_lng?:    number;
  origin_address?:     string;
  destination_address?: string;
  scheduled_pickup?:   string;
  passenger_count?:    number;
}

export interface MergeSuggestionResult {
  suggestionsCreated: number;
  topSuggestion: {
    suggestionId:     string;
    candidateJobId:   string;
    mergeScore:       number;
    pickupRoadKm:     number;
    estimatedSavingKm: number;
    mergeReasons:     string[];
    routingSource:    string;
  } | null;
}

/* ─────────────────────────────────────────────────────────────
   Main trigger — call this fire-and-forget after job creation
───────────────────────────────────────────────────────────── */
export async function triggerMergeScanOnCreate(
  job: NewJobPayload,
): Promise<MergeSuggestionResult> {
  const result: MergeSuggestionResult = { suggestionsCreated: 0, topSuggestion: null };

  try {
    // ── Guard 1: Only mergeable service types ──
    if (!MERGEABLE_TYPES.has(job.service_type)) {
      return result;
    }

    // ── Guard 2: Must have GPS coordinates for Haversine pre-filter ──
    if (!job.origin_lat || !job.origin_lng) {
      return result;
    }

    await ensureDispatchSchema();

    // ── Load tenant merge config ──
    const config = await loadMergeConfigPublic(job.tenant_id);
    if (!config.tripMergingEnabled) {
      return result;
    }

    // ── Query candidates: same tenant, same service type, PENDING/SEARCHING, last 6h ──
    type Row = Record<string, unknown>;
    const candidateRows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT id, service_type, priority, status,
             COALESCE(origin_lat, pickup_lat)   AS origin_lat,
             COALESCE(origin_lng, pickup_lng)   AS origin_lng,
             COALESCE(dest_lat,   dropoff_lat)  AS dest_lat,
             COALESCE(dest_lng,   dropoff_lng)  AS dest_lng,
             origin_address, destination_address,
             scheduled_pickup, passenger_count, created_at
      FROM   dispatch_jobs
      WHERE  tenant_id    = $1
        AND  id           != $2::uuid
        AND  service_type = $3
        AND  status IN ('PENDING', 'SEARCHING')
        AND  created_at >= NOW() - INTERVAL '6 hours'
      ORDER  BY created_at ASC
      LIMIT  30
    `, job.tenant_id, job.id, job.service_type);

    if (candidateRows.length === 0) {
      return result;
    }

    // ── Haversine pre-filter — eliminate obviously too-far candidates ──
    const haversineLimit = config.pickupDistanceKm * 2.5;
    const nearbyRows = candidateRows.filter(row => {
      if (!row.origin_lat || !row.origin_lng) return false;
      const km = haversineKm(
        { lat: job.origin_lat!,          lng: job.origin_lng! },
        { lat: Number(row.origin_lat),    lng: Number(row.origin_lng) },
      );
      return km <= haversineLimit;
    });

    if (nearbyRows.length === 0) {
      return result;
    }

    // ── Full evaluation via getMergeCandidates (reuses routing API + cache) ──
    const { candidates } = await getMergeCandidates(job.id, job.tenant_id);

    const eligible = candidates.filter(c => c.eligible);
    if (eligible.length === 0) {
      return result;
    }

    // ── Persist each eligible suggestion ──
    const suggestionIds: string[] = [];

    for (const cand of eligible) {
      try {
        const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(`
          INSERT INTO dispatch_merge_suggestions (
            tenant_id, job_a_id, job_b_id,
            merge_score, pickup_road_km, pickup_time_diff_min,
            dropoff_road_km, combined_passengers, estimated_saving_km,
            routing_source, merge_reasons,
            status, triggered_by,
            expires_at
          ) VALUES (
            $1, $2::uuid, $3::uuid,
            $4, $5, $6,
            $7, $8, $9,
            $10, $11::jsonb,
            'PENDING', 'JOB_CREATE',
            NOW() + INTERVAL '30 minutes'
          )
          ON CONFLICT (job_a_id, job_b_id) DO NOTHING
          RETURNING id
        `,
          job.tenant_id,
          job.id,
          cand.candidateJobId,
          cand.mergeScore,
          cand.pickupRoadDistKm   ?? null,
          cand.pickupTimeDiffMin  ?? null,
          cand.dropoffRoadDistKm  ?? null,
          cand.combinedPassengers ?? null,
          cand.estimatedSavingKm  ?? null,
          cand.routingSource      ?? 'STRAIGHT_LINE',
          JSON.stringify(cand.mergeReasons ?? []),
        );

        if (rows[0]?.id) {
          suggestionIds.push(rows[0].id);
          result.suggestionsCreated++;
        }
      } catch (insertErr) {
        console.warn(`[merge-trigger] Suggestion insert skipped:`, insertErr);
      }
    }

    if (suggestionIds.length > 0 && eligible.length > 0) {
      const top = eligible[0];
      result.topSuggestion = {
        suggestionId:     suggestionIds[0],
        candidateJobId:   top.candidateJobId,
        mergeScore:       top.mergeScore,
        pickupRoadKm:     top.pickupRoadDistKm,
        estimatedSavingKm: top.estimatedSavingKm,
        mergeReasons:     top.mergeReasons,
        routingSource:    top.routingSource,
      };
    }
  } catch (err) {
    console.error(`[merge-trigger] Error during merge scan for job ${job.id}:`, err);
  }

  return result;
}

/* ─────────────────────────────────────────────────────────────
   Expire stale suggestions (call periodically or on-read)
───────────────────────────────────────────────────────────── */
export async function expireOldSuggestions(tenantId?: string): Promise<number> {
  try {
    if (tenantId) {
      const result = await prisma.$executeRawUnsafe(`
        UPDATE dispatch_merge_suggestions
        SET    status = 'EXPIRED', actioned_at = NOW()
        WHERE  status = 'PENDING'
          AND  expires_at < NOW()
          AND  tenant_id = $1
      `, tenantId);
      return Number(result);
    }
    const result = await prisma.$executeRawUnsafe(`
      UPDATE dispatch_merge_suggestions
      SET    status = 'EXPIRED', actioned_at = NOW()
      WHERE  status = 'PENDING'
        AND  expires_at < NOW()
    `);
    return Number(result);
  } catch {
    return 0;
  }
}

/* ─────────────────────────────────────────────────────────────
   Also expire suggestions where either job is no longer PENDING
───────────────────────────────────────────────────────────── */
export async function expireOrphanedSuggestions(tenantId?: string): Promise<number> {
  try {
    if (tenantId) {
      const result = await prisma.$executeRawUnsafe(`
        UPDATE dispatch_merge_suggestions s
        SET    status = 'EXPIRED', actioned_at = NOW()
        WHERE  s.status = 'PENDING'
          AND  s.tenant_id = $1
          AND  EXISTS (
            SELECT 1 FROM dispatch_jobs j
            WHERE  (j.id = s.job_a_id OR j.id = s.job_b_id)
              AND  j.status NOT IN ('PENDING', 'SEARCHING')
          )
      `, tenantId);
      return Number(result);
    }
    const result = await prisma.$executeRawUnsafe(`
      UPDATE dispatch_merge_suggestions s
      SET    status = 'EXPIRED', actioned_at = NOW()
      WHERE  s.status = 'PENDING'
        AND  EXISTS (
          SELECT 1 FROM dispatch_jobs j
          WHERE  (j.id = s.job_a_id OR j.id = s.job_b_id)
            AND  j.status NOT IN ('PENDING', 'SEARCHING')
        )
    `);
    return Number(result);
  } catch {
    return 0;
  }
}
