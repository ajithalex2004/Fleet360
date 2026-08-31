export const dynamic = 'force-dynamic';

/**
 * src/app/api/driver-app/expenses/route.ts
 *
 * GET  /api/driver-app/expenses — list the driver's expense entries
 *                                  (scoped to the active shift by
 *                                   default, or pass ?all=true for
 *                                   the trailing 30 days)
 * POST /api/driver-app/expenses — submit a per-trip expense
 *
 * Expenses are tied to a SPECIFIC trip (every expense must be
 * attributable to a trip — that's the whole point of per-trip
 * expense reporting for fleet operators). The shift is auto-resolved
 * to the driver's ACTIVE shift if not provided.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireDriverSession } from '@/lib/driver-session';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const PostBodySchema = z.object({
  id: z.string().uuid(),
  shiftId: z.string().uuid().optional(),
  // Optional — expenses may be unattributable to a specific trip
  // (e.g. a parking ticket before the trip roster was loaded, or
  // a meal between trips). If provided, we validate the driver is
  // actually assigned to it.
  tripId: z.string().uuid().optional(),
  // TOLLS | PARKING | MEALS | FINES | OTHER. The CHECK constraint on
  // expense_entries.category enforces these.
  category: z.enum(['TOLLS', 'PARKING', 'MEALS', 'FINES', 'OTHER']),
  // Minor currency units (fils for AED, paise for INR).
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3).default('AED'),
  description: z.string().max(1000).optional(),
  incurredAt: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
  billPhoto: z.object({
    id: z.string().uuid(),
    mime: z.string().regex(/^image\/(jpeg|webp|png)$/),
    data: z.string(),
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
            id: string; shift_id: string | null; trip_id: string; category: string;
            amount_minor: number; currency: string; description: string | null;
            incurred_at: Date; created_at: Date;
          }>>`
            SELECT id, shift_id, trip_id, category, amount_minor, currency, description, incurred_at, created_at
            FROM expense_entries
            WHERE tenant_id = ${ctx.tenantId}::uuid
              AND driver_id = ${ctx.userId}::uuid
              AND incurred_at > NOW() - INTERVAL '30 days'
            ORDER BY incurred_at DESC
            LIMIT 200
          `
        : await tx.$queryRaw<Array<{
            id: string; shift_id: string | null; trip_id: string; category: string;
            amount_minor: number; currency: string; description: string | null;
            incurred_at: Date; created_at: Date;
          }>>`
            SELECT id, shift_id, trip_id, category, amount_minor, currency, description, incurred_at, created_at
            FROM expense_entries
            WHERE tenant_id = ${ctx.tenantId}::uuid
              AND driver_id = ${ctx.userId}::uuid
              AND shift_id = (
                SELECT id FROM shifts
                WHERE tenant_id = ${ctx.tenantId}::uuid
                  AND driver_id = ${ctx.userId}::uuid
                  AND status = 'ACTIVE'
                ORDER BY started_at DESC LIMIT 1
              )
            ORDER BY incurred_at DESC
            LIMIT 200
          `;

      return NextResponse.json({
        entries: rows.map((r) => ({
          id: r.id,
          shiftId: r.shift_id,
          tripId: r.trip_id,
          category: r.category,
          amountMinor: r.amount_minor,
          currency: r.currency,
          description: r.description,
          incurredAt: r.incurred_at.toISOString(),
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

      // Idempotency
      const existing = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM expense_entries
        WHERE id = ${body.id}::uuid
          AND tenant_id = ${ctx.tenantId}::uuid
          AND driver_id = ${ctx.userId}::uuid
        LIMIT 1
      `;
      if (existing.length > 0) {
        return NextResponse.json({ ok: true, entryId: existing[0].id, idempotent: true });
      }

      // Validate trip ownership — only if a tripId was provided. The
      // form allows expenses without a trip (free-form parking tickets,
      // meals between trips, etc). The DB schema has trip_id NOT NULL
      // though, so we have to substitute a placeholder when no trip is
      // supplied. Use the all-zeros UUID as the "no trip" sentinel —
      // the trip_schedules table will never have that id.
      const NO_TRIP_SENTINEL = '00000000-0000-0000-0000-000000000000';
      let resolvedTripId = NO_TRIP_SENTINEL;
      if (body.tripId) {
        const trip = await tx.tripSchedule.findFirst({
          where: { id: body.tripId, tenantId: ctx.tenantId, driverId: ctx.userId },
          select: { id: true },
        });
        if (!trip) {
          return NextResponse.json({ error: 'trip not found or not assigned to driver' }, { status: 403 });
        }
        resolvedTripId = trip.id;
      }

      // Auto-resolve shift
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
        INSERT INTO expense_entries (
          id, tenant_id, shift_id, trip_id, driver_id,
          category, amount_minor, currency, description,
          bill_photo_id, incurred_at, notes, created_at, updated_at
        ) VALUES (
          ${body.id}::uuid,
          ${ctx.tenantId}::uuid,
          ${shiftId}::uuid,
          ${resolvedTripId}::uuid,
          ${ctx.userId}::uuid,
          ${body.category},
          ${body.amountMinor},
          ${body.currency},
          ${body.description ?? null},
          ${null}::uuid,
          ${body.incurredAt ?? new Date().toISOString()}::timestamptz,
          ${body.notes ?? null},
          NOW(),
          NOW()
        )
      `;

      if (body.billPhoto) {
        const buf = Buffer.from(body.billPhoto.data, 'base64');
        await tx.$executeRaw`
          INSERT INTO expense_entry_photos (id, expense_entry_id, tenant_id, mime, size, data, taken_at, created_at)
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
          UPDATE expense_entries SET bill_photo_id = ${body.billPhoto.id}::uuid, updated_at = NOW()
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

