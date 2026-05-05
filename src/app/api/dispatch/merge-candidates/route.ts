/**
 * GET  /api/dispatch/merge-candidates?jobId=X&tenantId=Y
 *      Returns ranked merge candidates for a specific dispatch job.
 *      Uses the three-stage merge engine:
 *        1. Haversine pre-filter
 *        2. Routing API road distance (GOOGLE_MAPS | OSRM | MAPBOX)
 *        3. Weighted merge scoring (0–100)
 *
 * GET  /api/dispatch/merge-candidates?tenantId=Y&scan=true
 *      Scans ALL PENDING jobs for the tenant and returns all merge opportunity pairs.
 *      Used by the Command Centre to populate the Merge Recommendations panel.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getMergeCandidates, haversineKm, evaluatePair, loadMergeConfigPublic } from '@/lib/dispatch/merge';
import { prisma } from '@/lib/prisma';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';

type Row = Record<string, unknown>;

export async function GET(req: NextRequest) {
  try {
    await ensureDispatchSchema();

    const sp       = new URL(req.url).searchParams;
    const jobId    = sp.get('jobId')   ?? '';
    const tenantId = sp.get('tenantId') ?? '';
    const scan     = sp.get('scan')    === 'true';

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    /* ── Scan mode: find ALL merge pairs across pending jobs ── */
    if (scan) {
      const rows = await prisma.$queryRawUnsafe<Row[]>(`
        SELECT id, service_type, priority, status,
               origin_lat, origin_lng, dest_lat, dest_lng,
               origin_address, destination_address,
               scheduled_pickup, passenger_count, created_at
        FROM dispatch_jobs
        WHERE tenant_id = $1
          AND status IN ('PENDING', 'SEARCHING')
          AND created_at >= NOW() - INTERVAL '6 hours'
        ORDER BY created_at ASC
        LIMIT 50
      `, tenantId);

      if (rows.length < 2) {
        return NextResponse.json({ pairs: [], total: 0 });
      }

      const config = await loadMergeConfigPublic(tenantId);
      if (!config.tripMergingEnabled) {
        return NextResponse.json({ pairs: [], total: 0, reason: 'Trip merging disabled for this tenant' });
      }

      // Evaluate unique pairs (A,B) where A < B by index
      const pairs: Awaited<ReturnType<typeof evaluatePair>>[] = [];
      const jobs  = rows.map(r => rowToJob(r));

      const evalQueue: Promise<void>[] = [];

      for (let i = 0; i < jobs.length; i++) {
        for (let j = i + 1; j < jobs.length; j++) {
          if (jobs[i].service_type !== jobs[j].service_type) continue;
          // Quick Haversine guard before queueing async work
          if (jobs[i].origin_lat && jobs[i].origin_lng && jobs[j].origin_lat && jobs[j].origin_lng) {
            const hav = haversineKm(
              { lat: jobs[i].origin_lat!, lng: jobs[i].origin_lng! },
              { lat: jobs[j].origin_lat!, lng: jobs[j].origin_lng! },
            );
            if (hav > config.pickupDistanceKm * 2.5) continue; // far too far — skip
          }
          evalQueue.push(
            evaluatePair(jobs[i], jobs[j], config).then(r => { pairs.push(r); })
          );
          if (evalQueue.length >= 40) break; // cap concurrent API calls
        }
        if (evalQueue.length >= 40) break;
      }

      await Promise.all(evalQueue);

      const eligible = pairs
        .filter(p => p.eligible)
        .sort((a, b) => b.mergeScore - a.mergeScore);

      return NextResponse.json({
        pairs:   serialize(eligible),
        total:   eligible.length,
        config: {
          engine:            config.routingEngine,
          pickupDistanceKm:  config.pickupDistanceKm,
          pickupWindowMin:   config.pickupTimeWindowMin,
          maxPassengers:     config.maxPassengers,
          requireDropoff:    config.requireDropoffMatch,
          dropoffDistanceKm: config.dropoffDistanceKm,
        },
      });
    }

    /* ── Single job mode ── */
    if (!jobId) {
      return NextResponse.json({ error: 'jobId or scan=true is required' }, { status: 400 });
    }

    const { candidates, config, targetJob } = await getMergeCandidates(jobId, tenantId);

    return NextResponse.json({
      targetJob,
      candidates: serialize(candidates),
      eligible:   candidates.filter(c => c.eligible).length,
      total:      candidates.length,
      config: {
        engine:           config.routingEngine,
        pickupDistanceKm: config.pickupDistanceKm,
        pickupWindowMin:  config.pickupTimeWindowMin,
        maxPassengers:    config.maxPassengers,
      },
    });
  } catch (err) {
    console.error('[dispatch/merge-candidates GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ── POST: execute a merge (mark two jobs as merged, create combined job) ── */
export async function POST(req: NextRequest) {
  try {
    await ensureDispatchSchema();

    const { jobIdA, jobIdB, tenantId, adminId } = await req.json();
    if (!jobIdA || !jobIdB || !tenantId) {
      return NextResponse.json({ error: 'jobIdA, jobIdB, tenantId required' }, { status: 400 });
    }

    // Mark both jobs as CANCELLED with merge reason, create a new combined job
    const [jobA] = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT * FROM dispatch_jobs WHERE id = $1::uuid AND tenant_id = $2
    `, jobIdA, tenantId);
    const [jobB] = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT * FROM dispatch_jobs WHERE id = $1::uuid AND tenant_id = $2
    `, jobIdB, tenantId);

    if (!jobA || !jobB) {
      return NextResponse.json({ error: 'One or both jobs not found' }, { status: 404 });
    }

    // Create merged job — use jobA's origin, jobB's destination, combined passenger count
    const [merged] = await prisma.$queryRawUnsafe<{ id: string }[]>(`
      INSERT INTO dispatch_jobs
        (tenant_id, service_type, priority, status,
         origin_lat, origin_lng, dest_lat, dest_lng,
         origin_address, destination_address,
         passenger_count, scheduled_pickup, meta)
      VALUES
        ($1, $2, $3, 'PENDING',
         $4, $5, $6, $7,
         $8, $9,
         $10, $11, $12::jsonb)
      RETURNING id
    `,
      tenantId,
      jobA.service_type,
      // Use higher priority of the two
      priorityRank(String(jobA.priority)) >= priorityRank(String(jobB.priority))
        ? jobA.priority : jobB.priority,
      jobA.origin_lat ?? null, jobA.origin_lng ?? null,
      jobB.dest_lat   ?? null, jobB.dest_lng   ?? null,
      jobA.origin_address      ?? null,
      jobB.destination_address ?? null,
      (Number(jobA.passenger_count ?? 1) + Number(jobB.passenger_count ?? 1)),
      jobA.scheduled_pickup ?? null,
      JSON.stringify({
        mergedFrom:  [jobIdA, jobIdB],
        mergedBy:    adminId ?? 'system',
        mergedAt:    new Date().toISOString(),
        multiStop:   true,
        stops:       [
          { lat: jobA.origin_lat, lng: jobA.origin_lng, address: jobA.origin_address,   type: 'PICKUP' },
          { lat: jobB.origin_lat, lng: jobB.origin_lng, address: jobB.origin_address,   type: 'PICKUP' },
          { lat: jobA.dest_lat,   lng: jobA.dest_lng,   address: jobA.destination_address, type: 'DROPOFF' },
          { lat: jobB.dest_lat,   lng: jobB.dest_lng,   address: jobB.destination_address, type: 'DROPOFF' },
        ],
      }),
    );

    // Cancel original jobs with merge reference
    await Promise.all([
      prisma.$executeRawUnsafe(
        `UPDATE dispatch_jobs SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1::uuid`,
        jobIdA,
      ),
      prisma.$executeRawUnsafe(
        `UPDATE dispatch_jobs SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1::uuid`,
        jobIdB,
      ),
    ]);

    // Audit
    await prisma.$executeRawUnsafe(`
      INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, meta)
      VALUES ('DISPATCH_JOB', $1, 'MERGED', $2, $3::jsonb)
      ON CONFLICT DO NOTHING
    `, merged.id, adminId ?? 'system',
      JSON.stringify({ mergedFrom: [jobIdA, jobIdB] })
    ).catch(() => {});

    return NextResponse.json({ ok: true, mergedJobId: merged.id });
  } catch (err) {
    console.error('[dispatch/merge-candidates POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ── Helpers ── */
function priorityRank(p: string): number {
  return { P1: 5, EMERGENCY: 5, P2: 4, URGENT: 3, P3: 2, NORMAL: 1, SCHEDULED: 0 }[p] ?? 1;
}

function serialize(data: unknown): unknown {
  return JSON.parse(JSON.stringify(data, (_k, v) =>
    typeof v === 'bigint' ? Number(v) : v
  ));
}

function rowToJob(r: Row) {
  return {
    id:                  String(r.id),
    service_type:        String(r.service_type ?? ''),
    priority:            String(r.priority ?? 'NORMAL'),
    status:              String(r.status ?? ''),
    origin_lat:          r.origin_lat  != null ? Number(r.origin_lat)  : undefined,
    origin_lng:          r.origin_lng  != null ? Number(r.origin_lng)  : undefined,
    dest_lat:            r.dest_lat    != null ? Number(r.dest_lat)    : undefined,
    dest_lng:            r.dest_lng    != null ? Number(r.dest_lng)    : undefined,
    origin_address:      r.origin_address      ? String(r.origin_address)      : undefined,
    destination_address: r.destination_address ? String(r.destination_address) : undefined,
    scheduled_pickup:    r.scheduled_pickup    ? String(r.scheduled_pickup)    : undefined,
    passenger_count:     r.passenger_count != null ? Number(r.passenger_count) : undefined,
    created_at:          String(r.created_at ?? new Date().toISOString()),
  };
}
