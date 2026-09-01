export const dynamic = 'force-dynamic';

/**
 * /api/bus-ops/adhoc-requests/[id]/fulfill
 *
 * POST - Fulfills an adhoc transport request using chosen candidate tier
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  fulfillAdhocRequest,
  type FulfillmentCandidate,
} from '@/lib/bus-ops/adhoc-dispatch';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const { tenantId, user } = authz;
  const { id: requestId } = await context.params;

  const rawBody = await req.json().catch(() => ({}));
  const body = stripTenantOwnershipFields(rawBody);

  const candidate = body.candidate as FulfillmentCandidate | undefined;

  if (!candidate || !candidate.tier) {
    return NextResponse.json(
      { error: 'Fulfillment candidate object with tier is required' },
      { status: 400 },
    );
  }

  try {
    const result = await fulfillAdhocRequest(
      tenantId,
      requestId,
      candidate,
      user?.name || user?.email || 'Dispatcher',
    );

    return NextResponse.json({
      ok: true,
      message: `Ad-hoc request ${result.request.requestNo} fulfilled via ${candidate.title}`,
      ...result,
    });
  } catch (err) {
    console.error('[api/bus-ops/adhoc-requests/[id]/fulfill POST]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fulfill adhoc request' },
      { status: 500 },
    );
  }
}
