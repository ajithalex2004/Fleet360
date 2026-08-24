/**
 * POST /api/logistics/rfqs/[id]/award
 *
 * Awards a carrier bid on an RFQ: marks the winning bid AWARDED (others
 * REJECTED), sets the shipment's carrier + rate, flips the RFQ to AWARDED, and
 * creates the carrier assignment — all inside domain.awardCarrierBid's
 * transaction (which also touches the shared Finance tables, so this write path
 * stays in Next.js/Prisma by design).
 *
 * Body: { bidId (required), vehicleId?, driverId?, overrideCompliance?, overrideReason?, notes? }
 *
 * Compliance: carrier/vehicle/driver compliance is enforced server-side. When it
 * blocks the award we return 409 with the structured blockers so the UI can list
 * them. overrideCompliance only takes effect for a SUPER_ADMIN actor (enforced in
 * the domain layer).
 *
 * Auth: tenantId / actor identity come from the middleware-set x-tenant-id /
 * x-user-id / x-user-role headers, never the body.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { awardCarrierBid } from '@/lib/logistics/domain';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

interface AwardBody {
  bidId?: string;
  vehicleId?: string | null;
  driverId?: string | null;
  dryRun?: boolean;
  overrideCompliance?: boolean;
  overrideReason?: string | null;
  notes?: string | null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;
  const actorUserId = req.headers.get('x-user-id');
  const actorRole = req.headers.get('x-user-role');

  let body: AwardBody;
  try { body = (await req.json()) as AwardBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.bidId) {
    return NextResponse.json({ error: 'bidId is required' }, { status: 400 });
  }

  try {
    const result = await awardCarrierBid({
      tenantId,
      rfqId: params.id,
      bidId: body.bidId,
      vehicleId: body.vehicleId ?? null,
      driverId: body.driverId ?? null,
      dryRun: Boolean(body.dryRun),
      overrideCompliance: Boolean(body.overrideCompliance),
      overrideReason: body.overrideReason ?? null,
      notes: body.notes ?? null,
      actorUserId,
      actorRole,
    });
    return NextResponse.json(result);
  } catch (e) {
    const err = e as Error & { code?: string; blockers?: unknown };
    const message = err?.message ?? 'award failed';
    // Compliance blockers → 409 with the structured list; not-found → 404.
    if (Array.isArray(err?.blockers)) {
      return NextResponse.json({ error: message, blockers: err.blockers }, { status: 409 });
    }
    const status = /not found/i.test(message) ? 404 : 500;
    console.error('[logistics/rfqs/:id/award POST]', e);
    return NextResponse.json({ error: message }, { status });
  }
}
