/**
 * POST /api/dispatch/jobs/create
 *
 * Creates a new dispatch job and immediately fires the event-driven merge scan
 * in a non-blocking fire-and-forget manner.
 *
 * Required body fields:
 *   tenantId     string
 *   serviceType  string  — PASSENGER | FREIGHT | DELIVERY | AMBULANCE | TECHNICIAN | SCHOOL_BUS
 *   priority     string  — NORMAL | URGENT | EMERGENCY | SCHEDULED | P1 | P2 | P3
 *
 * Optional body fields:
 *   bookingId, originLat, originLng, destLat, destLng,
 *   originAddress, destinationAddress, scheduledPickup,
 *   passengerCount, zoneId, slaDeltaMinutes, metadata
 *
 * Response: { job, mergeSuggestion? }
 *   job             — the newly created dispatch_jobs row
 *   mergeSuggestion — topSuggestion from the merge scan (null if not eligible or no candidates)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma }                     from '@/lib/prisma';
import { ensureDispatchSchema }       from '@/lib/dispatch/schema';
import { triggerMergeScanOnCreate }   from '@/lib/dispatch/merge-trigger';
import { dispatch as agentDispatch }  from '@/lib/agents/orchestrator';

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

export async function POST(req: NextRequest) {
  try {
    await ensureDispatchSchema();

    const body = await req.json();

    const {
      tenantId,
      serviceType,
      priority       = 'NORMAL',
      bookingId,
      originLat,
      originLng,
      destLat,
      destLng,
      originAddress,
      destinationAddress,
      scheduledPickup,
      passengerCount,
      zoneId,
      slaDeltaMinutes,
      metadata,
    } = body;

    // ── Validation ──
    if (!tenantId)    return NextResponse.json({ error: 'tenantId is required' },    { status: 400 });
    if (!serviceType) return NextResponse.json({ error: 'serviceType is required' }, { status: 400 });

    const validServiceTypes = ['PASSENGER', 'FREIGHT', 'DELIVERY', 'AMBULANCE', 'TECHNICIAN', 'SCHOOL_BUS'];
    if (!validServiceTypes.includes(serviceType)) {
      return NextResponse.json(
        { error: `serviceType must be one of: ${validServiceTypes.join(', ')}` },
        { status: 400 },
      );
    }

    // ── Compute SLA deadline ──
    const slaMinutes = slaDeltaMinutes
      ? Number(slaDeltaMinutes)
      : serviceType === 'AMBULANCE' ? 15
      : serviceType === 'FREIGHT'   ? 120
      : 60;

    // ── Insert job ──
    const [row] = await prisma.$queryRawUnsafe<{ id: string }[]>(`
      INSERT INTO dispatch_jobs (
        tenant_id, booking_id, service_type, priority, status,
        origin_lat, origin_lng, dest_lat, dest_lng,
        origin_address, destination_address,
        scheduled_pickup, passenger_count,
        zone_id, sla_deadline, metadata,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 'PENDING',
        $5, $6, $7, $8,
        $9, $10,
        $11, $12,
        $13, NOW() + ($14 || ' minutes')::interval, $15::jsonb,
        NOW(), NOW()
      )
      RETURNING *
    `,
      tenantId,
      bookingId      ?? null,
      serviceType,
      priority,
      originLat      != null ? Number(originLat)  : null,
      originLng      != null ? Number(originLng)  : null,
      destLat        != null ? Number(destLat)    : null,
      destLng        != null ? Number(destLng)    : null,
      originAddress      ?? null,
      destinationAddress ?? null,
      scheduledPickup    ?? null,
      passengerCount != null ? Number(passengerCount) : null,
      zoneId         ?? null,
      String(slaMinutes),
      JSON.stringify(metadata ?? {}),
    );

    if (!row?.id) {
      return NextResponse.json({ error: 'Job insert returned no ID' }, { status: 500 });
    }

    // ── Fetch the full created row ──
    const [job] = serialize(
      await prisma.$queryRawUnsafe<Row[]>(
        `SELECT * FROM dispatch_jobs WHERE id = $1::uuid`,
        row.id,
      ),
    );

    // ── Fire Smart Dispatch Optimiser — non-blocking, fire-and-forget ──
    // Runs immediately after job creation so driver/vehicle recommendations are
    // ready before the dispatcher opens the job card.
    agentDispatch({
      agent_id:   'dispatch-optimiser',
      event_type: 'dispatch.job_created',
      tenant_id:  tenantId,
      entity_id:  String(row.id),
      payload:    { serviceType, priority },
    }).catch(err =>
      console.warn('[dispatch/jobs/create] optimiser trigger failed (non-fatal):', err),
    );

    // ── Fire merge scan — non-blocking, fire-and-forget ──
    // triggerMergeScanOnCreate is fully wrapped in try/catch internally.
    // We await it here so the response can include the topSuggestion inline,
    // but job creation has already succeeded above — failure here is safe.
    let mergeSuggestion: null | Record<string, unknown> = null;
    try {
      const mergeResult = await triggerMergeScanOnCreate({
        id:                   String(row.id),
        tenant_id:            tenantId,
        service_type:         serviceType,
        priority,
        origin_lat:           originLat  != null ? Number(originLat)  : undefined,
        origin_lng:           originLng  != null ? Number(originLng)  : undefined,
        dest_lat:             destLat    != null ? Number(destLat)    : undefined,
        dest_lng:             destLng    != null ? Number(destLng)    : undefined,
        origin_address:       originAddress      ?? undefined,
        destination_address:  destinationAddress ?? undefined,
        scheduled_pickup:     scheduledPickup    ?? undefined,
        passenger_count:      passengerCount != null ? Number(passengerCount) : undefined,
      });

      if (mergeResult.topSuggestion) {
        mergeSuggestion = mergeResult.topSuggestion as Record<string, unknown>;
      }
    } catch {
      // Merge scan failure must never prevent a successful job creation response
    }

    return NextResponse.json(
      {
        ok:  true,
        job,
        ...(mergeSuggestion ? { mergeSuggestion } : {}),
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[dispatch/jobs/create POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
