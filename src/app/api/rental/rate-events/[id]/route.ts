export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { requireRentalPermission } from '@/lib/rental/rbac';

export const runtime = 'nodejs';

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().nullable().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  multiplier: z.coerce.number().finite().min(0.1).max(5).optional(),
  applicableCategories: z.string().nullable().optional(),
  applicableChannels: z.string().nullable().optional(),
  priority: z.coerce.number().int().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const event = await tx.rateEvent.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(event);
    } catch (err) {
      captureException(err, { context: 'rental.rate-events.[id].GET' });
      return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'edit',
    'rate_events',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  const { id } = await params;

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
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400 },
    );
  }

  try {
    const outcome = await withTenantRls(prisma, tenantId, async (tx) => {
      const existing = await tx.rateEvent.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!existing) return { status: 404 as const, error: 'Not found', event: null };

      const nextFrom = parsed.data.dateFrom ? new Date(parsed.data.dateFrom) : existing.dateFrom;
      const nextTo = parsed.data.dateTo ? new Date(parsed.data.dateTo) : existing.dateTo;
      if (Number.isNaN(nextFrom.getTime()) || Number.isNaN(nextTo.getTime())) {
        return { status: 400 as const, error: 'Invalid dateFrom or dateTo', event: null };
      }
      if (nextTo < nextFrom) {
        return { status: 400 as const, error: 'dateTo must be on or after dateFrom', event: null };
      }

      const updated = await tx.rateEvent.update({
        where: { id, tenantId },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
          ...(parsed.data.dateFrom !== undefined ? { dateFrom: nextFrom } : {}),
          ...(parsed.data.dateTo !== undefined ? { dateTo: nextTo } : {}),
          ...(parsed.data.multiplier !== undefined ? { multiplier: parsed.data.multiplier } : {}),
          ...(parsed.data.applicableCategories !== undefined
            ? { applicableCategories: parsed.data.applicableCategories }
            : {}),
          ...(parsed.data.applicableChannels !== undefined
            ? { applicableChannels: parsed.data.applicableChannels }
            : {}),
          ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
          ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
          ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
        },
      });
      return { status: 200 as const, error: null, event: updated };
    });

    if (!outcome.event) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    void logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
      entityType: 'RateEvent',
      entityId: outcome.event.id,
      entityName: outcome.event.eventCode,
      action: 'UPDATE',
      details: `Updated rate event ${outcome.event.eventCode}`,
    });

    return NextResponse.json(outcome.event);
  } catch (err) {
    captureException(err, { context: 'rental.rate-events.[id].PATCH' });
    return NextResponse.json({ error: 'Failed to update event' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  return PATCH(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'delete',
    'rate_events',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  const { id } = await ctx.params;

  try {
    const deleted = await withTenantRls(prisma, tenantId, async (tx) => {
      const existing = await tx.rateEvent.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!existing) return null;

      return tx.rateEvent.update({
        where: { id, tenantId },
        data: { deletedAt: new Date(), isActive: false },
      });
    });

    if (!deleted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    void logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
      entityType: 'RateEvent',
      entityId: deleted.id,
      entityName: deleted.eventCode,
      action: 'DELETE',
      details: 'Soft-deleted rate event',
    });

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    captureException(err, { context: 'rental.rate-events.[id].DELETE' });
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
