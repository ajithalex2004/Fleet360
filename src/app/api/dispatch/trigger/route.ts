export const dynamic = 'force-dynamic';

/**
 * POST /api/dispatch/trigger
 * Creates a dispatch job (or re-triggers an existing jobId) and runs the dispatch engine.
 *
 * Body:
 *   jobId? (to re-trigger an existing job)
 *   OR:
 *   serviceType, priority?, bookingId?,
 *   pickupLat, pickupLng, dropoffLat?, dropoffLng?,
 *   originLat?, originLng?, destLat?, destLng?,
 *   originAddress?, destinationAddress?, scheduledPickup?, passengerCount?,
 *   zoneId?, slaDeadline?, maxAttempts?, metadata?
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';
import { runDispatch } from '@/lib/dispatch/engine';
import { logAudit } from '@/lib/audit';
import type { ServiceType, DispatchPriority } from '@/lib/dispatch/types';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

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
        jobId: existingJobId,
        serviceType,
        priority = 'NORMAL',
        bookingId,
        pickupLat,
        pickupLng,
        dropoffLat,
        dropoffLng,
        originLat,
        originLng,
        destLat,
        destLng,
        originAddress,
        destinationAddress,
        scheduledPickup,
        passengerCount,
        zoneId,
        slaDeadline,
        maxAttempts = 3,
        metadata,
      } = body as {
        jobId?:       string;
        serviceType?: ServiceType;
        priority?:    DispatchPriority;
        bookingId?:   string;
        pickupLat?:   number;
        pickupLng?:   number;
        dropoffLat?:  number;
        dropoffLng?:  number;
        originLat?:   number;
        originLng?:   number;
        destLat?:     number;
        destLng?:     number;
        originAddress?: string;
        destinationAddress?: string;
        scheduledPickup?: string;
        passengerCount?: number;
        zoneId?:      string;
        slaDeadline?: string;
        maxAttempts?: number;
        metadata?:    Record<string, unknown>;
      };

      const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;

      // Support re-triggering an existing job by jobId
      if (existingJobId) {
        const [existing] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM dispatch_jobs WHERE id = $1::uuid AND tenant_id = $2 LIMIT 1`,
          existingJobId,
          tenantId,
        );
        if (!existing) {
          return NextResponse.json({ error: 'Dispatch job not found' }, { status: 404 });
        }

        await tx.$executeRawUnsafe(
          `UPDATE dispatch_jobs
           SET status = CASE WHEN status IN ('PENDING', 'RETRYING') THEN status ELSE 'RETRYING' END,
               updated_at = NOW()
           WHERE id = $1::uuid AND tenant_id = $2`,
          existingJobId,
          tenantId,
        );

        runDispatch(existingJobId, baseUrl).catch(e =>
          console.error('[dispatch/trigger] Engine error:', e)
        );

        return NextResponse.json({ ok: true, jobId: existingJobId, status: 'SEARCHING' });
      }

      if (!tenantId)    return NextResponse.json({ error: 'tenantId is required'    }, { status: 400 });
      if (!serviceType) return NextResponse.json({ error: 'serviceType is required' }, { status: 400 });

      // School Bus uses a separate route-assignment engine
      if (serviceType === 'SCHOOL_BUS') {
        return NextResponse.json({ error: 'Use /api/school-bus/routes/[id]/assign for school bus dispatch' }, { status: 400 });
      }

      const effPickupLat  = pickupLat  ?? originLat  ?? null;
      const effPickupLng  = pickupLng  ?? originLng  ?? null;
      const effDropoffLat = dropoffLat ?? destLat    ?? null;
      const effDropoffLng = dropoffLng ?? destLng    ?? null;
      const metaJson      = JSON.stringify(metadata ?? {});

      // Create dispatch job (populating both pickup_* and origin_* columns)
      const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(`
        INSERT INTO dispatch_jobs
          (tenant_id, booking_id, service_type, priority,
           pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
           origin_lat, origin_lng, dest_lat, dest_lng,
           origin_address, destination_address, scheduled_pickup, passenger_count,
           zone_id, sla_deadline, max_attempts, metadata, meta)
        VALUES
          ($1, $2, $3, $4,
           $5, $6, $7, $8,
           $5, $6, $7, $8,
           $9, $10, $11::timestamptz, $12,
           $13, $14::timestamptz, $15, $16::jsonb, $16::jsonb)
        RETURNING id
      `,
        tenantId,
        bookingId ?? null,
        serviceType,
        priority,
        effPickupLat,
        effPickupLng,
        effDropoffLat,
        effDropoffLng,
        originAddress ?? null,
        destinationAddress ?? null,
        scheduledPickup ? new Date(scheduledPickup).toISOString() : null,
        passengerCount ?? 1,
        zoneId     ?? null,
        slaDeadline ? new Date(slaDeadline).toISOString() : null,
        maxAttempts,
        metaJson,
      );

      const jobId = row.id;

      // Audit
      logAudit({
        tenantId,
        entityType: 'DispatchJob',
        entityId:   jobId,
        action:     'CREATE',
        details:    `Dispatch job created — ${serviceType} / ${priority}`,
        ipAddress:  req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
      });

      // Run dispatch engine (async — don't await so client gets fast response)
      runDispatch(jobId, baseUrl).catch(e =>
        console.error('[dispatch/trigger] Engine error:', e)
      );

      return NextResponse.json({ ok: true, jobId, status: 'SEARCHING' }, { status: 201 });
    } catch (err) {
      console.error('[dispatch/trigger]', err);
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  });
}
