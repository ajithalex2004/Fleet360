/**
 * src/app/api/driver-app/shift/[id]/checklist/route.ts
 *
 * POST /api/driver-app/shift/[id]/checklist — persist the shift
 * checklist for the given shift.
 *
 * The checklist is a free-form JSONB keyed by checklist item id. The
 * client ships a default 18-item list (mirrors the DVIR form) but the
 * server treats it as opaque — same shape as dvir.items. Future
 * per-tenant customisation lives in the tenant's checklist config.
 *
 * The shift must be ACTIVE and owned by the authenticated driver.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireDriverSession } from '@/lib/driver-session';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const ItemSchema = z.object({
  ok: z.boolean(),
  note: z.string().max(500).optional(),
  photoIds: z.array(z.string().uuid()).optional(),
});

const BodySchema = z.object({
  items: z.record(z.string(), ItemSchema),
  signatureSvg: z.string().max(20000).optional(),
  signedAt: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest, ctx2: { params: Promise<{ id: string }> }) {
  const { id: shiftId } = await ctx2.params;
  const ctx = await requireDriverSession(req);
  if (ctx instanceof NextResponse) return ctx;

  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation failed', issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;

  // Ownership: the shift must belong to this driver + tenant and be ACTIVE.
  const existing = await prisma.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id, status FROM shifts
    WHERE id = ${shiftId}::uuid
      AND tenant_id = ${ctx.tenantId}::uuid
      AND driver_id = ${ctx.userId}::uuid
    LIMIT 1
  `;
  if (existing.length === 0) {
    return NextResponse.json({ error: 'shift not found' }, { status: 404 });
  }
  if (existing[0].status !== 'ACTIVE') {
    return NextResponse.json({ error: 'shift is not active' }, { status: 409 });
  }

  await prisma.$executeRaw`
    UPDATE shifts
    SET checklist = ${JSON.stringify(body.items)}::jsonb,
        checklist_signature_svg = ${body.signatureSvg ?? null},
        checklist_signed_at = ${body.signedAt ?? new Date().toISOString()}::timestamptz,
        notes = COALESCE(${body.notes ?? null}, notes),
        updated_at = NOW()
    WHERE id = ${shiftId}::uuid
  `;

  return NextResponse.json({ ok: true, shiftId, items: Object.keys(body.items).length });
}
