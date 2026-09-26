export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { runAsTenant } from '@/lib/rls-scope';
import { ScorecardService } from '@/lib/exchange/scorecard-service';
import { partnerAuthFailure, resolvePartnerViewer } from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * GET  /api/exchange/scorecard?partnerId=... — a partner's performance scorecard
 * POST /api/exchange/scorecard { partnerId? } — recalculate it
 *
 * A partner member sees its own partner; buyer staff see partners in their
 * tenant's partner network (the first one when none is named). The partner
 * used to come from the request, with a fallback to the first active partner.
 *
 * A scorecard aggregates a partner's awards, quotes, exceptions and disputes
 * across every buyer, so it is read and computed in platform context once
 * access is decided; it holds aggregates only.
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  try {
    const viewer = await resolvePartnerViewer(req, authz.tenantId);
    if (!viewer.ok) return partnerAuthFailure(viewer);
    if (!viewer.partnerId) return NextResponse.json({ scorecard: null });

    const scorecard = await runAsTenant('*', () => ScorecardService.getPartnerScorecard(viewer.partnerId as string));
    return NextResponse.json({ scorecard });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch partner scorecard' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  try {
    const rawBody = await req.json().catch(() => ({}));
    const requested = typeof rawBody.partnerId === 'string' ? rawBody.partnerId : null;

    const viewer = await resolvePartnerViewer(req, authz.tenantId, { requested });
    if (!viewer.ok) return partnerAuthFailure(viewer);
    if (!viewer.partnerId) return NextResponse.json({ error: 'No transport partner to evaluate' }, { status: 404 });

    const evaluation = await runAsTenant('*', () =>
      ScorecardService.evaluatePartnerScorecard(viewer.partnerId as string),
    );
    return NextResponse.json({ ok: true, evaluation });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to recalculate scorecard' },
      { status: 500 }
    );
  }
}
