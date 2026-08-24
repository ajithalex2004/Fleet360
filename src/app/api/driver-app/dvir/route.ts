/**
 * src/app/api/driver-app/dvir/route.ts
 *
 * POST /api/driver-app/dvir — submit a DVIR (Driver Vehicle Inspection
 * Report) from the driver mobile app.
 *
 * The body comes from the offline sync queue (see
 * src/lib/driver-offline/sync.ts) so it carries the client-generated
 * UUID and the timestamps. The server is idempotent: if the same DVIR
 * id is submitted twice (driver tapped "Sync now" after the queue
 * already drained), we no-op.
 *
 * Photos: the body carries `photoIds[]` referencing photos stored
 * server-side. We accept either:
 *   (a) inline base64-encoded photo blobs in `photos[].data` (small
 *       DVIR defects, ~1 MB each), or
 *   (b) presigned-uploaded URLs in `photos[].url` (large photos,
 *       uploaded separately to S3-compatible storage).
 *
 * For the first cut we only handle (a). The presigned upload flow is
 * the next milestone — see DRIVER_MOBILE_APP_ROADMAP.md.
 *
 * Auth: xl-driver-session cookie (set by the biometric login flow).
 * The cookie is mandatory — the DVIR is a legally-significant record
 * and we want a strong identity binding per submission.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getTenantContextOrNull } from '@/lib/tenant-session';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const ItemSchema = z.object({
  ok: z.boolean(),
  note: z.string().max(500).optional(),
  photoIds: z.array(z.string().uuid()).optional(),
});

const DefectSchema = z.object({
  category: z.string().min(1).max(50),
  description: z.string().min(1).max(1000),
  severity: z.enum(['MINOR', 'MAJOR', 'CRITICAL']),
  photoIds: z.array(z.string().uuid()).default([]),
});

const DvirSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['PRE_TRIP', 'POST_TRIP']),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  odometerStart: z.number().int().nonnegative().nullable(),
  odometerEnd: z.number().int().nonnegative().nullable(),
  items: z.record(z.string(), ItemSchema),
  defects: z.array(DefectSchema).default([]),
  notes: z.string().max(2000).nullable(),
  signatureSvg: z.string().max(20000).nullable(),
});

const BodySchema = z.object({
  tripId: z.string().uuid(),
  driverId: z.string().uuid(),
  tenantId: z.string().uuid(),
  dvir: DvirSchema,
  // Inline photos (base64). Production: switch to presigned upload.
  photos: z.array(z.object({
    id: z.string().uuid(),
    mime: z.string().regex(/^image\/(jpeg|webp|png)$/),
    data: z.string(), // base64 (no data: prefix)
    size: z.number().int().positive().max(5_000_000), // 5 MB cap
  })).optional().default([]),
});

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const ctx = getTenantContextOrNull(req);
  if (!ctx) {
    return NextResponse.json({ error: 'session required' }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // The driver can only submit DVIRs for themselves. Defensive check
  // even though the session binds the user.
  if (body.driverId !== ctx.userId) {
    return NextResponse.json({ error: 'driverId mismatch' }, { status: 403 });
  }
  if (body.tenantId !== ctx.tenantId) {
    return NextResponse.json({ error: 'tenantId mismatch' }, { status: 403 });
  }

  // Idempotency. If a DVIR with this id already exists for this driver
  // + tenant, return the existing record's id without re-processing.
  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM dvir
    WHERE id = ${body.dvir.id}::uuid
      AND tenant_id = ${ctx.tenantId}::uuid
      AND driver_id = ${ctx.userId}::uuid
    LIMIT 1
  `;
  if (existing.length > 0) {
    return NextResponse.json({ ok: true, dvirId: existing[0].id, idempotent: true });
  }

  // Validate trip ownership. A driver can only submit a DVIR for a
  // trip they're actually assigned to.
  const trip = await prisma.tripSchedule.findFirst({
    where: { id: body.tripId, tenantId: ctx.tenantId, driverId: ctx.userId },
    select: { id: true, vehicleId: true },
  });
  if (!trip) {
    return NextResponse.json({ error: 'trip not found or not assigned to driver' }, { status: 403 });
  }

  // Persist the DVIR row. We use a raw insert because the Prisma
  // schema may not have a dvir model yet (it's the next migration).
  // This is intentionally ahead of the schema — the table is created
  // by the 20260805110000_dvir migration that ships in this PR.
  await prisma.$executeRaw`
    INSERT INTO dvir (
      id, tenant_id, trip_id, driver_id, vehicle_id, type,
      started_at, completed_at, odometer_start, odometer_end,
      items, defects, notes, signature_svg, status, created_at, updated_at
    ) VALUES (
      ${body.dvir.id}::uuid,
      ${ctx.tenantId}::uuid,
      ${body.tripId}::uuid,
      ${ctx.userId}::uuid,
      ${trip.vehicleId}::uuid,
      ${body.dvir.type},
      ${body.dvir.startedAt}::timestamptz,
      ${body.dvir.completedAt}::timestamptz,
      ${body.dvir.odometerStart},
      ${body.dvir.odometerEnd},
      ${JSON.stringify(body.dvir.items)}::jsonb,
      ${JSON.stringify(body.dvir.defects)}::jsonb,
      ${body.dvir.notes},
      ${body.dvir.signatureSvg},
      ${body.dvir.defects.some((d) => d.severity === 'CRITICAL') ? 'BLOCKED' : 'PASS'},
      NOW(),
      NOW()
    )
  `;

  // Persist photos. The id is the client-generated UUID so subsequent
  // requests can reference them. Storage is S3-compatible object
  // storage; for the first cut we use a base64 dump in a bytea column
  // (the dev/test path) and switch to S3 in production.
  for (const p of body.photos) {
    const buf = Buffer.from(p.data, 'base64');
    await prisma.$executeRaw`
      INSERT INTO dvir_photos (id, dvir_id, tenant_id, mime, size, data, taken_at, created_at)
      VALUES (
        ${p.id}::uuid,
        ${body.dvir.id}::uuid,
        ${ctx.tenantId}::uuid,
        ${p.mime},
        ${p.size},
        ${buf}::bytea,
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }

  return NextResponse.json({
    ok: true,
    dvirId: body.dvir.id,
    status: body.dvir.defects.some((d) => d.severity === 'CRITICAL') ? 'BLOCKED' : 'PASS',
    photos: body.photos.length,
  });
}
