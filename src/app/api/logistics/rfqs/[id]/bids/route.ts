/**
 * GET /api/logistics/rfqs/[id]/bids
 *
 * Lists the carrier bids on one RFQ, cheapest first (the comparison view the
 * marketplace page renders before awarding). Thin wrapper over
 * domain.listCarrierBids scoped to the RFQ.
 *
 * Auth: tenant operator session; tenantId from the x-tenant-id header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { listCarrierBids } from '@/lib/logistics/domain';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });
  }

  try {
    const data = await listCarrierBids({ tenantId, rfqId: params.id, limit: 200 });
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'private, max-age=10' } });
  } catch (e) {
    console.error('[logistics/rfqs/:id/bids GET]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to list bids' },
      { status: 500 },
    );
  }
}
