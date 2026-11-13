export const dynamic = 'force-dynamic';

/**
 * GET  /api/rental/ancillaries — list all (optionally ?category=)
 * POST /api/rental/ancillaries — upsert by code
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
  code: z.string().trim().min(1).max(50),
  nameEn: z.string().trim().min(1).max(120),
  nameAr: z.string().optional(),
  description: z.string().optional(),
  category: z.enum(['ACCESSORY', 'INSURANCE', 'PERMIT', 'DRIVER', 'FUEL', 'OTHER']).optional(),
  pricingType: z.enum(['PER_DAY', 'ONE_TIME']),
  unitPrice: z.coerce.number().finite().min(0),
  currency: z.string().optional(),
  applicableCategories: z.string().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
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

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const cat = req.nextUrl.searchParams.get('category');
      const items = await tx.rentalAncillary.findMany({
        where: { tenantId, deletedAt: null, ...(cat ? { category: cat } : {}) },
        orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
      });
      return NextResponse.json(items);
    } catch (err) {
      captureException(err, { context: 'rental.ancillaries.GET' });
      return NextResponse.json({ error: 'Failed to fetch ancillaries' }, { status: 500 });
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
    'ancillaries',
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

  try {
    const outcome = await withTenantRls(prisma, tenantId, async (tx) => {
      const existing = await tx.rentalAncillary.findFirst({
        where: { tenantId, code: parsed.data.code },
      });

      if (existing) {
        const editDenied = await requireRentalPermission(
          req.headers,
          tenantId,
          'edit',
          'ancillaries',
          req.nextUrl.pathname,
        );
        if (editDenied) {
          return { denied: editDenied, item: null, isUpdate: true };
        }
      }

      const fields = {
        nameEn: parsed.data.nameEn,
        nameAr: parsed.data.nameAr ?? null,
        description: parsed.data.description ?? null,
        category: parsed.data.category ?? null,
        pricingType: parsed.data.pricingType,
        unitPrice: parsed.data.unitPrice,
        currency: parsed.data.currency ?? 'AED',
        applicableCategories: parsed.data.applicableCategories ?? null,
        isActive: parsed.data.isActive ?? true,
        sortOrder: parsed.data.sortOrder ?? 0,
        notes: parsed.data.notes ?? null,
      };

      if (existing) {
        const updated = await tx.rentalAncillary.update({
          where: { id: existing.id, tenantId },
          data: { ...fields, deletedAt: null },
        });
        return { denied: null, item: updated, isUpdate: true };
      }

      const created = await tx.rentalAncillary.create({
        data: { tenantId, code: parsed.data.code, ...fields },
      });
      return { denied: null, item: created, isUpdate: false };
    });

    if (outcome.denied) {
      return outcome.denied;
    }

    const item = outcome.item!;
    void logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
      entityType: 'RentalAncillary',
      entityId: item.id,
      entityName: item.code,
      action: outcome.isUpdate ? 'UPDATE' : 'CREATE',
      details: `Saved ancillary ${item.code} (${item.nameEn}, ${item.unitPrice} ${item.currency} ${item.pricingType})`,
    });

    return NextResponse.json(item, { status: outcome.isUpdate ? 200 : 201 });
  } catch (err) {
    captureException(err, { context: 'rental.ancillaries.POST' });
    return NextResponse.json({ error: 'Failed to save ancillary' }, { status: 500 });
  }
}
