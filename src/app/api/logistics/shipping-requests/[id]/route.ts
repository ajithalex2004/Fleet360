/**
 * /api/logistics/shipping-requests/[id]
 *
 *   GET   one shipping request (with shipper name)
 *   PATCH advance the review status (UNDER_REVIEW / ACCEPTED / REJECTED /
 *         CANCELLED) with an optional review note. Conversion is a separate
 *         endpoint (./convert) because it creates a shipment order.
 *
 * Auth: tenant operator session; tenantId / actor from x-tenant-id / x-user-id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getShippingRequest, updateShippingRequestStatus, LogisticsValidationError } from '@/lib/logistics/domain';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const request = await getShippingRequest({ tenantId, requestId: params.id });
    if (!request) return NextResponse.json({ error: 'Shipping request not found' }, { status: 404 });
    return NextResponse.json({ data: request }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[logistics/shipping-requests/:id GET]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load shipping request' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const actorUserId = req.headers.get('x-user-id');

  let body: { status?: string; reviewNotes?: string | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.status) {
    return NextResponse.json({ error: 'status is required' }, { status: 400 });
  }

  try {
    const request = await updateShippingRequestStatus({
      tenantId,
      requestId: params.id,
      status: body.status,
      reviewNotes: body.reviewNotes ?? null,
      actorUserId,
    });
    return NextResponse.json({ data: request });
  } catch (e) {
    if (e instanceof LogisticsValidationError) {
      return NextResponse.json({ error: e.message, issues: e.issues }, { status: 422 });
    }
    const msg = e instanceof Error ? e.message : 'failed to update shipping request';
    const status = msg.includes('not found') ? 404 : 500;
    if (status === 500) console.error('[logistics/shipping-requests/:id PATCH]', e);
    return NextResponse.json({ error: msg }, { status });
  }
}
