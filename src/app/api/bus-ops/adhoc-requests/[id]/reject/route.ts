export const dynamic = 'force-dynamic';

/**
 * /api/bus-ops/adhoc-requests/[id]/reject
 *
 * POST - Declines an adhoc transport request
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { rejectAdhocRequest } from '@/lib/bus-ops/adhoc-dispatch';

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

  const reason = (body.reason as string) || 'Capacity unavailable';

  try {
    const updated = await rejectAdhocRequest(
      tenantId,
      requestId,
      reason,
      user?.name || user?.email || 'Dispatcher',
    );

    return NextResponse.json({
      ok: true,
      message: `Ad-hoc request ${updated.requestNo} declined`,
      request: updated,
    });
  } catch (err) {
    console.error('[api/bus-ops/adhoc-requests/[id]/reject POST]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to reject adhoc request' },
      { status: 500 },
    );
  }
}
