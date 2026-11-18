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
import { requireDriverSession, requireDriverSessionForTenant } from '@/lib/driver-session';
import { authorizeDriverReferences, requireActiveDriver } from '@/lib/driver-app-actor';
import { postOperationalJournalEntry } from '@/lib/finance/journal-service';
import crypto from 'crypto';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const PostBodySchema = z.object({
  id: z.string().uuid().optional(),
  shiftId: z.string().uuid().optional(),
  // Optional — expenses may be unattributable to a specific trip
  // (e.g. a parking ticket before the trip roster was loaded, or
  // a meal between trips). If provided, we validate the driver is
  // actually assigned to it.
  tripId: z.string().uuid().optional(),
  category: z.string(),
  amount: z.number().positive().optional(),
  amountMinor: z.number().int().positive().optional(),
  currency: z.string().length(3).default('AED'),
  description: z.string().max(1000).optional(),
  receiptUrl: z.string().optional(),
  incurredAt: z.string().optional(),
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

  try {
    return await withTenantRls(prisma, tenantId, async (tx) => {
      const ctx = (await requireDriverSessionForTenant(req, tenantId));
      if (ctx instanceof NextResponse) return ctx;

      const jsonRaw = await req.json().catch(() => null);
    const json = jsonRaw ? stripTenantOwnershipFields(jsonRaw) : null;
      const parsed = PostBodySchema.safeParse(json);
      if (!parsed.success) {
        return NextResponse.json({ error: 'validation failed', issues: parsed.error.issues }, { status: 400 });
      }
      const body = parsed.data;

      // The caller must be an active driver, and every shift, trip and
      // vehicle the request names must be theirs (src/lib/driver-app-actor.ts).
      const denied = (await requireActiveDriver(tx, ctx))
        ?? (await authorizeDriverReferences(tx, ctx, { shiftId: body.shiftId, tripId: body.tripId }));
      if (denied) return denied;

      const entryId = body.id ?? crypto.randomUUID();
      const amountMinor = body.amountMinor ?? (body.amount != null ? Math.round(body.amount * 100) : 0);
      if (amountMinor <= 0) {
        return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 });
      }
      const totalAmount = body.amount ?? (amountMinor / 100);

      const incurredDate = body.incurredAt ? new Date(body.incurredAt) : new Date();
      if (Number.isNaN(incurredDate.getTime())) {
        return NextResponse.json({ error: 'Invalid incurredAt timestamp' }, { status: 400 });
      }
      const incurredIso = incurredDate.toISOString();
      const incurredDateStr = incurredIso.slice(0, 10);

      // Clean category and map to DB enum
      const rawCat = (body.category || 'OTHER').toUpperCase().trim();
      let dbCategory: 'TOLLS' | 'PARKING' | 'MEALS' | 'FINES' | 'OTHER' = 'OTHER';
      let glCode = '5160';
      let glName = 'Operating Expenses - Other';

      if (rawCat.includes('TOLL') || rawCat.includes('SALIK')) {
        dbCategory = 'TOLLS';
        glCode = '5130';
        glName = 'Operating Expenses - Tolls & Salik';
      } else if (rawCat.includes('PARK')) {
        dbCategory = 'PARKING';
        glCode = '5140';
        glName = 'Operating Expenses - Parking';
      } else if (rawCat.includes('MEAL') || rawCat.includes('FOOD')) {
        dbCategory = 'MEALS';
        glCode = '5160';
        glName = 'Operating Expenses - Driver Meals & Incidentals';
      } else if (rawCat.includes('FINE')) {
        dbCategory = 'FINES';
        glCode = '5170';
        glName = 'Operating Expenses - Traffic Fines';
      } else if (rawCat.includes('WASH') || rawCat.includes('CLEAN')) {
        dbCategory = 'OTHER';
        glCode = '5150';
        glName = 'Operating Expenses - Cleaning & Washing';
      } else if (rawCat.includes('REPAIR') || rawCat.includes('MAINT')) {
        dbCategory = 'OTHER';
        glCode = '5110';
        glName = 'Maintenance & Repairs - Vehicle';
      }

      const expenseStatus = totalAmount > 500 ? 'PENDING_APPROVAL' : 'SUBMITTED';

      // Idempotency
      const existing = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM expense_entries
        WHERE id = ${entryId}::uuid
          AND tenant_id = ${ctx.tenantId}::uuid
          AND driver_id = ${ctx.userId}::uuid
        LIMIT 1
      `;
      if (existing.length > 0) {
        return NextResponse.json({ ok: true, id: existing[0].id, entryId: existing[0].id, status: expenseStatus, idempotent: true });
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
          ${entryId}::uuid,
          ${ctx.tenantId}::uuid,
          ${shiftId}::uuid,
          ${resolvedTripId}::uuid,
          ${ctx.userId}::uuid,
          ${dbCategory},
          ${amountMinor},
          ${body.currency},
          ${body.description ?? null},
          ${null}::uuid,
          ${incurredIso}::timestamptz,
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
            ${entryId}::uuid,
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
          WHERE id = ${entryId}::uuid
        `;
      }

      // Bridge to finance.finance_expenses atomically inside withTenantRls
      const expenseNo = `EXP-${entryId.slice(0, 8).toUpperCase()}`;
      await tx.$executeRawUnsafe(
        `INSERT INTO finance_expenses (
           id, expense_no, category, description,
           amount, currency, vat_amount, total_amount,
           expense_date, status, driver_id,
           reference_no, tenant_id, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, $7, $8,
           $9::date, $10, $11,
           $12, $13, NOW(), NOW()
         ) ON CONFLICT DO NOTHING`,
        entryId,
        expenseNo,
        rawCat,
        body.description ?? `${rawCat} expense`,
        totalAmount,
        body.currency,
        0,
        totalAmount,
        incurredDateStr,
        expenseStatus,
        ctx.userId ?? null,
        entryId,
        ctx.tenantId,
      );

      // Post General Ledger lines atomically inside withTenantRls
      const glEntry = await postOperationalJournalEntry(tx as any, {
        tenantId: ctx.tenantId,
        entryDate: incurredDateStr,
        narration: `Driver expense: ${rawCat} - ${body.description || 'Driver submitted expense'}`,
        reference: expenseNo,
        sourceType: 'DRIVER_EXPENSE',
        sourceId: entryId,
        currency: body.currency,
        preparedBy: ctx.userId ?? 'system',
        lines: [
          {
            code: glCode,
            name: glName,
            description: body.description ?? `${rawCat} expense`,
            debit: totalAmount,
            credit: 0,
          },
          {
            code: '2100',
            name: 'Driver Reimbursement Payable',
            description: `Reimbursement payable for ${entryId.slice(0, 8)}`,
            debit: 0,
            credit: totalAmount,
          },
        ],
      });
      if (!glEntry) {
        throw new Error('Failed to post GL journal entry for driver expense');
      }

      return NextResponse.json({
        ok: true,
        id: entryId,
        entryId,
        shiftId,
        status: expenseStatus,
        hasBillPhoto: !!body.billPhoto || !!body.receiptUrl,
      }, { status: 201 });
    });
  } catch (err) {
    console.error('[driver-app/expenses POST]', err);
    return NextResponse.json({ error: 'Failed to record driver expense' }, { status: 500 });
  }
}

