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

export async function POST(req: NextRequest) {
  try {
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
    const ruleRows = await prisma.pricingRule.findMany({
      where: {
        // PricingRule schema doesn't have an isActive field consistently —
        // use what's available.
        vehicleCategory: parsed.data.vehicleCategory,
      },
    });
    const rules: YieldRule[] = ruleRows.map((r: any) => ({
      id: r.id,
      name: r.name ?? null,
      vehicleCategory: r.vehicleCategory ?? r.vehicle_category,
      baseDailyRate: Number(r.baseDailyRate ?? r.base_daily_rate ?? 0),
      weekendDailyRate: r.weekendDailyRate ? Number(r.weekendDailyRate) : null,
      isActive: r.isActive ?? true,
    }));

    // Pull events that overlap the pickup date.
    const eventRows = await prisma.rateEvent.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        dateFrom: { lte: pickupDate },
        dateTo: { gte: pickupDate },
      },
    });
    const events: RateEventSnapshot[] = eventRows.map(e => ({
      id: e.id,
      eventCode: e.eventCode,
      name: e.name,
      dateFrom: e.dateFrom,
      dateTo: e.dateTo,
      multiplier: Number(e.multiplier),
      applicableCategories: e.applicableCategories,
      applicableChannels: e.applicableChannels,
      priority: e.priority ?? 0,
      isActive: e.isActive ?? true,
    }));

    // Auto-calculate utilization if not provided. Heuristic: count rentals
    // currently occupying vehicles in this category vs total fleet of this
    // category. Simple snapshot, refined in v1.1.
    let utilizationPct = parsed.data.fleetUtilizationPct;
    if (utilizationPct == null) {
      try {
        const now = new Date();
        const [activeBookings, fleetSize] = await Promise.all([
          prisma.rentalBooking.count({
            where: {
              vehicleCategory: parsed.data.vehicleCategory,
              status: { in: ['CONFIRMED', 'ACTIVE'] },
              pickupDate: { lte: pickupDate },
              dropoffDate: { gte: pickupDate },
            },
          }),
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
