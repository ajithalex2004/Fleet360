export const dynamic = 'force-dynamic';

/**
 * GET  /api/dispatch/merge-candidates?jobId=X&tenantId=Y
 * GET  /api/dispatch/merge-candidates?tenantId=Y&scan=true
 * POST /api/dispatch/merge-candidates
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { getMergeCandidates, haversineKm, evaluatePair, loadMergeConfigPublic } from '@/lib/dispatch/merge';
import { prisma } from '@/lib/prisma';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
type Row = Record<string, unknown>;

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      await ensureDispatchSchema();

      const sp    = new URL(req.url).searchParams;
      const jobId = sp.get('jobId') ?? '';
      const scan  = sp.get('scan') === 'true';

      /* ── Scan mode: find ALL merge pairs across pending jobs ── */
      if (scan) {
        const rows = await tx.$queryRawUnsafe<Row[]>(`
          SELECT id, service_type, priority, status,
                 COALESCE(origin_lat, pickup_lat)   AS origin_lat,
                 COALESCE(origin_lng, pickup_lng)   AS origin_lng,
                 COALESCE(dest_lat,   dropoff_lat)  AS dest_lat,
                 COALESCE(dest_lng,   dropoff_lng)  AS dest_lng,
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

        const pairs: Awaited<ReturnType<typeof evaluatePair>>[] = [];
        const jobs  = rows.map(r => rowToJob(r));

        const evalQueue: Promise<void>[] = [];

        for (let i = 0; i < jobs.length; i++) {
          for (let j = i + 1; j < jobs.length; j++) {
            if (jobs[i].service_type !== jobs[j].service_type) continue;
            if (jobs[i].origin_lat && jobs[i].origin_lng && jobs[j].origin_lat && jobs[j].origin_lng) {
              const hav = haversineKm(
                { lat: jobs[i].origin_lat!, lng: jobs[i].origin_lng! },
                { lat: jobs[j].origin_lat!, lng: jobs[j].origin_lng! },
              );
              if (hav > config.pickupDistanceKm * 2.5) continue;
            }
            evalQueue.push(
              evaluatePair(jobs[i], jobs[j], config).then(r => { pairs.push(r); })
            );
            if (evalQueue.length >= 40) break;
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
  });
}

/* ── POST: execute a merge (mark two jobs as merged, create combined job) ── */
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      await ensureDispatchSchema();

      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const { jobIdA, jobIdB, adminId } = body;
      if (!jobIdA || !jobIdB) {
        return NextResponse.json({ error: 'jobIdA, jobIdB required' }, { status: 400 });
      }

      const [jobA] = await tx.$queryRawUnsafe<Row[]>(`
        SELECT * FROM dispatch_jobs WHERE id = $1::uuid AND tenant_id = $2
      `, jobIdA, tenantId);
      const [jobB] = await tx.$queryRawUnsafe<Row[]>(`
        SELECT * FROM dispatch_jobs WHERE id = $1::uuid AND tenant_id = $2
      `, jobIdB, tenantId);

      if (!jobA || !jobB) {
        return NextResponse.json({ error: 'One or both jobs not found' }, { status: 404 });
      }

      const originLatA = jobA.origin_lat ?? jobA.pickup_lat ?? null;
      const originLngA = jobA.origin_lng ?? jobA.pickup_lng ?? null;
      const originLatB = jobB.origin_lat ?? jobB.pickup_lat ?? null;
      const originLngB = jobB.origin_lng ?? jobB.pickup_lng ?? null;
      const destLatA   = jobA.dest_lat   ?? jobA.dropoff_lat ?? null;
      const destLngA   = jobA.dest_lng   ?? jobA.dropoff_lng ?? null;
      const destLatB   = jobB.dest_lat   ?? jobB.dropoff_lat ?? null;
      const destLngB   = jobB.dest_lng   ?? jobB.dropoff_lng ?? null;
      const combinedPax = Number(jobA.passenger_count ?? 1) + Number(jobB.passenger_count ?? 1);

      const metaJson = JSON.stringify({
        passengerCount: combinedPax,
        mergedFrom:  [jobIdA, jobIdB],
        mergedBy:    adminId ?? 'system',
        mergedAt:    new Date().toISOString(),
        multiStop:   true,
        stops:       [
          { lat: originLatA, lng: originLngA, address: jobA.origin_address,      type: 'PICKUP' },
          { lat: originLatB, lng: originLngB, address: jobB.origin_address,      type: 'PICKUP' },
          { lat: destLatA,   lng: destLngA,   address: jobA.destination_address, type: 'DROPOFF' },
          { lat: destLatB,   lng: destLngB,   address: jobB.destination_address, type: 'DROPOFF' },
        ],
      });

      // Create merged job populating both pickup_*/dropoff_* and origin_*/dest_* columns
      const [merged] = await tx.$queryRawUnsafe<{ id: string }[]>(`
        INSERT INTO dispatch_jobs
          (tenant_id, service_type, priority, status,
           pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
           origin_lat, origin_lng, dest_lat, dest_lng,
           origin_address, destination_address,
           passenger_count, scheduled_pickup, metadata, meta)
        VALUES
          ($1, $2, $3, 'PENDING',
           $4, $5, $6, $7,
           $4, $5, $6, $7,
           $8, $9,
           $10, $11, $12::jsonb, $12::jsonb)
        RETURNING id
      `,
        tenantId,
        jobA.service_type,
        priorityRank(String(jobA.priority)) >= priorityRank(String(jobB.priority))
          ? jobA.priority : jobB.priority,
        originLatA, originLngA,
        destLatB,   destLngB,
        jobA.origin_address      ?? null,
        jobB.destination_address ?? null,
        combinedPax,
        jobA.scheduled_pickup ?? null,
        metaJson,
      );

      // Cancel original jobs scoped strictly to tenantId
      await Promise.all([
        tx.$executeRawUnsafe(
          `UPDATE dispatch_jobs SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1::uuid AND tenant_id = $2`,
          jobIdA,
          tenantId,
        ),
        tx.$executeRawUnsafe(
          `UPDATE dispatch_jobs SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1::uuid AND tenant_id = $2`,
          jobIdB,
          tenantId,
        ),
      ]);

      // Audit
      await tx.$executeRawUnsafe(`
        INSERT INTO audit_logs (entity_type, entity_id, action, user_id, details)
        VALUES ('DispatchJob', $1, 'MERGED', $2, $3)
      `, merged.id, adminId ?? 'system',
        JSON.stringify({ mergedFrom: [jobIdA, jobIdB] })
      ).catch(() => {});

      return NextResponse.json({ ok: true, mergedJobId: merged.id });
    } catch (err) {
      console.error('[dispatch/merge-candidates POST]', err);
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  });
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
