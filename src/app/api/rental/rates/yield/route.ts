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
 *     fleetUtilizationPct?: number   (auto-calculated if omitted)
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireOperationalContext } from '@/lib/cross-module-governance';
import { ensureRentalGovernance } from '@/lib/rental-governance';
import {
  calculateYieldRate,
  type RateEventSnapshot,
  type YieldRule,
} from '@/lib/rental-yield-engine';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const bodySchema = z.object({
  vehicleCategory: z.string().min(1),
  pickupDate: z.string(),
  dropoffDate: z.string(),
  channel: z.enum(['DIRECT', 'CORPORATE', 'AGENCY', 'ONLINE']).optional(),
  fleetUtilizationPct: z.number().min(0).max(100).optional(),
});

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const asNullableString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const asDate = (value: unknown): Date => {
  if (value instanceof Date) return value;
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

export async function POST(req: NextRequest) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac');
    if (ctx instanceof NextResponse) return ctx;

    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
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

    // Pull pricing rules for this category. Schema columns vary; we project
    // only what the engine needs.
    const ruleRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT *
         FROM pricing_rules
        WHERE vehicle_category = $1
          AND (tenant_id::text = $2 OR tenant_id IS NULL OR tenant_id::text = 'GLOBAL')
        ORDER BY priority DESC, created_at DESC`,
      parsed.data.vehicleCategory,
      ctx.tenantId,
    );
    const rules: YieldRule[] = ruleRows.map((r) => ({
      id: String(r.id),
      name: typeof r.name === 'string' ? r.name : null,
      vehicleCategory: String(r.vehicle_category ?? r.vehicleCategory ?? ''),
      baseDailyRate: Number(r.base_daily_rate ?? r.baseDailyRate ?? 0),
      weekendDailyRate: r.weekend_daily_rate != null || r.weekendDailyRate != null
        ? Number(r.weekend_daily_rate ?? r.weekendDailyRate)
        : null,
      isActive: Boolean(r.is_active ?? r.isActive ?? true),
    }));

    // Pull events that overlap the pickup date.
    const eventRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT *
         FROM rate_events
        WHERE is_active = true
          AND deleted_at IS NULL
          AND date_from <= $1::timestamptz
          AND date_to >= $1::timestamptz
          AND (tenant_id::text = $2 OR tenant_id IS NULL OR tenant_id::text = 'GLOBAL')`,
      pickupDate.toISOString(),
      ctx.tenantId,
    );
    const events: RateEventSnapshot[] = eventRows.map(e => ({
      id: asString(e.id),
      eventCode: asString(e.event_code ?? e.eventCode),
      name: asString(e.name),
      dateFrom: asDate(e.date_from ?? e.dateFrom),
      dateTo: asDate(e.date_to ?? e.dateTo),
      multiplier: Number(e.multiplier),
      applicableCategories: asNullableString(e.applicable_categories ?? e.applicableCategories),
      applicableChannels: asNullableString(e.applicable_channels ?? e.applicableChannels),
      priority: Number(e.priority ?? 0),
      isActive: Boolean(e.is_active ?? e.isActive ?? true),
    }));

    // Auto-calculate utilization if not provided. Heuristic: count rentals
    // currently occupying vehicles in this category vs total fleet of this
    // category. Simple snapshot, refined in v1.1.
    let utilizationPct = parsed.data.fleetUtilizationPct;
    if (utilizationPct == null) {
      try {
        const [activeBookings, fleetSize] = await Promise.all([
          prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT COUNT(*)::bigint AS count
               FROM rental_bookings
              WHERE tenant_id::text = $1
                AND deleted_at IS NULL
                AND vehicle_category = $2
                AND status IN ('CONFIRMED', 'ACTIVE')
                AND pickup_date <= $3::timestamptz
                AND dropoff_date >= $3::timestamptz`,
            ctx.tenantId,
            parsed.data.vehicleCategory,
            pickupDate.toISOString(),
          ).then(rows => Number(rows[0]?.count ?? 0)),
          prisma.vehicle.count({
            where: {
              type: parsed.data.vehicleCategory,
              status: { not: 'INACTIVE' },
              deletedAt: null,
            },
          }),
        ]);
        utilizationPct = fleetSize > 0 ? Math.min(100, Math.round((activeBookings / fleetSize) * 100)) : 0;
      } catch {
        utilizationPct = undefined; // engine handles undefined gracefully
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
  } catch (err) {
    captureException(err, { context: 'rental.rates.yield' });
    console.error('[rental yield] error:', err);
    return NextResponse.json({ error: 'Yield calculation failed' }, { status: 500 });
  }
}
