/**
 * POST /api/logistics/rfqs/[id]/broadcast/assign
 *
 * The operator-confirm step: pick one driver who accepted the broadcast and
 * assign the load to them. domain.assignBroadcast marks the winner ASSIGNED, the
 * other accepts SUPERSEDED, sets the shipment carrier + fixed cost +
 * marketplace_status, and writes the carrier assignment (the same write the
 * bid-award path uses). Driver compliance is gated like an award — blocked
 * assignments return 409 with the structured blockers.
 *
 * Body: { offerId (required), overrideCompliance? }
 * Auth: tenant operator session; tenantId / actor from x-tenant-id / x-user-id / x-user-role.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { assignBroadcast } from '@/lib/logistics/domain';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params: _params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;
  const actorUserId = req.headers.get('x-user-id');
  const actorRole = req.headers.get('x-user-role');

  let body: { offerId?: string; overrideCompliance?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.offerId) {
    return NextResponse.json({ error: 'offerId is required' }, { status: 400 });
  }

  try {
    const result = await assignBroadcast({
      tenantId,
      offerId: body.offerId,
      overrideCompliance: Boolean(body.overrideCompliance),
      actorRole,
      actorUserId,
    });
    return NextResponse.json(result);
  } catch (e) {
    const err = e as Error & { blockers?: unknown };
    const message = err?.message ?? 'assign failed';
    if (Array.isArray(err?.blockers)) {
      return NextResponse.json({ error: message, blockers: err.blockers }, { status: 409 });
    }
    console.error('[rfqs/:id/broadcast/assign]', e);
    const status = /not found/i.test(message) ? 404 : /already resolved|accepted/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
