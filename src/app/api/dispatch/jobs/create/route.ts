export const dynamic = 'force-dynamic';

/**
 * POST /api/dispatch/jobs/create
 *
 * Creates a new dispatch job, populates both coordinate conventions
 * (origin/dest and pickup/dropoff), and immediately fires the
 * event-driven merge scan and dispatch engine in a non-blocking manner.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma }                     from '@/lib/prisma';
import { ensureDispatchSchema }       from '@/lib/dispatch/schema';
import { triggerMergeScanOnCreate }   from '@/lib/dispatch/merge-trigger';
import { runDispatch }                from '@/lib/dispatch/engine';
import { dispatch as agentDispatch }  from '@/lib/agents/orchestrator';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
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

      const {
        serviceType,
        priority       = 'NORMAL',
        bookingId,
        originLat,
        originLng,
        destLat,
        destLng,
        pickupLat,
        pickupLng,
        dropoffLat,
        dropoffLng,
        originAddress,
        destinationAddress,
        scheduledPickup,
        passengerCount,
        zoneId,
        slaDeltaMinutes,
        metadata,
        autoTrigger = true,
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

      const effOriginLat = originLat ?? pickupLat;
      const effOriginLng = originLng ?? pickupLng;
      const effDestLat   = destLat   ?? dropoffLat;
      const effDestLng   = destLng   ?? dropoffLng;

      // ── Compute SLA deadline ──
      const slaMinutes = slaDeltaMinutes
        ? Number(slaDeltaMinutes)
        : serviceType === 'AMBULANCE' ? 15
        : serviceType === 'FREIGHT'   ? 120
        : 60;

      const metaJson = JSON.stringify({
        ...(typeof metadata === 'object' && metadata !== null ? metadata : {}),
        ...(passengerCount != null ? { passengerCount: Number(passengerCount) } : {}),
      });

      // ── Insert job (populating both pickup_* and origin_* columns) ──
      const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(`
        INSERT INTO dispatch_jobs (
          tenant_id, booking_id, service_type, priority, status,
          pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
          origin_lat, origin_lng, dest_lat, dest_lng,
          origin_address, destination_address,
          scheduled_pickup, passenger_count,
          zone_id, sla_deadline, metadata, meta,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, 'PENDING',
          $5, $6, $7, $8,
          $5, $6, $7, $8,
          $9, $10,
          $11::timestamptz, $12,
          $13, NOW() + ($14 || ' minutes')::interval, $15::jsonb, $15::jsonb,
          NOW(), NOW()
        )
        RETURNING *
      `,
        tenantId,
        bookingId      ?? null,
        serviceType,
        priority,
        effOriginLat   != null ? Number(effOriginLat) : null,
        effOriginLng   != null ? Number(effOriginLng) : null,
        effDestLat     != null ? Number(effDestLat)   : null,
        effDestLng     != null ? Number(effDestLng)   : null,
        originAddress      ?? null,
        destinationAddress ?? null,
        scheduledPickup ? new Date(scheduledPickup).toISOString() : null,
        passengerCount != null ? Number(passengerCount) : 1,
        zoneId         ?? null,
        String(slaMinutes),
        metaJson,
      );

      if (!row?.id) {
        return NextResponse.json({ error: 'Job insert returned no ID' }, { status: 500 });
      }

      // ── Fetch the full created row ──
      const [job] = serialize(
        await tx.$queryRawUnsafe<Row[]>(
          `SELECT * FROM dispatch_jobs WHERE id = $1::uuid AND tenant_id = $2`,
          row.id,
          tenantId,
        ),
      );

      // ── Fire Smart Dispatch Optimiser — non-blocking, fire-and-forget ──
      agentDispatch({
        agent_id:   'dispatch-optimiser',
        event_type: 'dispatch.job_created',
        tenant_id:  tenantId,
        entity_id:  String(row.id),
        payload:    { serviceType, priority },
      }).catch(err =>
        console.warn('[dispatch/jobs/create] optimiser trigger failed (non-fatal):', err),
      );

      // ── Auto-trigger dispatch engine if requested ──
      if (autoTrigger !== false && serviceType !== 'SCHOOL_BUS') {
        const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
        runDispatch(String(row.id), baseUrl).catch(err =>
          console.warn('[dispatch/jobs/create] runDispatch failed (non-fatal):', err),
        );
      }

      // ── Fire merge scan ──
      let mergeSuggestion: null | Record<string, unknown> = null;
      try {
        const mergeResult = await triggerMergeScanOnCreate({
          id:                   String(row.id),
          tenant_id:            tenantId,
          service_type:         serviceType,
          priority,
          origin_lat:           effOriginLat != null ? Number(effOriginLat) : undefined,
          origin_lng:           effOriginLng != null ? Number(effOriginLng) : undefined,
          dest_lat:             effDestLat   != null ? Number(effDestLat)   : undefined,
          dest_lng:             effDestLng   != null ? Number(effDestLng)   : undefined,
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
  });
}
