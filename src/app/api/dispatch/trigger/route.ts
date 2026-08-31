export const dynamic = 'force-dynamic';

/**
 * POST /api/dispatch/trigger
 * Creates a dispatch job and runs the dispatch engine.
 *
 * Body:
 *   tenantId, serviceType, priority?, bookingId?,
 *   pickupLat, pickupLng, dropoffLat?, dropoffLng?,
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
          tenantId,
          serviceType,
          priority = 'NORMAL',
          bookingId,
          pickupLat,
          pickupLng,
          dropoffLat,
          dropoffLng,
          zoneId,
          slaDeadline,
          maxAttempts = 3,
          metadata,
        } = body as {
          tenantId:     string;
          serviceType:  ServiceType;
          priority?:    DispatchPriority;
          bookingId?:   string;
          pickupLat?:   number;
          pickupLng?:   number;
          dropoffLat?:  number;
          dropoffLng?:  number;
          zoneId?:      string;
          slaDeadline?: string;
          maxAttempts?: number;
          metadata?:    Record<string, unknown>;
        };

        if (!tenantId)    return NextResponse.json({ error: 'tenantId is required'    }, { status: 400 });
        if (!serviceType) return NextResponse.json({ error: 'serviceType is required' }, { status: 400 });

        // School Bus uses a separate route-assignment engine
        if (serviceType === 'SCHOOL_BUS') {
          return NextResponse.json({ error: 'Use /api/school-bus/routes/[id]/assign for school bus dispatch' }, { status: 400 });
        }

        // Create dispatch job
        const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(`
          INSERT INTO dispatch_jobs
            (tenant_id, booking_id, service_type, priority,
             pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
             zone_id, sla_deadline, max_attempts, metadata)
          VALUES
            ($1, $2, $3, $4,
             $5, $6, $7, $8,
             $9, $10::timestamptz, $11, $12::jsonb)
          RETURNING id
        `,
          tenantId,
          bookingId ?? null,
          serviceType,
          priority,
          pickupLat  ?? null,
          pickupLng  ?? null,
          dropoffLat ?? null,
          dropoffLng ?? null,
          zoneId     ?? null,
          slaDeadline ? new Date(slaDeadline).toISOString() : null,
          maxAttempts,
          JSON.stringify(metadata ?? {}),
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
        const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
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

