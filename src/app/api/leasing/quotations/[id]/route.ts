export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';

/**
 * Single-quotation GET.
 *
 * Multi-tenant: `findFirst` enforces x-tenant-id from the middleware.
 * Returns 404 (not 403) on cross-tenant probes so we don't leak the
 * existence of rows belonging to other tenants.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const quotation = await tx.leaseQuotation.findFirst({
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
        const history = await tx.leaseApprovalStep.findMany({
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
        } catch (e) {
        console.error('Fetch quotation error:', e);
        return NextResponse.json({ error: 'Failed to fetch quotation details' }, { status: 500 });
      }
  });
}

