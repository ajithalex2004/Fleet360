export const dynamic = 'force-dynamic';

/**
 * src/app/api/driver-app/shift/current/route.ts
 *
 * GET  /api/driver-app/shift/current — return the driver's active shift
 * POST /api/driver-app/shift/current — start a new shift
 *
 * The "shift" is the driver's working session. The shift checklist
 * is recorded on this row (see /api/driver-app/shift/[id]/checklist).
 *
 * The partial unique index `shifts_one_active_per_driver` enforces
 * that only one ACTIVE shift exists per driver at a time. The API
 * explicitly closes any existing ACTIVE shift before opening a new
 * one — that handles the "user closed the tab and reopens" case.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireDriverSession, requireDriverSessionForTenant } from '@/lib/driver-session';
import { authorizeDriverReferences, requireActiveDriver } from '@/lib/driver-app-actor';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const PostBodySchema = z.object({
  vehicleId: z.string().uuid().optional(),
  startOdometer: z.union([z.number(), z.string()]).optional(),
  endOdometer: z.union([z.number(), z.string()]).optional(),
  notes: z.string().max(2000).optional(),
});

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const ctx = await requireDriverSession(req);
      if (ctx instanceof NextResponse) return ctx;

      const rows = await tx.$queryRaw<Array<{
        id: string;
        vehicle_id: string | null;
        start_odometer: number | string | null;
        end_odometer: number | string | null;
        started_at: Date;
        ended_at: Date | null;
        status: string;
        checklist: unknown;
        checklist_signed_at: Date | null;
        checklist_signature_svg: string | null;
        notes: string | null;
      }>>`
        SELECT id, vehicle_id, start_odometer, end_odometer, started_at, ended_at, status,
               checklist, checklist_signed_at, checklist_signature_svg, notes
        FROM shifts
        WHERE tenant_id = ${ctx.tenantId}::uuid
          AND driver_id = ${ctx.userId}::uuid
          AND status = 'ACTIVE'
        ORDER BY started_at DESC
        LIMIT 1
      `;
      if (rows.length === 0) {
        return NextResponse.json({ shift: null });
      }
      const r = rows[0];
      return NextResponse.json({
        shift: {
          id: r.id,
          vehicleId: r.vehicle_id,
          startOdometer: r.start_odometer != null ? Number(r.start_odometer) : null,
          endOdometer: r.end_odometer != null ? Number(r.end_odometer) : null,
          startedAt: r.started_at.toISOString(),
          endedAt: r.ended_at?.toISOString() ?? null,
          status: r.status,
          checklist: r.checklist,
          checklistSignedAt: r.checklist_signed_at?.toISOString() ?? null,
          checklistSignatureSvg: r.checklist_signature_svg,
          notes: r.notes,
        },
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
    const ctx = await requireDriverSessionForTenant(req, tenantId);
      if (ctx instanceof NextResponse) return ctx;

      const jsonRaw = await req.json().catch(() => ({}));
    const json = jsonRaw ? stripTenantOwnershipFields(jsonRaw) : null;
      const parsed = PostBodySchema.safeParse(json);
      if (!parsed.success) {
        return NextResponse.json({ error: 'validation failed', issues: parsed.error.issues }, { status: 400 });
      }
      const body = parsed.data;

      // The caller must be an active driver, and every shift, trip and
      // vehicle the request names must be theirs (src/lib/driver-app-actor.ts).
      const denied = (await requireActiveDriver(tx, ctx))
        ?? (await authorizeDriverReferences(tx, ctx, { vehicleId: body.vehicleId }));
      if (denied) return denied;

      // Close any existing ACTIVE shift for this driver (defensive — the
      // partial unique index would block inserting a new ACTIVE row).
      await tx.$executeRaw`
        UPDATE shifts
        SET status = 'CLOSED', ended_at = NOW(), updated_at = NOW()
        WHERE tenant_id = ${ctx.tenantId}::uuid
          AND driver_id = ${ctx.userId}::uuid
          AND status = 'ACTIVE'
      `;

      const newId = crypto.randomUUID();
      const startOdo = body.startOdometer != null && body.startOdometer !== '' ? Number(body.startOdometer) : null;
      await tx.$executeRaw`
        INSERT INTO shifts (
          id, tenant_id, driver_id, vehicle_id, start_odometer, started_at, status, notes, created_at, updated_at
        ) VALUES (
          ${newId}::uuid,
          ${ctx.tenantId}::uuid,
          ${ctx.userId}::uuid,
          ${body.vehicleId ?? null}::uuid,
          ${startOdo},
          NOW(),
          'ACTIVE',
          ${body.notes ?? null},
          NOW(),
          NOW()
        )
      `;

      if (body.vehicleId && startOdo && !isNaN(startOdo) && startOdo > 0) {
        await tx.$executeRaw`
          UPDATE vehicles SET odometer_reading = ${startOdo}, updated_at = NOW() WHERE id = ${body.vehicleId}::uuid
        `.catch(() => {});
      }

      const rows = await tx.$queryRaw<Array<{ id: string; vehicle_id: string | null; start_odometer: number | string | null; started_at: Date; status: string }>>`
        SELECT id, vehicle_id, start_odometer, started_at, status FROM shifts
        WHERE id = ${newId}::uuid
      `;
      return NextResponse.json({
        shift: {
          id: rows[0].id,
          vehicleId: rows[0].vehicle_id,
          startOdometer: rows[0].start_odometer != null ? Number(rows[0].start_odometer) : null,
          startedAt: rows[0].started_at.toISOString(),
          status: rows[0].status,
        },
      }, { status: 201 });
  });
}

