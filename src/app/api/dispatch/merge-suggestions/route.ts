/**
 * GET /api/dispatch/merge-suggestions?tenantId=X[&status=PENDING]
 *
 * Lightweight endpoint polled by Command Centre every 30 seconds.
 * Returns persisted merge suggestions from dispatch_merge_suggestions,
 * populated by the event-driven trigger (merge-trigger.ts) on job creation.
 *
 * This is MUCH cheaper than the scan-mode in /api/dispatch/merge-candidates:
 *   Scan mode  → routing API calls for every pending pair every 30s
 *   This mode  → single indexed DB read, sub-millisecond
 *
 * Side effects on read:
 *   1. Expires TTL-lapsed suggestions (expires_at < NOW())
 *   2. Expires orphaned suggestions where job_a is no longer PENDING/SEARCHING
 *
 * Response shape:
 *   { suggestions: MergeSuggestion[], total: number, expiredCount: number }
 *
 * PATCH /api/dispatch/merge-suggestions
 *   Body: { suggestionId, action: 'ACCEPT' | 'SKIP', tenantId }
 *   Updates suggestion status and actioned_at timestamp.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma }                     from '@/lib/prisma';
import { ensureDispatchSchema }       from '@/lib/dispatch/schema';
import {
  expireOldSuggestions,
  expireOrphanedSuggestions,
}                                     from '@/lib/dispatch/merge-trigger';

type Row = Record<string, unknown>;

function serialize(rows: Row[]): Row[] {
  return rows.map(r => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) {
      if (v instanceof Date)     { out[k] = v.toISOString(); continue; }
      if (typeof v === 'bigint') { out[k] = Number(v);       continue; }
      out[k] = v;
    }
    return out;
  });
}

export async function GET(req: NextRequest) {
  try {
    await ensureDispatchSchema();

    const sp       = new URL(req.url).searchParams;
    const tenantId = sp.get('tenantId') ?? '';
    const status   = sp.get('status')   ?? 'PENDING';
    const limit    = Math.min(50, parseInt(sp.get('limit') ?? '20'));

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    // ── On-read expiry cleanup (cheap — indexed updates) ──
    const [expiredTtl, expiredOrphan] = await Promise.all([
      expireOldSuggestions(tenantId),
      expireOrphanedSuggestions(tenantId),
    ]);
    const expiredCount = expiredTtl + expiredOrphan;

    // ── Fetch suggestions joined with both jobs for display context ──
    const rows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT
        s.id                   AS suggestion_id,
        s.job_a_id,
        s.job_b_id,
        s.merge_score,
        s.pickup_road_km,
        s.pickup_time_diff_min,
        s.dropoff_road_km,
        s.combined_passengers,
        s.estimated_saving_km,
        s.routing_source,
        s.merge_reasons,
        s.status,
        s.triggered_by,
        s.created_at,
        s.expires_at,
        s.actioned_at,
        s.merged_job_id,
        -- Job A details (the new / trigger job)
        ja.service_type        AS job_a_service_type,
        ja.priority            AS job_a_priority,
        ja.status              AS job_a_status,
        ja.origin_lat          AS job_a_origin_lat,
        ja.origin_lng          AS job_a_origin_lng,
        ja.dest_lat            AS job_a_dest_lat,
        ja.dest_lng            AS job_a_dest_lng,
        ja.origin_address      AS job_a_origin_address,
        ja.destination_address AS job_a_dest_address,
        ja.scheduled_pickup    AS job_a_scheduled_pickup,
        ja.passenger_count     AS job_a_passenger_count,
        ja.created_at          AS job_a_created_at,
        -- Job B details (the candidate)
        jb.service_type        AS job_b_service_type,
        jb.priority            AS job_b_priority,
        jb.status              AS job_b_status,
        jb.origin_lat          AS job_b_origin_lat,
        jb.origin_lng          AS job_b_origin_lng,
        jb.dest_lat            AS job_b_dest_lat,
        jb.dest_lng            AS job_b_dest_lng,
        jb.origin_address      AS job_b_origin_address,
        jb.destination_address AS job_b_dest_address,
        jb.scheduled_pickup    AS job_b_scheduled_pickup,
        jb.passenger_count     AS job_b_passenger_count,
        jb.created_at          AS job_b_created_at
      FROM dispatch_merge_suggestions s
      JOIN dispatch_jobs ja ON ja.id = s.job_a_id
      JOIN dispatch_jobs jb ON jb.id = s.job_b_id
      WHERE s.tenant_id = $1
        AND s.status    = $2
        AND s.expires_at > NOW()
      ORDER BY s.merge_score DESC, s.created_at DESC
      LIMIT $3
    `, tenantId, status, limit);

    // Parse JSONB merge_reasons if returned as string
    const suggestions = serialize(rows).map(r => ({
      ...r,
      merge_reasons: typeof r.merge_reasons === 'string'
        ? JSON.parse(r.merge_reasons as string)
        : (r.merge_reasons ?? []),
    }));

    return NextResponse.json({
      suggestions,
      total:        suggestions.length,
      expiredCount,
    });
  } catch (err) {
    console.error('[dispatch/merge-suggestions GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * PATCH — action a suggestion (ACCEPT or SKIP)
 */
export async function PATCH(req: NextRequest) {
  try {
    await ensureDispatchSchema();

    const { suggestionId, action, tenantId } = await req.json();

    if (!suggestionId || !action || !tenantId) {
      return NextResponse.json(
        { error: 'suggestionId, action, and tenantId are required' },
        { status: 400 },
      );
    }

    const validActions = ['ACCEPT', 'SKIP'];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { error: `action must be one of: ${validActions.join(', ')}` },
        { status: 400 },
      );
    }

    const newStatus = action === 'ACCEPT' ? 'ACCEPTED' : 'SKIPPED';

    const result = await prisma.$executeRawUnsafe(`
      UPDATE dispatch_merge_suggestions
      SET    status      = $1,
             actioned_at = NOW()
      WHERE  id        = $2::uuid
        AND  tenant_id = $3
        AND  status    = 'PENDING'
    `, newStatus, suggestionId, tenantId);

    if (Number(result) === 0) {
      return NextResponse.json(
        { error: 'Suggestion not found, already actioned, or does not belong to this tenant' },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, suggestionId, status: newStatus });
  } catch (err) {
    console.error('[dispatch/merge-suggestions PATCH]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
