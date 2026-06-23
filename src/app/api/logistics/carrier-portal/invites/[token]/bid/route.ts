import { NextRequest, NextResponse } from 'next/server';
import { resolveCarrierPortalInvite, submitCarrierBid } from '@/lib/logistics/domain';
import { logisticsErrorResponse } from '@/lib/logistics/api-context';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const body = await req.json().catch(() => ({})) as {
      amount?: number;
      currency?: string;
      transitTimeHours?: number | null;
      validityUntil?: string | null;
      notes?: string | null;
    };
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'A positive bid amount is required' }, { status: 400 });
    }

    const resolved = await resolveCarrierPortalInvite(token);
    if (!resolved || !resolved.rfq) {
      return NextResponse.json({ error: 'Invite is invalid, expired, or no longer visible' }, { status: 404 });
    }
    if (resolved.rfq.status !== 'OPEN') {
      return NextResponse.json(
        { error: `RFQ is ${resolved.rfq.status}; bids are not accepted now`, rfq: resolved.rfq },
        { status: 409 },
      );
    }

    const bid = await submitCarrierBid({
      tenantId: resolved.invite.tenantId,
      carrierId: resolved.invite.carrierId,
      rfqId: resolved.invite.rfqId,
      shipmentOrderId: resolved.invite.shipmentOrderId,
      amount,
      currency: body.currency ?? resolved.rfq.shipment?.currency ?? 'AED',
      transitTimeHours: body.transitTimeHours ?? null,
      validityUntil: body.validityUntil ?? null,
      notes: body.notes ?? null,
      status: 'SUBMITTED',
      chargeBreakdown: {
        source: 'carrier-portal-invite',
        inviteId: resolved.invite.id,
      },
    });

    const refreshed = await resolveCarrierPortalInvite(token);
    return NextResponse.json({ bid, ...refreshed }, { status: 201 });
  } catch (error) {
    console.error('[logistics/carrier-portal/invites/[token]/bid POST]', error);
    const message = error instanceof Error ? error.message : 'Failed to submit carrier bid';
    if (message.includes('disabled')) return NextResponse.json({ error: message }, { status: 409 });
    return logisticsErrorResponse(error, 'Failed to submit carrier bid');
  }
}
