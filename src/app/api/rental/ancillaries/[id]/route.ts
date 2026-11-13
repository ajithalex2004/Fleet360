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
  nameEn: z.string().trim().min(1).max(120).optional(),
  nameAr: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  category: z.enum(['ACCESSORY', 'INSURANCE', 'PERMIT', 'DRIVER', 'FUEL', 'OTHER']).nullable().optional(),
  pricingType: z.enum(['PER_DAY', 'ONE_TIME']).optional(),
  unitPrice: z.coerce.number().finite().min(0).optional(),
  currency: z.string().optional(),
  applicableCategories: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
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
      const item = await tx.rentalAncillary.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(item);
    } catch (err) {
      captureException(err, { context: 'rental.ancillaries.[id].GET' });
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
    'ancillaries',
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
    const updated = await withTenantRls(prisma, tenantId, async (tx) => {
      const existing = await tx.rentalAncillary.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!existing) return null;

      return tx.rentalAncillary.update({
        where: { id, tenantId },
        data: {
          ...(parsed.data.nameEn !== undefined ? { nameEn: parsed.data.nameEn } : {}),
          ...(parsed.data.nameAr !== undefined ? { nameAr: parsed.data.nameAr } : {}),
          ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
          ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
          ...(parsed.data.pricingType !== undefined ? { pricingType: parsed.data.pricingType } : {}),
          ...(parsed.data.unitPrice !== undefined ? { unitPrice: parsed.data.unitPrice } : {}),
          ...(parsed.data.currency !== undefined ? { currency: parsed.data.currency } : {}),
          ...(parsed.data.applicableCategories !== undefined
            ? { applicableCategories: parsed.data.applicableCategories }
            : {}),
          ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
          ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
          ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
        },
      });
    });

    if (!updated) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    void logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
      entityType: 'RentalAncillary',
      entityId: updated.id,
      entityName: updated.code,
      action: 'UPDATE',
      details: `Updated ancillary ${updated.code}`,
    });

    return NextResponse.json(updated);
  } catch (err) {
    captureException(err, { context: 'rental.ancillaries.[id].PATCH' });
    return NextResponse.json({ error: 'Failed to update ancillary' }, { status: 500 });
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
    'ancillaries',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  const { id } = await ctx.params;

  try {
    const deleted = await withTenantRls(prisma, tenantId, async (tx) => {
      const existing = await tx.rentalAncillary.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!existing) return null;

      return tx.rentalAncillary.update({
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
      entityType: 'RentalAncillary',
      entityId: deleted.id,
      entityName: deleted.code,
      action: 'DELETE',
      details: 'Soft-deleted ancillary',
    });

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    captureException(err, { context: 'rental.ancillaries.[id].DELETE' });
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
