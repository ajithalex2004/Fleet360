export const dynamic = 'force-dynamic';

/**
 * GET /api/logistics/rfqs/[id]/bids
 *
 * Lists the carrier bids on one RFQ, cheapest first (the comparison view the
 * marketplace page renders before awarding). Merges canonical Exchange
 * `PartnerQuote` rows via `FreightRfqCanonicalBridge.mergeCanonicalQuotesIntoFreightBids` (ARCH-4).
 *
 * Auth: tenant operator session; tenantId from the x-tenant-id header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { listCarrierBids } from '@/lib/logistics/domain';
import { FreightRfqCanonicalBridge } from '@/lib/exchange/freight-rfq-bridge';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const { tenantId } = authz;

  try {
    const legacyBids = await listCarrierBids({ tenantId, rfqId: params.id, limit: 200 });
    const data = await FreightRfqCanonicalBridge.mergeCanonicalQuotesIntoFreightBids({
      tenantId,
      rfqId: params.id,
      legacyBids: Array.isArray(legacyBids) ? (legacyBids as Record<string, unknown>[]) : [],
    });
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'private, max-age=10' } });
  } catch (e) {
    console.error('[logistics/rfqs/:id/bids GET]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to list bids' },
      { status: 500 },
    );
  }
}
