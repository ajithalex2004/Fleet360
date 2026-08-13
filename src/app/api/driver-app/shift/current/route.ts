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
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireDriverSession } from '@/lib/driver-session';

const PostBodySchema = z.object({
  vehicleId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
});

export async function GET(req: NextRequest) {
  const ctx = await requireDriverSession(req);
  if (ctx instanceof NextResponse) return ctx;

  const rows = await prisma.$queryRaw<Array<{
    id: string;
    vehicle_id: string | null;
    started_at: Date;
    ended_at: Date | null;
    status: string;
    checklist: unknown;
    checklist_signed_at: Date | null;
    checklist_signature_svg: string | null;
    notes: string | null;
  }>>`
    SELECT id, vehicle_id, started_at, ended_at, status,
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
      startedAt: r.started_at.toISOString(),
      endedAt: r.ended_at?.toISOString() ?? null,
      status: r.status,
      checklist: r.checklist,
      checklistSignedAt: r.checklist_signed_at?.toISOString() ?? null,
      checklistSignatureSvg: r.checklist_signature_svg,
      notes: r.notes,
    },
  });
}

export async function POST(req: NextRequest) {
  const ctx = await requireDriverSession(req);
  if (ctx instanceof NextResponse) return ctx;

  const json = await req.json().catch(() => ({}));
  const parsed = PostBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation failed', issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;

  // Close any existing ACTIVE shift for this driver (defensive — the
  // partial unique index would block inserting a new ACTIVE row).
  await prisma.$executeRaw`
    UPDATE shifts
    SET status = 'CLOSED', ended_at = NOW(), updated_at = NOW()
    WHERE tenant_id = ${ctx.tenantId}::uuid
      AND driver_id = ${ctx.userId}::uuid
      AND status = 'ACTIVE'
  `;

  const newId = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO shifts (
      id, tenant_id, driver_id, vehicle_id, started_at, status, notes, created_at, updated_at
    ) VALUES (
      ${newId}::uuid,
      ${ctx.tenantId}::uuid,
      ${ctx.userId}::uuid,
      ${body.vehicleId ?? null}::uuid,
      NOW(),
      'ACTIVE',
      ${body.notes ?? null},
      NOW(),
      NOW()
    )
  `;

  const rows = await prisma.$queryRaw<Array<{ id: string; started_at: Date; status: string }>>`
    SELECT id, started_at, status FROM shifts
    WHERE id = ${newId}::uuid
  `;
  return NextResponse.json({
    shift: {
      id: rows[0].id,
      startedAt: rows[0].started_at.toISOString(),
      status: rows[0].status,
    },
  }, { status: 201 });
}
