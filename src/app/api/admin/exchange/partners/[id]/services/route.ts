export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { PartnerServiceDomain } from '@prisma/client';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { isSuperAdmin } from '@/lib/admin-access';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { notProvisionedAware } from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * PUT /api/admin/exchange/partners/:id/services   { domain, approved }
 *
 * Approves or revokes a transport partner for a whole service area
 * (PASSENGER_TRANSPORT, LIMOUSINE, FREIGHT, RECOVERY). The marketplace and
 * quote eligibility match opportunities on a partner's approved capability
 * domains, so a partner with none sees nothing but direct invitations.
 *
 * Approving upserts one domain-wide capability (service_type ALL); revoking
 * un-approves every capability the partner has in that domain, including
 * service-specific ones. Platform administrators only (ADMIN_ROUTE_POLICY).
 */

/** service_type of the capability that approves a partner for a whole domain. */
const DOMAIN_WIDE_SERVICE_TYPE = 'ALL';

const DOMAINS = Object.values(PartnerServiceDomain) as string[];

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: partnerId } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  if (!isSuperAdmin(req.headers)) return NextResponse.json({ error: 'Platform administrators only' }, { status: 403 });

  const body = stripTenantOwnershipFields(await req.json().catch(() => ({}))) as Record<string, unknown>;
  const domain = typeof body.domain === 'string' ? body.domain : '';
  if (!DOMAINS.includes(domain)) {
    return NextResponse.json({ error: `domain must be one of ${DOMAINS.join(', ')}` }, { status: 400 });
  }
  if (typeof body.approved !== 'boolean') {
    return NextResponse.json({ error: 'approved must be true or false' }, { status: 400 });
  }
  const approved = body.approved;
  const serviceDomain = domain as PartnerServiceDomain;

  const run = await notProvisionedAware(() => withPlatformAdmin(prisma, async (tx) => {
    const partner = await tx.transportPartner.findFirst({
      where: { id: partnerId, deletedAt: null },
      select: { id: true, legalName: true },
    });
    if (!partner) return null;

    if (approved) {
      await tx.partnerCapability.upsert({
        where: { partnerId_domain_serviceType: { partnerId, domain: serviceDomain, serviceType: DOMAIN_WIDE_SERVICE_TYPE } },
        create: { partnerId, domain: serviceDomain, serviceType: DOMAIN_WIDE_SERVICE_TYPE, isApproved: true },
        update: { isApproved: true },
      });
    } else {
      await tx.partnerCapability.updateMany({
        where: { partnerId, domain: serviceDomain },
        data: { isApproved: false },
      });
    }

    const rows = await tx.partnerCapability.findMany({
      where: { partnerId, isApproved: true },
      select: { domain: true },
    });
    return { partner, approvedDomains: [...new Set(rows.map((r) => r.domain))] };
  }));
  if ('response' in run) return run.response;
  if (!run.value) return NextResponse.json({ error: 'Transport partner not found' }, { status: 404 });
  const { partner, approvedDomains } = run.value;

  await logAudit({
    entityType: 'TransportPartner',
    entityId: partner.id,
    action: 'UPDATE',
    details: `${approved ? 'Approved' : 'Revoked'} ${partner.legalName} for ${domain}`,
    userId: req.headers.get('x-user-id') ?? undefined,
  });

  return NextResponse.json({ partnerId: partner.id, approvedDomains });
}
