export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { MarketplaceService } from '@/lib/exchange/marketplace-service';
import {
  exchangeNotProvisionedResponse,
  isExchangeNotProvisioned,
  partnerAuthFailure,
  requirePartnerContext,
} from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/marketplace
 * Open marketplace opportunities for the signed-in partner user's partner.
 *
 * The partner comes from the caller's partner_users membership. A partnerId
 * in the header or query only chooses among the caller's own memberships.
 * (It used to be trusted as given, with a fallback to the first approved
 * partner, so anyone signed in could browse as any partner.)
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req);
  if (!auth.ok) return partnerAuthFailure(auth);

  try {
    const res = await MarketplaceService.listOpportunitiesForPartner(auth.ctx.partnerId);
    return NextResponse.json({ ...res, partner: { partnerId: auth.ctx.partnerId, legalName: auth.ctx.legalName } });
  } catch (err) {
    if (isExchangeNotProvisioned(err)) return exchangeNotProvisionedResponse();
    console.error('[exchange/marketplace GET]', err);
    return NextResponse.json({ error: 'Failed to fetch marketplace opportunities' }, { status: 500 });
  }
}
