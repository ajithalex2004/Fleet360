/**
 * GET  /api/rental/ancillaries — list all (optionally ?category=)
 * POST /api/rental/ancillaries — upsert by code
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withAudit } from '@/lib/with-audit';
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
  try {
    const cat = req.nextUrl.searchParams.get('category');
    const items = await prisma.rentalAncillary.findMany({
      where: { deletedAt: null, ...(cat ? { category: cat } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    });
    return NextResponse.json(items);
  } catch (err) {
    captureException(err, { context: 'rental.ancillaries.GET' });
    return NextResponse.json({ error: 'Failed to fetch ancillaries' }, { status: 500 });
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
            details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          },
          { status: 400 },
        );
      }
      const item = await prisma.rentalAncillary.upsert({
        where: { code: parsed.data.code },
        update: {
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
        create: {
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
      return NextResponse.json(item, { status: 201 });
    } catch (err) {
      captureException(err, { context: 'rental.ancillaries.POST' });
      return NextResponse.json({ error: 'Failed to save ancillary' }, { status: 500 });
    }
  },
  {
    entityType: 'RentalAncillary',
    action: 'CREATE',
    extractEntity: (b) => ({ id: b?.id, name: b?.code }),
    describe: (_req, b) =>
      b?.code ? `Saved ancillary ${b.code} (${b.nameEn}, ${b.unitPrice} ${b.currency} ${b.pricingType})` : undefined,
  },
);
