export const dynamic = 'force-dynamic';

/**
 * GET /api/leasing/crm — CRM dashboard view (inquiries + pipeline stats).
 *
 * Tenant scoping: requires x-tenant-id. Pipeline and inquiries are scoped
 * to the caller's tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const inquiries = await tx.leaseInquiry.findMany({
          where: { tenantId, deletedAt: null },
          include: { quotations: { select: { id: true, status: true, totalMonthlyRate: true } } },
          orderBy: { createdAt: 'desc' },
        });
        const pipeline = {
          NEW:              inquiries.filter(i => i.status === 'NEW').length,
          CONTACTED:        inquiries.filter(i => i.status === 'CONTACTED').length,
          QUOTATION_SENT:   inquiries.filter(i => i.status === 'QUOTATION_SENT').length,
          CONVERTED:        inquiries.filter(i => i.status === 'CONVERTED').length,
          LOST:             inquiries.filter(i => i.status === 'LOST').length,
        };
        const conversionRate = inquiries.length > 0 ? (pipeline.CONVERTED / inquiries.length) * 100 : 0;
        return NextResponse.json({ inquiries, pipeline, conversionRate: Math.round(conversionRate) });
        } catch (e) {
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
      }
  });
}

