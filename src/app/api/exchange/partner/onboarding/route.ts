export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { notProvisionedAware, partnerAuthFailure, requirePartnerContext } from '@/lib/exchange/partner-auth';
import { loadOnboardingState } from '@/lib/exchange/onboarding-state';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/partner/onboarding
 *
 * The signed-in partner's activation stage and the checklist of mandatory
 * compliance documents for its service areas and emirate
 * (src/lib/exchange/partner-activation.ts). Available before activation.
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req, { allowPending: true });
  if (!auth.ok) return partnerAuthFailure(auth);

  const run = await notProvisionedAware(() => withPlatformAdmin(prisma, (tx) => loadOnboardingState(tx, auth.ctx.partnerId)));
  if ('response' in run) return run.response;
  if (!run.value) return NextResponse.json({ error: 'Transport partner not found' }, { status: 404 });

  const { partner, documents, checklist } = run.value;
  return NextResponse.json({
    partner: {
      id: partner.id,
      legalName: partner.legalName,
      emirate: partner.emirate,
      domains: partner.domains,
      onboardingStatus: partner.onboardingStatus,
      onboardingLabel: partner.onboardingLabel,
      // The reviewer's note when more information was asked for or the partner was rejected.
      reviewNote: partner.onboardingStatus === 'MORE_INFO_REQUIRED' || partner.onboardingStatus === 'REJECTED'
        ? partner.rejectionReason : null,
      approvedAt: partner.approvedAt,
    },
    role: auth.ctx.role,
    documents,
    checklist,
  });
}
