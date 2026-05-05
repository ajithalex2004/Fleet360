import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAudit } from '@/lib/with-audit';
import { z } from 'zod';

/**
 * Lessee — B2B (corporate) and B2C (individual) supported via the `type` field.
 * Each type has its own validation: corporate requires trade license; individual
 * requires Emirates ID. See lesseeSchema below.
 */

const baseSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  contactPerson: z.string().optional(),
  customerId: z.string().uuid().optional().or(z.literal('')),
});

const corporateSchema = baseSchema.extend({
  type: z.literal('corporate'),
  tradeLicense: z.string().min(1, 'Trade license is required for corporate lessees'),
  // TRN is collected on the customer/contact level; tradeLicense is the leasing KYC anchor.
});

const individualSchema = baseSchema.extend({
  type: z.literal('individual'),
  emiratesId: z.string().min(15, 'Emirates ID must be at least 15 characters'),
  nationality: z.string().min(1, 'Nationality is required for individual lessees'),
  licenseNo: z.string().optional(),
});

const lesseeSchema = z.discriminatedUnion('type', [corporateSchema, individualSchema]);

export async function GET(_req: NextRequest) {
  try {
    const lessees = await prisma.lessee.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(lessees);
  } catch (error) {
    console.error('Error fetching lessees:', error);
    return NextResponse.json({ error: 'Failed to fetch lessees' }, { status: 500 });
  }
}

export const POST = withAudit(
  async (req: NextRequest) => {
    try {
      const body = await req.json();
      const parsed = lesseeSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: 'Validation failed',
            details: parsed.error.issues.map(i => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          },
          { status: 400 },
        );
      }

      const lessee = await prisma.lessee.create({ data: parsed.data });
      return NextResponse.json(lessee, { status: 201 });
    } catch (error) {
      console.error('Error creating lessee:', error);
      return NextResponse.json({ error: 'Failed to create lessee' }, { status: 500 });
    }
  },
  {
    entityType: 'Lessee',
    action: 'CREATE',
    extractEntity: (body) => ({ id: body?.id, name: body?.name }),
    describe: (_req, body) =>
      body?.name
        ? `Onboarded lessee ${body.name} (${body.type})`
        : undefined,
  },
);
