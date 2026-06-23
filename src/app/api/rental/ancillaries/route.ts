import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { attachTenantToEntity, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { ensureRentalGovernance } from '@/lib/rental-governance';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const bodySchema = z.object({
  code: z.string().min(1).max(50),
  nameEn: z.string().min(1).max(120),
  nameAr: z.string().optional(),
  description: z.string().optional(),
  category: z.enum(['ACCESSORY', 'INSURANCE', 'PERMIT', 'DRIVER', 'FUEL', 'OTHER']).optional(),
  pricingType: z.enum(['PER_DAY', 'ONE_TIME']),
  unitPrice: z.coerce.number().min(0),
  currency: z.string().optional(),
  applicableCategories: z.string().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
  notes: z.string().optional(),
});

export async function GET(req: NextRequest) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;

    const category = req.nextUrl.searchParams.get('category');
    const params: unknown[] = [ctx.tenantId];
    const conditions = [`deleted_at IS NULL`, `(tenant_id::text = $1 OR tenant_id IS NULL OR tenant_id::text = 'GLOBAL')`];
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    const items = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT *
         FROM rental_ancillaries
        WHERE ${conditions.join(' AND ')}
        ORDER BY sort_order ASC, name_en ASC`,
      ...params,
    );
    return NextResponse.json(items);
  } catch (error) {
    captureException(error, { context: 'rental.ancillaries.GET' });
    return NextResponse.json({ error: 'Failed to fetch ancillaries' }, { status: 500 });
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

    const existingRows = await prisma.$queryRawUnsafe<Array<{ id: string; tenant_id: string | null }>>(
      `SELECT id::text, tenant_id::text AS tenant_id
         FROM rental_ancillaries
        WHERE code = $1
          AND deleted_at IS NULL
        ORDER BY CASE
          WHEN tenant_id::text = $2 THEN 0
          WHEN tenant_id IS NULL THEN 1
          ELSE 2
        END
        LIMIT 1`,
      parsed.data.code,
      ctx.tenantId,
    ).catch(() => []);

    let item: Record<string, unknown> | null = null;
    let action: 'CREATE' | 'UPDATE' = 'CREATE';
    let entityId = '';
    let before: unknown = null;

    if (existingRows[0]) {
      if (existingRows[0].tenant_id !== ctx.tenantId) {
        return NextResponse.json(
          { error: 'Ancillary code already exists outside this tenant. Create a tenant-specific code variant.' },
          { status: 409 },
        );
      }

      before = await prisma.rentalAncillary.findUnique({ where: { id: existingRows[0].id } });
      const updated = await prisma.rentalAncillary.update({
        where: { id: existingRows[0].id },
        data: {
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
        },
      });
      item = updated as unknown as Record<string, unknown>;
      entityId = updated.id;
      action = 'UPDATE';
    } else {
      const created = await prisma.rentalAncillary.create({
        data: {
          code: parsed.data.code,
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
        },
      });
      await attachTenantToEntity('rental_ancillaries', created.id, ctx.tenantId);
      item = created as unknown as Record<string, unknown>;
      entityId = created.id;
    }

    await recordOperationalChange({
      req,
      ctx,
      entityType: 'RentalAncillary',
      entityId,
      action,
      before,
      after: item,
      summary: `${action === 'CREATE' ? 'Created' : 'Updated'} ancillary ${parsed.data.code}.`,
    });
    return NextResponse.json(item, { status: action === 'CREATE' ? 201 : 200 });
  } catch (error) {
    captureException(error, { context: 'rental.ancillaries.POST' });
    return NextResponse.json({ error: 'Failed to save ancillary' }, { status: 500 });
  }
}
