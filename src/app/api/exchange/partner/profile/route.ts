export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { runAsTenant } from '@/lib/rls-scope';
import { PartnerService } from '@/lib/exchange/partner-service';
import {
  exchangeNotProvisionedResponse,
  isExchangeNotProvisioned,
  partnerAuthFailure,
  PROFILE_ROLES,
  requirePartnerContext,
  resolvePartnerViewer,
} from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/partner/profile?partnerId=...
 *   A partner member gets its own partner's profile. Buyer staff (the
 *   outsourcing partner directory) get a partner in their tenant's partner
 *   network, the first one when none is named.
 * PUT /api/exchange/partner/profile
 *   A PARTNER_ADMIN updates its own partner's company details.
 *
 * Both used to take partnerId from the request (GET fell back to the first
 * partner in the database), so anyone signed in could read or edit any
 * partner.
 */

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  try {
    const viewer = await resolvePartnerViewer(req, authz.tenantId);
    if (!viewer.ok) return partnerAuthFailure(viewer);
    if (!viewer.partnerId) return NextResponse.json({ partner: null });

    // Partner master data is platform-level; access was decided above.
    const partner = await runAsTenant('*', () => PartnerService.getPartnerProfile(viewer.partnerId as string));
    if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 });

    return NextResponse.json({ partner });
  } catch (err) {
    if (isExchangeNotProvisioned(err)) return exchangeNotProvisionedResponse();
    console.error('[exchange/partner/profile GET]', err);
    return NextResponse.json({ error: 'Failed to load partner profile' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req, { roles: PROFILE_ROLES });
  if (!auth.ok) return partnerAuthFailure(auth);

  try {
    const rawBody = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(rawBody);
    const { legalName, tradeName, address, city, primaryContactName, primaryContactEmail, primaryContactPhone } = body;

    const updated = await withPlatformAdmin(prisma, (tx) =>
      tx.transportPartner.update({
        where: { id: auth.ctx.partnerId },
        data: {
          legalName,
          tradeName,
          address,
          city,
          primaryContactName,
          primaryContactEmail,
          primaryContactPhone,
          updatedAt: new Date(),
        },
      }),
    );

    return NextResponse.json({ ok: true, partner: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update partner' }, { status: 500 });
  }
}
