import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Single-quotation GET.
 *
 * Multi-tenant: `findFirst` enforces x-tenant-id from the middleware.
 * Returns 404 (not 403) on cross-tenant probes so we don't leak the
 * existence of rows belonging to other tenants.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const quotation = await prisma.leaseQuotation.findFirst({
      where: { id: params.id, tenantId },
      include: {
        vehicles: true,
        lineItems: true,
      },
    });

    if (!quotation) {
      return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    }

    // Approval history (audit trail) — also tenant-scoped via the
    // LeaseApprovalStep.tenantId column added by the same migration.
    const history = await prisma.leaseApprovalStep.findMany({
      where: {
        tenantId,
        entityId: params.id,
        entityType: 'QUOTATION',
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return NextResponse.json({
      ...quotation,
      history,
    });
  } catch (error) {
    console.error('Fetch quotation error:', error);
    return NextResponse.json({ error: 'Failed to fetch quotation details' }, { status: 500 });
  }
}
