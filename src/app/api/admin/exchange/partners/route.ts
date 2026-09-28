export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { isSuperAdmin } from '@/lib/admin-access';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { notProvisionedAware } from '@/lib/exchange/partner-auth';
import { findActiveTenant, setOnboardingTenant } from '@/lib/exchange/partner-onboarding';
import { isEmirate, SERVICE_DOMAINS, type ServiceDomain } from '@/lib/exchange/partner-activation';
import { withAuditedAction } from '@/lib/audited-action';

export const runtime = 'nodejs';

/**
 * Transport partners of the Exchange marketplace, for the platform admin
 * screen (/admin/exchange-partners). Partners are platform-level records,
 * each onboarded by a tenant whose users its staff are
 * (see src/lib/exchange/partner-onboarding.ts). Platform administrators only
 * (ADMIN_ROUTE_POLICY).
 *
 * GET  /api/admin/exchange/partners   every partner with its member count,
 *                                     approved service areas (approvedDomains),
 *                                     compliance documents awaiting review (pendingDocuments)
 *                                     and onboarding tenant (onboardedByTenantId/-Name)
 * POST /api/admin/exchange/partners   { legalName, partnerCode, onboardedByTenantId, emirate,
 *                                       serviceDomains?, tradeName?, city?, primaryContactName?,
 *                                       primaryContactEmail?, primaryContactPhone? }
 *
 * A new partner starts Pending Activation (onboarding DRAFT, marketplace
 * NOT_APPLIED): its onboarding tenant's administrators activate it once they
 * have approved its compliance documents (src/lib/exchange/partner-activation.ts).
 * The emirate and service areas decide which documents are mandatory.
 */

const PARTNER_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,23}$/;

const optionalText = (v: unknown, max = 200): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  if (!isSuperAdmin(req.headers)) return NextResponse.json({ error: 'Platform administrators only' }, { status: 403 });

  const run = await notProvisionedAware(() => withPlatformAdmin(prisma, (tx) =>
    tx.transportPartner.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        legalName: true,
        tradeName: true,
        partnerCode: true,
        city: true,
        emirate: true,
        primaryContactEmail: true,
        onboardingStatus: true,
        operationalStatus: true,
        marketplaceStatus: true,
        onboardedByTenantId: true,
        createdAt: true,
        _count: { select: { users: true } },
        capabilities: { where: { isApproved: true }, select: { domain: true } },
        complianceDocuments: { where: { status: 'PENDING' }, select: { id: true } },
      },
      orderBy: { legalName: 'asc' },
    }),
  ));
  if ('response' in run) return run.response;

  const tenantIds = [...new Set(run.value.map((p) => p.onboardedByTenantId).filter((id): id is string => !!id))];
  const tenants = tenantIds.length
    ? await withPlatformAdmin(prisma, (tx) => tx.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } }))
    : [];
  const tenantName = new Map(tenants.map((t) => [t.id, t.name]));

  const partners = run.value.map(({ _count, capabilities, complianceDocuments, ...p }) => ({
    ...p,
    onboardedByTenantName: p.onboardedByTenantId ? tenantName.get(p.onboardedByTenantId) ?? null : null,
    memberCount: _count.users,
    approvedDomains: [...new Set(capabilities.map((c) => c.domain))],
    pendingDocuments: complianceDocuments.length,
  }));
  return NextResponse.json({ partners });
}

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  if (!isSuperAdmin(req.headers)) return NextResponse.json({ error: 'Platform administrators only' }, { status: 403 });

  const body = stripTenantOwnershipFields(await req.json().catch(() => ({}))) as Record<string, unknown>;
  const legalName = optionalText(body.legalName);
  const partnerCode = typeof body.partnerCode === 'string' ? body.partnerCode.trim().toUpperCase() : '';
  const primaryContactEmail = optionalText(body.primaryContactEmail)?.toLowerCase();
  // Not tenantId: stripTenantOwnershipFields drops that from every body.
  const onboardedByTenantId = typeof body.onboardedByTenantId === 'string' ? body.onboardedByTenantId.trim() : '';

  if (!legalName) return NextResponse.json({ error: 'legalName is required' }, { status: 400 });
  if (!PARTNER_CODE_RE.test(partnerCode)) {
    return NextResponse.json(
      { error: 'partnerCode must be 2–24 characters: letters, digits and dashes' },
      { status: 400 },
    );
  }
  if (primaryContactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(primaryContactEmail)) {
    return NextResponse.json({ error: 'primaryContactEmail is not a valid email address' }, { status: 400 });
  }
  if (!onboardedByTenantId) {
    return NextResponse.json({ error: 'onboardedByTenantId is required: the tenant onboarding this partner' }, { status: 400 });
  }
  const emirate = body.emirate;
  if (!isEmirate(emirate)) {
    return NextResponse.json({ error: 'emirate is required: where the partner operates from' }, { status: 400 });
  }
  const rawDomains = Array.isArray(body.serviceDomains) ? body.serviceDomains : [];
  const serviceDomains = [...new Set(rawDomains)].filter((d): d is ServiceDomain => (SERVICE_DOMAINS as readonly unknown[]).includes(d));
  if (serviceDomains.length !== rawDomains.length) {
    return NextResponse.json({ error: `serviceDomains must be among ${SERVICE_DOMAINS.join(', ')}` }, { status: 400 });
  }

  let run;
  try {
    run = await notProvisionedAware(() => withPlatformAdmin(prisma, async (tx) => {
      const tenant = await findActiveTenant(tx, onboardedByTenantId);
      if (!tenant) return null;
      const created = await tx.transportPartner.create({
        data: {
          legalName,
          partnerCode,
          tradeName: optionalText(body.tradeName),
          city: optionalText(body.city, 100),
          emirate,
          // Pending Activation until the onboarding tenant activates it.
          onboardingStatus: 'DRAFT',
          marketplaceStatus: 'NOT_APPLIED',
          primaryContactName: optionalText(body.primaryContactName),
          primaryContactEmail,
          primaryContactPhone: optionalText(body.primaryContactPhone, 40),
        },
        select: { id: true, legalName: true, partnerCode: true },
      });
      await setOnboardingTenant(tx, created.id, tenant.id);
      // Domain-wide capabilities, as the Services toggles create them.
      for (const domain of serviceDomains) {
        await tx.partnerCapability.create({ data: { partnerId: created.id, domain, serviceType: 'ALL', isApproved: true } });
      }
      return { ...created, onboardedByTenantId: tenant.id, onboardedByTenantName: tenant.name };
    }));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: `Partner code ${partnerCode} is already in use` }, { status: 409 });
    }
    throw err;
  }
  if ('response' in run) return run.response;
  const partner = run.value;
  if (!partner) return NextResponse.json({ error: 'Onboarding tenant not found or inactive' }, { status: 400 });

  await logAudit({
    entityType: 'TransportPartner',
    entityId: partner.id,
    action: 'CREATE',
    details: `Created transport partner ${partner.legalName} (${partner.partnerCode}), onboarded by ${partner.onboardedByTenantName}`,
    userId: req.headers.get('x-user-id') ?? undefined,
  });

  return NextResponse.json({ partner }, { status: 201 });
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
