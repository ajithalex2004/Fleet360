export const dynamic = 'force-dynamic';

/**
 * GET  /api/rental/rate-events  — list active events (optional ?from=YYYY-MM-DD&to=YYYY-MM-DD)
 * POST /api/rental/rate-events  — create or upsert by eventCode
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { requireRentalPermission } from '@/lib/rental/rbac';

export const runtime = 'nodejs';

const bodySchema = z.object({
  eventCode: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(120),
  description: z.string().optional(),
  dateFrom: z.string(),
  dateTo: z.string(),
  multiplier: z.coerce.number().finite().min(0.1).max(5),
  applicableCategories: z.string().optional(),
  applicableChannels: z.string().optional(),
  priority: z.coerce.number().int().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
});

export async function GET(req: NextRequest) {
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

  const sp = req.nextUrl.searchParams;
  const fromParam = sp.get('from');
  const toParam = sp.get('to');

  let parsedFrom: Date | undefined;
  let parsedTo: Date | undefined;
  if (fromParam) {
    parsedFrom = new Date(fromParam);
    if (Number.isNaN(parsedFrom.getTime())) {
      return NextResponse.json({ error: 'Invalid from date parameter' }, { status: 400 });
    }
  }
  if (toParam) {
    parsedTo = new Date(toParam);
    if (Number.isNaN(parsedTo.getTime())) {
      return NextResponse.json({ error: 'Invalid to date parameter' }, { status: 400 });
    }
  }

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const events = await tx.rateEvent.findMany({
        where: {
          tenantId,
          deletedAt: null,
          ...(parsedFrom ? { dateTo: { gte: parsedFrom } } : {}),
          ...(parsedTo ? { dateFrom: { lte: parsedTo } } : {}),
        },
        orderBy: { dateFrom: 'asc' },
      });
      return NextResponse.json(events);
    } catch (err) {
      captureException(err, { context: 'rental.rate-events.GET' });
      return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const createDenied = await requireRentalPermission(
    req.headers,
    tenantId,
    'create',
    'rate_events',
    req.nextUrl.pathname,
  );
  if (createDenied) return createDenied;

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }
  if (!bodyRaw || typeof bodyRaw !== 'object' || Array.isArray(bodyRaw)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  const body = stripTenantOwnershipFields(bodyRaw as Record<string, unknown>);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400 },
    );
  }

  const dateFrom = new Date(parsed.data.dateFrom);
  const dateTo = new Date(parsed.data.dateTo);
  if (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime())) {
    return NextResponse.json({ error: 'Invalid dateFrom or dateTo' }, { status: 400 });
  }
  if (dateTo < dateFrom) {
    return NextResponse.json({ error: 'dateTo must be on or after dateFrom' }, { status: 400 });
  }

  try {
    const outcome = await withTenantRls(prisma, tenantId, async (tx) => {
      const existing = await tx.rateEvent.findFirst({
        where: { tenantId, eventCode: parsed.data.eventCode },
      });

      if (existing) {
        const editDenied = await requireRentalPermission(
          req.headers,
          tenantId,
          'edit',
          'rate_events',
          req.nextUrl.pathname,
        );
        if (editDenied) {
          return { denied: editDenied, event: null, isUpdate: true };
        }
      }

      const fields = {
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
      };

      if (existing) {
        const updated = await tx.rateEvent.update({
          where: { id: existing.id, tenantId },
          data: { ...fields, deletedAt: null },
        });
        return { denied: null, event: updated, isUpdate: true };
      }

      const created = await tx.rateEvent.create({
        data: { tenantId, eventCode: parsed.data.eventCode, ...fields },
      });
      return { denied: null, event: created, isUpdate: false };
    });

    if (outcome.denied) {
      return outcome.denied;
    }

    const event = outcome.event!;
    void logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
      entityType: 'RateEvent',
      entityId: event.id,
      entityName: event.eventCode,
      action: outcome.isUpdate ? 'UPDATE' : 'CREATE',
      details: `Saved rate event ${event.eventCode} (${event.name}, multiplier ${event.multiplier})`,
    });

    return NextResponse.json(event, { status: outcome.isUpdate ? 200 : 201 });
  } catch (err) {
    captureException(err, { context: 'rental.rate-events.POST' });
    return NextResponse.json({ error: 'Failed to save event' }, { status: 500 });
  }
}
