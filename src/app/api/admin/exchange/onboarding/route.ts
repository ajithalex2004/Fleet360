export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { notProvisionedAware } from '@/lib/exchange/partner-auth';
import { emirateOf, onboardingChecklist, onboardingStatusLabel } from '@/lib/exchange/partner-activation';
import { reviewerScope, scopeWhere } from '@/lib/exchange/onboarding-review';

export const runtime = 'nodejs';

/**
 * GET /api/admin/exchange/onboarding
 *
 * The transport partners the caller's company onboarded, with their
 * activation stage and document checklist summary, for /admin/partner-
 * onboarding. Tenant administrators see their own tenant's partners;
 * platform administrators see every partner.
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const reviewer = reviewerScope(req.headers, authz.tenantId);
  if (!reviewer.ok) return reviewer.response;
  const { scope } = reviewer;

  const run = await notProvisionedAware(() => withPlatformAdmin(prisma, async (tx) => {
    const partners = await tx.transportPartner.findMany({
      where: scopeWhere(scope),
      select: {
        id: true, legalName: true, partnerCode: true, city: true, emirate: true,
        onboardingStatus: true, operationalStatus: true, onboardedByTenantId: true, createdAt: true, approvedAt: true,
        capabilities: { select: { domain: true } },
        complianceDocuments: { select: { docType: true, docNumber: true, expiryDate: true, status: true } },
        _count: { select: { users: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const tenantIds = [...new Set(partners.map((p) => p.onboardedByTenantId).filter((id): id is string => !!id))];
    const tenants = tenantIds.length
      ? await tx.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } })
      : [];
    return { partners, tenantName: new Map(tenants.map((t) => [t.id, t.name])) };
  }));
  if ('response' in run) return run.response;
  const { partners, tenantName } = run.value;

  return NextResponse.json({
    partners: partners.map(({ capabilities, complianceDocuments, _count, ...p }) => {
      const domains = [...new Set(capabilities.map((c) => c.domain as string))];
      const checklist = onboardingChecklist({ domains, emirate: emirateOf(p) }, complianceDocuments);
      return {
        ...p,
        emirate: emirateOf(p),
        domains,
        onboardingLabel: onboardingStatusLabel(p.onboardingStatus),
        onboardedByTenantName: p.onboardedByTenantId ? tenantName.get(p.onboardedByTenantId) ?? null : null,
        memberCount: _count.users,
        required: checklist.items.length,
        approved: checklist.items.filter((i) => i.status === 'VALID' || i.status === 'EXPIRING').length,
        awaitingReview: complianceDocuments.filter((d) => d.status === 'PENDING').length,
        readyToActivate: checklist.allApproved && domains.length > 0,
      };
    }),
  });
}
