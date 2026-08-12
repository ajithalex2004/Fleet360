/**
 * POST /api/logistics/shipping-requests/[id]/convert
 *
 * Convert an accepted shipping request into a shipment order (the "job order").
 * Default policy: the order is created PRIVATE / DRAFT — the operator decides
 * separately whether to post it to the marketplace (RFQ) or assign it directly.
 * Cargo-owner identity is stamped from the onboarded shipper, so the order links
 * back via cargo_owner_customer_id. The request flips to CONVERTED and records
 * the new shipment_order_id.
 *
 * Auth: tenant operator session; tenantId / actor from x-tenant-id / x-user-id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { convertShippingRequest, LogisticsValidationError } from '@/lib/logistics/domain';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const actorUserId = req.headers.get('x-user-id');

  try {
    const result = await convertShippingRequest({ tenantId, requestId: params.id, actorUserId });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (e) {
    if (e instanceof LogisticsValidationError) {
      return NextResponse.json({ error: e.message, issues: e.issues }, { status: 422 });
    }
    const msg = e instanceof Error ? e.message : 'failed to convert shipping request';
    const status = msg.includes('not found') ? 404 : 500;
    if (status === 500) console.error('[logistics/shipping-requests/:id/convert POST]', e);
    return NextResponse.json({ error: msg }, { status });
  }
}
