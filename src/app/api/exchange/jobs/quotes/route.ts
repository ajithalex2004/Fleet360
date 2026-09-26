export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { OutsourceEngine } from '@/lib/exchange/outsource-engine';
import {
  checkQuoteEligibility,
  partnerAuthFailure,
  QUOTING_ROLES,
  requirePartnerContext,
} from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * GET  /api/exchange/jobs/quotes — the signed-in partner's own quotes
 * POST /api/exchange/jobs/quotes — submit or revise a quote as that partner
 *
 * The partner is resolved from the caller's partner_users membership; a
 * partnerId in the body is ignored. (Both used to take partnerId from the
 * request: GET without one listed every partner's quotes, and POST let any
 * signed-in user quote as any partner.)
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req);
  if (!auth.ok) return partnerAuthFailure(auth);

  // The quoted requests belong to other tenants (the buyers), so this reads
  // in platform context, limited to the verified partner's own quotes.
  const quotes = await withPlatformAdmin(prisma, (tx) =>
    tx.partnerQuote.findMany({
      where: { partnerId: auth.ctx.partnerId },
      include: {
        request: {
          select: { id: true, requestNumber: true, serviceDate: true, pickupTime: true, status: true, domain: true },
        },
        partner: { select: { id: true, legalName: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  );

  return NextResponse.json({ quotes });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req, { roles: QUOTING_ROLES });
  if (!auth.ok) return partnerAuthFailure(auth);
  const { partnerId, userId } = auth.ctx;

  try {
    const body = await req.json().catch(() => ({}));
    const { requestId, amount, vatAmount, currency, validHours, proposedVehicleId, proposedDriverId, notes } = body;

    if (!requestId || amount == null || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return NextResponse.json({ error: 'requestId and a positive amount are required' }, { status: 400 });
    }

    const eligibility = await checkQuoteEligibility(partnerId, String(requestId));
    if (!eligibility.ok) {
      return NextResponse.json({ error: eligibility.error }, { status: eligibility.status });
    }

    // The request, its invite and the buyer's alert live in the buyer's
    // tenant; run the engine there so RLS lets it read and update them.
    const quote = await withTenantRls(prisma, eligibility.tenantId, () =>
      OutsourceEngine.submitOrReviseQuote({
        requestId: String(requestId),
        partnerId,
        amount: Number(amount),
        vatAmount: vatAmount != null ? Number(vatAmount) : undefined,
        currency,
        validHours: validHours ? Number(validHours) : undefined,
        proposedVehicleId,
        proposedDriverId,
        notes,
        actorUserId: userId,
      }),
    );

    // The engine's result carries the full request row (buyer tenant, exact
    // addresses); a partner only gets its own quote back before award.
    const { id, revisionNo, amount: subtotal, vatAmount: vat, totalAmount, currency: cur, validUntil, status } = quote;
    return NextResponse.json({
      ok: true,
      quote: { id, requestId: String(requestId), revisionNo, amount: subtotal, vatAmount: vat, totalAmount, currency: cur, validUntil, status },
    });
  } catch (err) {
    console.error('[exchange/jobs/quotes POST]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to submit quote' }, { status: 500 });
  }
}
