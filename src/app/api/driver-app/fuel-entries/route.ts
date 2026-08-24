/**
 * src/app/api/driver-app/fuel-entries/route.ts
 *
 * GET  /api/driver-app/fuel-entries — list the driver's fuel entries
 *                                      (scoped to the active shift by
 *                                       default, or pass ?all=true for
 *                                       the trailing 30 days)
 * POST /api/driver-app/fuel-entries — submit a fuel fill event
 *
 * Fuel entries may be tied to a trip (optional) and a shift
 * (auto-resolved to the driver's ACTIVE shift if not provided). The
 * bill photo is uploaded inline (base64) for now — production will
 * switch to presigned S3 upload (roadmap item E in
 * docs/DRIVER_MOBILE_APP_ROADMAP.md).
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireDriverSession } from '@/lib/driver-session';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const PostBodySchema = z.object({
  // Client-generated UUID for idempotency. The sync queue uses the
  // same UUID across retries, so duplicate submissions no-op.
  id: z.string().uuid(),
  shiftId: z.string().uuid().optional(),
  tripId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
  liters: z.number().positive(),
  // Cost in minor units (fils for AED, paise for INR). 100 minor
  // units = 1.00 major unit. The client converts from the major-unit
  // form field.
  costMinor: z.number().int().nonnegative(),
  currency: z.string().length(3).default('AED'),
  odometer: z.number().int().nonnegative().optional(),
  locationLat: z.number().min(-90).max(90).optional(),
  locationLng: z.number().min(-180).max(180).optional(),
  locationName: z.string().max(200).optional(),
  filledAt: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
  // Optional bill photo (base64). First cut — production will use
  // presigned S3 upload.
  billPhoto: z.object({
    id: z.string().uuid(),
    mime: z.string().regex(/^image\/(jpeg|webp|png)$/),
    data: z.string(), // base64
    size: z.number().int().positive().max(5_000_000),
  }).optional(),
});

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const ctx = (await requireDriverSession(req));
      if (ctx instanceof NextResponse) return ctx;

      const all = new URL(req.url).searchParams.get('all') === 'true';
      const rows = all
        ? await tx.$queryRaw<Array<{
            id: string; shift_id: string | null; trip_id: string | null; vehicle_id: string | null;
            liters: unknown; cost_minor: number | null; currency: string; odometer: number | null;
            location_lat: unknown; location_lng: unknown; location_name: string | null;
            filled_at: Date; created_at: Date;
          }>>`
            SELECT id, shift_id, trip_id, vehicle_id, liters, cost_minor, currency, odometer,
                   location_lat, location_lng, location_name, filled_at, created_at
            FROM fuel_entries
            WHERE tenant_id = ${ctx.tenantId}::uuid
              AND driver_id = ${ctx.userId}::uuid
              AND filled_at > NOW() - INTERVAL '30 days'
            ORDER BY filled_at DESC
            LIMIT 200
          `
        : await tx.$queryRaw<Array<{
            id: string; shift_id: string | null; trip_id: string | null; vehicle_id: string | null;
            liters: unknown; cost_minor: number | null; currency: string; odometer: number | null;
            location_lat: unknown; location_lng: unknown; location_name: string | null;
            filled_at: Date; created_at: Date;
          }>>`
            SELECT id, shift_id, trip_id, vehicle_id, liters, cost_minor, currency, odometer,
                   location_lat, location_lng, location_name, filled_at, created_at
            FROM fuel_entries
            WHERE tenant_id = ${ctx.tenantId}::uuid
              AND driver_id = ${ctx.userId}::uuid
              AND shift_id = (
                SELECT id FROM shifts
                WHERE tenant_id = ${ctx.tenantId}::uuid
                  AND driver_id = ${ctx.userId}::uuid
                  AND status = 'ACTIVE'
                ORDER BY started_at DESC LIMIT 1
              )
            ORDER BY filled_at DESC
            LIMIT 200
          `;

      return NextResponse.json({
        entries: rows.map((r) => ({
          id: r.id,
          shiftId: r.shift_id,
          tripId: r.trip_id,
          vehicleId: r.vehicle_id,
          liters: Number(r.liters),
          costMinor: r.cost_minor,
          currency: r.currency,
          odometer: r.odometer,
          locationLat: r.location_lat != null ? Number(r.location_lat) : null,
          locationLng: r.location_lng != null ? Number(r.location_lng) : null,
          locationName: r.location_name,
          filledAt: r.filled_at.toISOString(),
          createdAt: r.created_at.toISOString(),
        })),
      });
  });
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const ctx = (await requireDriverSession(req));
      if (ctx instanceof NextResponse) return ctx;

      const jsonRaw = await req.json().catch(() => null);
    const json = jsonRaw ? stripTenantOwnershipFields(jsonRaw) : null;
      const parsed = PostBodySchema.safeParse(json);
      if (!parsed.success) {
        return NextResponse.json({ error: 'validation failed', issues: parsed.error.issues }, { status: 400 });
      }
      const body = parsed.data;

      // Idempotency — same id twice is a no-op.
      const existing = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM fuel_entries
        WHERE id = ${body.id}::uuid
          AND tenant_id = ${ctx.tenantId}::uuid
          AND driver_id = ${ctx.userId}::uuid
        LIMIT 1
      `;
      if (existing.length > 0) {
        return NextResponse.json({ ok: true, entryId: existing[0].id, idempotent: true });
      }

      // Insert the bill photo first (if present) so we can FK it from the
      // entry. The FK is set to ON DELETE SET NULL so deleting the photo
      // keeps the entry intact.
      let billPhotoId: string | null = null;
      if (body.billPhoto) {
        billPhotoId = body.billPhoto.id;
        // We'll INSERT the photo AFTER the entry is created, then UPDATE
        // the entry with the photo id. The forward FK reference doesn't
        // work in CREATE TABLE.
      }

      // If shiftId is not provided, auto-resolve to the driver's active shift.
      let shiftId = body.shiftId ?? null;
      if (!shiftId) {
        const active = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM shifts
          WHERE tenant_id = ${ctx.tenantId}::uuid
            AND driver_id = ${ctx.userId}::uuid
            AND status = 'ACTIVE'
          ORDER BY started_at DESC LIMIT 1
        `;
        shiftId = active[0]?.id ?? null;
      }

      await tx.$executeRaw`
        INSERT INTO fuel_entries (
          id, tenant_id, shift_id, trip_id, driver_id, vehicle_id,
          liters, cost_minor, currency, odometer,
          location_lat, location_lng, location_name,
          bill_photo_id, filled_at, notes, created_at, updated_at
        ) VALUES (
          ${body.id}::uuid,
          ${ctx.tenantId}::uuid,
          ${shiftId}::uuid,
          ${body.tripId ?? null}::uuid,
          ${ctx.userId}::uuid,
          ${body.vehicleId ?? null}::uuid,
          ${body.liters},
          ${body.costMinor},
          ${body.currency},
          ${body.odometer ?? null},
          ${body.locationLat ?? null},
          ${body.locationLng ?? null},
          ${body.locationName ?? null},
          ${null}::uuid,
          ${body.filledAt ?? new Date().toISOString()}::timestamptz,
          ${body.notes ?? null},
          NOW(),
          NOW()
        )
      `;

      if (body.billPhoto) {
        const buf = Buffer.from(body.billPhoto.data, 'base64');
        await tx.$executeRaw`
          INSERT INTO fuel_entry_photos (id, fuel_entry_id, tenant_id, mime, size, data, taken_at, created_at)
          VALUES (
            ${body.billPhoto.id}::uuid,
            ${body.id}::uuid,
            ${ctx.tenantId}::uuid,
            ${body.billPhoto.mime},
            ${body.billPhoto.size},
            ${buf}::bytea,
            NOW(),
            NOW()
          )
        `;
        await tx.$executeRaw`
          UPDATE fuel_entries SET bill_photo_id = ${body.billPhoto.id}::uuid, updated_at = NOW()
          WHERE id = ${body.id}::uuid
        `;
      }

      return NextResponse.json({
        ok: true,
        entryId: body.id,
        shiftId,
        hasBillPhoto: !!body.billPhoto,
      }, { status: 201 });
  });
}

