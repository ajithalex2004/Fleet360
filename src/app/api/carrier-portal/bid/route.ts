/**
 * POST /api/carrier-portal/bid
 *
 * Submits (or re-submits) a carrier's bid on the RFQ behind their invite token.
 * The token authenticates the carrier: we resolve it to (tenantId, carrierId,
 * shipmentOrderId, rfqId) and pass those to domain.submitCarrierBid — the
 * carrier can only bid on the load they were invited to, never an arbitrary one.
 * submitCarrierBid enforces the shipment governance + the customer's
 * bid-submission policy and rejects a closed/awarded RFQ.
 *
 * Body: { token, amount, currency?, transitTimeHours?, validityUntil?, notes? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveCarrierPortalInvite, submitCarrierBid } from '@/lib/logistics/domain';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

interface BidBody {
  token?: string;
  amount?: number | string;
  currency?: string | null;
  transitTimeHours?: number | string | null;
  validityUntil?: string | null;
  notes?: string | null;
}

export async function POST(req: NextRequest) {
  let body: BidBody;
  try { body = (await req.json()) as BidBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const token = String(body.token ?? '').trim();
  if (!token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'A valid bid amount is required' }, { status: 400 });
  }
  const transit = body.transitTimeHours == null || body.transitTimeHours === ''
    ? null
    : Number(body.transitTimeHours);

  try {
    const context = await resolveCarrierPortalInvite(token);
    if (!context) {
      return NextResponse.json(
        { error: 'This invite link is invalid or has expired.' },
        { status: 404 },
      );
    }
    const bid = await submitCarrierBid({
      tenantId: context.invite.tenantId,
      shipmentOrderId: context.invite.shipmentOrderId,
      rfqId: context.invite.rfqId,
      carrierId: context.invite.carrierId,
      amount,
      currency: body.currency ?? null,
      transitTimeHours: transit != null && Number.isFinite(transit) ? transit : null,
      validityUntil: body.validityUntil ?? null,
      notes: body.notes ?? null,
      status: 'SUBMITTED',
    });
    return NextResponse.json(bid, { status: 201 });
  } catch (e) {
    // Governance / policy / closed-RFQ rejections are caller-fixable → 400.
    console.error('[carrier-portal/bid POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to submit the bid' },
      { status: 400 },
    );
  }
}
