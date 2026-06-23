import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { attachTenantToEntity, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { ensureRentalGovernance } from '@/lib/rental-governance';
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
  await ensureRentalGovernance();
  try {
    const sp = req.nextUrl.searchParams;
    const ctx = requireOperationalContext(req, 'rac', { requestedTenantId: sp.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;

    const from = sp.get('from');
    const to = sp.get('to');
    const params: unknown[] = [ctx.tenantId];
    const conditions = [`deleted_at IS NULL`, `(tenant_id::text = $1 OR tenant_id IS NULL OR tenant_id::text = 'GLOBAL')`];
    if (from) {
      params.push(new Date(from).toISOString());
      conditions.push(`date_to >= $${params.length}::timestamptz`);
    }
    if (to) {
      params.push(new Date(to).toISOString());
      conditions.push(`date_from <= $${params.length}::timestamptz`);
    }

    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT *
         FROM rate_events
        WHERE ${conditions.join(' AND ')}
        ORDER BY date_from ASC, priority DESC`,
      ...params,
    );
    return NextResponse.json(rows);
  } catch (error) {
    captureException(error, { context: 'rental.rate-events.GET' });
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac', { write: true });
    if (ctx instanceof NextResponse) return ctx;

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

    const existingRows = await prisma.$queryRawUnsafe<Array<{ id: string; tenant_id: string | null }>>(
      `SELECT id::text, tenant_id::text AS tenant_id
         FROM rate_events
        WHERE event_code = $1
          AND deleted_at IS NULL
        ORDER BY CASE
          WHEN tenant_id::text = $2 THEN 0
          WHEN tenant_id IS NULL THEN 1
          ELSE 2
        END
        LIMIT 1`,
      parsed.data.eventCode,
      ctx.tenantId,
    ).catch(() => []);

    let event: Record<string, unknown> | null = null;
    let action: 'CREATE' | 'UPDATE' = 'CREATE';
    let entityId = '';
    let before: unknown = null;

    if (existingRows[0]) {
      if (existingRows[0].tenant_id !== ctx.tenantId) {
        return NextResponse.json(
          { error: 'eventCode already exists outside this tenant. Create a tenant-specific code variant.' },
          { status: 409 },
        );
      }

      before = await prisma.rateEvent.findUnique({ where: { id: existingRows[0].id } });
      const updated = await prisma.rateEvent.update({
        where: { id: existingRows[0].id },
        data: {
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
      event = updated as unknown as Record<string, unknown>;
      entityId = updated.id;
      action = 'UPDATE';
    } else {
      const created = await prisma.rateEvent.create({
        data: {
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
      await attachTenantToEntity('rate_events', created.id, ctx.tenantId);
      event = created as unknown as Record<string, unknown>;
      entityId = created.id;
    }

    await recordOperationalChange({
      req,
      ctx,
      entityType: 'RateEvent',
      entityId,
      action,
      before,
      after: event,
      summary: `${action === 'CREATE' ? 'Created' : 'Updated'} rate event ${parsed.data.eventCode}.`,
    });

    return NextResponse.json(event, { status: action === 'CREATE' ? 201 : 200 });
  } catch (error) {
    captureException(error, { context: 'rental.rate-events.POST' });
    return NextResponse.json({ error: 'Failed to save event' }, { status: 500 });
  }
}
