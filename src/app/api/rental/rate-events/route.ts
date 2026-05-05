/**
 * GET  /api/rental/rate-events  — list active events (optional ?from=YYYY-MM-DD&to=YYYY-MM-DD)
 * POST /api/rental/rate-events  — create or upsert by eventCode
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withAudit } from '@/lib/with-audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const bodySchema = z.object({
  eventCode: z.string().min(1).max(50),
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  dateFrom: z.string(),
  dateTo: z.string(),
  multiplier: z.coerce.number().min(0.1).max(5),
  applicableCategories: z.string().optional(),
  applicableChannels: z.string().optional(),
  priority: z.coerce.number().int().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const from = sp.get('from');
    const to = sp.get('to');
    const events = await prisma.rateEvent.findMany({
      where: {
        deletedAt: null,
        ...(from ? { dateTo: { gte: new Date(from) } } : {}),
        ...(to ? { dateFrom: { lte: new Date(to) } } : {}),
      },
      orderBy: { dateFrom: 'asc' },
    });
    return NextResponse.json(events);
  } catch (err) {
    captureException(err, { context: 'rental.rate-events.GET' });
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}

export const POST = withAudit(
  async (req: NextRequest) => {
    try {
      const body = await req.json();
      const parsed = bodySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: 'Validation failed',
            details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
          },
          { status: 400 },
        );
      }

      const dateFrom = new Date(parsed.data.dateFrom);
      const dateTo = new Date(parsed.data.dateTo);
      if (dateTo < dateFrom) {
        return NextResponse.json({ error: 'dateTo must be on or after dateFrom' }, { status: 400 });
      }

      const event = await prisma.rateEvent.upsert({
        where: { eventCode: parsed.data.eventCode },
        update: {
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          dateFrom,
          dateTo,
          multiplier: parsed.data.multiplier,
          applicableCategories: parsed.data.applicableCategories ?? null,
          applicableChannels: parsed.data.applicableChannels ?? null,
          priority: parsed.data.priority ?? 0,
          isActive: parsed.data.isActive ?? true,
          notes: parsed.data.notes ?? null,
        },
        create: {
          eventCode: parsed.data.eventCode,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          dateFrom,
          dateTo,
          multiplier: parsed.data.multiplier,
          applicableCategories: parsed.data.applicableCategories ?? null,
          applicableChannels: parsed.data.applicableChannels ?? null,
          priority: parsed.data.priority ?? 0,
          isActive: parsed.data.isActive ?? true,
          notes: parsed.data.notes ?? null,
        },
      });
      return NextResponse.json(event, { status: 201 });
    } catch (err) {
      captureException(err, { context: 'rental.rate-events.POST' });
      return NextResponse.json({ error: 'Failed to save event' }, { status: 500 });
    }
  },
  {
    entityType: 'RateEvent',
    action: 'CREATE',
    extractEntity: (body) => ({ id: body?.id, name: body?.eventCode }),
    describe: (_req, body) =>
      body?.eventCode
        ? `Saved rate event ${body.eventCode} (${body.name}, multiplier ${body.multiplier})`
        : undefined,
  },
);
