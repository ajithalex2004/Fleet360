export const dynamic = 'force-dynamic';

/**
 * POST /api/rental/rates/yield
 *
 * Yield-managed rate calculation. Applies seven layers (BASE, LOR, WEEKEND,
 * LEAD_TIME, UTILIZATION, EVENT, CHANNEL) on top of the standard rate engine
 * and returns a step-by-step trace so the user can see how the price was
 * arrived at.
 *
 * Body:
 *   {
 *     vehicleCategory: string,
 *     pickupDate: ISO,
 *     dropoffDate: ISO,
 *     channel?: 'DIRECT' | 'CORPORATE' | 'AGENCY' | 'ONLINE',
 *     corporateAccountId?: string,
 *     fleetUtilizationPct?: number   (auto-calculated if omitted)
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  calculateYieldRate,
  categoriesMatch,
  type RateEventSnapshot,
  type YieldRule,
} from '@/lib/rental-yield-engine';
import { withSavepoint } from '@/lib/rental/locks';
import { captureException } from '@/lib/sentry';
import { requireRentalPermission } from '@/lib/rental/rbac';
import {
  assertRentalForeignKeysInTenant,
  isRentalSecurityError,
} from '@/lib/rental/security-guards';

export const runtime = 'nodejs';

const bodySchema = z.object({
  vehicleCategory: z.string().min(1),
  pickupDate: z.string(),
  dropoffDate: z.string(),
  channel: z.enum(['DIRECT', 'CORPORATE', 'AGENCY', 'ONLINE']).optional(),
  corporateAccountId: z.string().min(1).optional(),
  fleetUtilizationPct: z.number().min(0).max(100).optional(),
});

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    '*',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  let jsonRaw: unknown;
  try {
    jsonRaw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }
  if (!jsonRaw || typeof jsonRaw !== 'object' || Array.isArray(jsonRaw)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  const json = stripTenantOwnershipFields(jsonRaw as Record<string, unknown>);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400 },
    );
  }

  const pickupDate = new Date(parsed.data.pickupDate);
  const dropoffDate = new Date(parsed.data.dropoffDate);
  if (Number.isNaN(pickupDate.getTime()) || Number.isNaN(dropoffDate.getTime())) {
    return NextResponse.json({ error: 'Invalid pickup/dropoff date' }, { status: 400 });
  }
  if (dropoffDate <= pickupDate) {
    return NextResponse.json({ error: 'dropoffDate must be after pickupDate' }, { status: 400 });
  }

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      if (parsed.data.corporateAccountId) {
        await assertRentalForeignKeysInTenant(tx, tenantId, {
          corporateAccountId: parsed.data.corporateAccountId,
        });
      }

      // Pull all active pricing rules for this tenant so synonym categories
      // (e.g. SUV <-> SUV_4X4) and weekly/monthly/priority attributes match cleanly.
      const ruleRows = await withSavepoint<Record<string, unknown>[]>(
        tx,
        'yield_pricing_rules',
        () =>
          tx.$queryRawUnsafe<Record<string, unknown>[]>(
            `SELECT * FROM pricing_rules WHERE tenant_id::text = $1 AND is_active = true ORDER BY priority DESC`,
            tenantId,
          ),
        [],
      );
      const rules: YieldRule[] = ruleRows
        .filter((r) => (r.isActive ?? r.is_active ?? true) !== false)
        .filter((r) =>
          categoriesMatch(
            String(r.vehicleCategory ?? r.vehicle_category ?? ''),
            parsed.data.vehicleCategory,
          ),
        )
        .map((r) => ({
          id: String(r.id),
          name: r.name != null ? String(r.name) : null,
          vehicleCategory: String(r.vehicleCategory ?? r.vehicle_category ?? ''),
          baseDailyRate: Number(r.baseDailyRate ?? r.base_daily_rate ?? 0),
          weeklyRate:
            (r.weeklyRate ?? r.weekly_rate) != null
              ? Number(r.weeklyRate ?? r.weekly_rate)
              : null,
          monthlyRate:
            (r.monthlyRate ?? r.monthly_rate) != null
              ? Number(r.monthlyRate ?? r.monthly_rate)
              : null,
          weekendDailyRate:
            (r.weekendDailyRate ?? r.weekend_daily_rate) != null
              ? Number(r.weekendDailyRate ?? r.weekend_daily_rate)
              : null,
          priority: Number(r.priority ?? 0),
          isActive: Boolean(r.isActive ?? r.is_active ?? true),
        }));

      // Pull events that overlap any part of [pickupDate, dropoffDate].
      const eventRows = await withSavepoint<Record<string, unknown>[]>(
        tx,
        'yield_rate_events',
        () =>
          tx.$queryRawUnsafe<Record<string, unknown>[]>(
            `SELECT *
               FROM rate_events
              WHERE tenant_id::text = $1
                AND deleted_at IS NULL
                AND is_active = true
                AND date_from <= $2::timestamptz
                AND date_to >= $3::timestamptz`,
            tenantId,
            dropoffDate.toISOString(),
            pickupDate.toISOString(),
          ),
        [],
      );
      const events: RateEventSnapshot[] = eventRows.map((e) => ({
        id: String(e.id),
        eventCode: String(e.eventCode ?? e.event_code ?? e.name ?? ''),
        name: String(e.name ?? ''),
        dateFrom: new Date(String(e.dateFrom ?? e.date_from ?? pickupDate.toISOString())),
        dateTo: new Date(String(e.dateTo ?? e.date_to ?? dropoffDate.toISOString())),
        multiplier: Number(e.multiplier ?? 1),
        flatSurcharge:
          (e.flatSurcharge ?? e.flat_surcharge) != null
            ? Number(e.flatSurcharge ?? e.flat_surcharge)
            : 0,
        applicableCategories: (e.applicableCategories ?? e.applicable_categories ?? null) as
          | string
          | null,
        applicableChannels: (e.applicableChannels ?? e.applicable_channels ?? null) as
          | string
          | null,
        priority: Number(e.priority ?? 0),
        isActive: (e.isActive ?? e.is_active ?? true) !== false,
      }));

      // Auto-calculate utilization sequentially on `tx` (concurrent Promise.all
      // on an interactive Prisma transaction corrupts PG wire state).
      let utilizationPct = parsed.data.fleetUtilizationPct;
      if (utilizationPct == null) {
        const vehicleRows = await withSavepoint<Array<{ cat: string }>>(
          tx,
          'yield_util_fleet',
          () =>
            tx.$queryRawUnsafe<Array<{ cat: string }>>(
              `SELECT COALESCE(to_jsonb(v)->>'category', to_jsonb(v)->>'type', '') AS cat
                 FROM vehicles v
                WHERE v.tenant_id::text = $1
                  AND (to_jsonb(v)->>'deleted_at') IS NULL
                  AND UPPER(COALESCE(v.status::text, '')) <> 'INACTIVE'`,
              tenantId,
            ),
          [],
        );
        const fleetSize = vehicleRows.filter((v) =>
          categoriesMatch(v.cat ?? '', parsed.data.vehicleCategory),
        ).length;

        if (fleetSize >= 5) {
          const bookingRows = await withSavepoint<Array<{ vehicle_category: string | null }>>(
            tx,
            'yield_util_bookings',
            () =>
              tx.$queryRawUnsafe<Array<{ vehicle_category: string | null }>>(
                `SELECT vehicle_category
                   FROM rental_bookings
                  WHERE tenant_id::text = $1
                    AND deleted_at IS NULL
                    AND status IN ('CONFIRMED', 'ACTIVE')
                    AND pickup_date <= $2::timestamptz
                    AND dropoff_date >= $3::timestamptz`,
                tenantId,
                dropoffDate.toISOString(),
                pickupDate.toISOString(),
              ),
            [],
          );
          const activeBookings = bookingRows.filter((b) =>
            categoriesMatch(b.vehicle_category ?? '', parsed.data.vehicleCategory),
          ).length;
          utilizationPct = Math.min(100, Math.round((activeBookings / fleetSize) * 100));
        } else {
          utilizationPct = undefined;
        }
      }

      const result = calculateYieldRate({
        request: {
          vehicleCategory: parsed.data.vehicleCategory,
          pickupDate,
          dropoffDate,
          channel: parsed.data.channel,
          fleetUtilizationPct: utilizationPct,
        },
        rules,
        events,
      });

      return NextResponse.json({
        ok: true,
        result,
        diagnostics: {
          rulesConsidered: rules.length,
          eventsConsidered: events.length,
          utilizationPctUsed: utilizationPct,
          utilizationAuto: parsed.data.fleetUtilizationPct == null,
        },
      });
    } catch (err: unknown) {
      if (isRentalSecurityError(err)) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      captureException(err, { context: 'rental.rates.yield' });
      console.error('[rental yield] error:', err);
      return NextResponse.json({ error: 'Yield calculation failed' }, { status: 500 });
    }
  });
}
