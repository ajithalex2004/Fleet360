export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { isSuperAdmin } from '@/lib/admin-access';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { notProvisionedAware } from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * Transport partners of the Exchange marketplace, for the platform admin
 * screen (/admin/exchange-partners). Partners are platform-level records, not
 * owned by a tenant. Platform administrators only (ADMIN_ROUTE_POLICY).
 *
 * GET  /api/admin/exchange/partners   every partner with its member count,
 *                                     approved service areas (approvedDomains) and
 *                                     compliance documents awaiting review (pendingDocuments)
 * POST /api/admin/exchange/partners   { legalName, partnerCode, tradeName?, city?,
 *                                       primaryContactName?, primaryContactEmail?,
 *                                       primaryContactPhone? }
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
        primaryContactEmail: true,
        onboardingStatus: true,
        operationalStatus: true,
        marketplaceStatus: true,
        createdAt: true,
        _count: { select: { users: true } },
        capabilities: { where: { isApproved: true }, select: { domain: true } },
        complianceDocuments: { where: { status: 'PENDING' }, select: { id: true } },
      },
      orderBy: { legalName: 'asc' },
    }),
  ));
  if ('response' in run) return run.response;

  const partners = run.value.map(({ _count, capabilities, complianceDocuments, ...p }) => ({
    ...p,
    memberCount: _count.users,
    approvedDomains: [...new Set(capabilities.map((c) => c.domain))],
    pendingDocuments: complianceDocuments.length,
  }));
  return NextResponse.json({ partners });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  if (!isSuperAdmin(req.headers)) return NextResponse.json({ error: 'Platform administrators only' }, { status: 403 });

  const body = stripTenantOwnershipFields(await req.json().catch(() => ({}))) as Record<string, unknown>;
  const legalName = optionalText(body.legalName);
  const partnerCode = typeof body.partnerCode === 'string' ? body.partnerCode.trim().toUpperCase() : '';
  const primaryContactEmail = optionalText(body.primaryContactEmail)?.toLowerCase();

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

  let run;
  try {
    run = await notProvisionedAware(() => withPlatformAdmin(prisma, (tx) =>
      tx.transportPartner.create({
        data: {
          legalName,
          partnerCode,
          tradeName: optionalText(body.tradeName),
          city: optionalText(body.city, 100),
          primaryContactName: optionalText(body.primaryContactName),
          primaryContactEmail,
          primaryContactPhone: optionalText(body.primaryContactPhone, 40),
        },
        select: { id: true, legalName: true, partnerCode: true },
      }),
    ));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: `Partner code ${partnerCode} is already in use` }, { status: 409 });
    }
    throw err;
  }
  if ('response' in run) return run.response;
  const partner = run.value;

  await logAudit({
    entityType: 'TransportPartner',
    entityId: partner.id,
    action: 'CREATE',
    details: `Created transport partner ${partner.legalName} (${partner.partnerCode})`,
    userId: req.headers.get('x-user-id') ?? undefined,
  });

  return NextResponse.json({ partner }, { status: 201 });
}
