export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { notProvisionedAware, partnerAuthFailure, PROFILE_ROLES, requirePartnerContext } from '@/lib/exchange/partner-auth';
import { loadOnboardingState } from '@/lib/exchange/onboarding-state';
import { SUBMITTABLE_STATUSES } from '@/lib/exchange/partner-activation';
import { notify, tenantAdminEmails } from '@/lib/exchange/onboarding-review';

export const runtime = 'nodejs';

/**
 * POST /api/exchange/partner/onboarding/submit
 *
 * The partner's administrator submits its compliance documents for the
 * onboarding tenant's review: from DRAFT (Pending Activation) or
 * MORE_INFO_REQUIRED to UNDER_REVIEW, once every mandatory document has been
 * uploaded and none is rejected or expired. The tenant's administrators are
 * emailed.
 */
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req, { roles: PROFILE_ROLES, allowPending: true });
  if (!auth.ok) return partnerAuthFailure(auth);
  const { partnerId } = auth.ctx;

  const run = await notProvisionedAware(() => withPlatformAdmin(prisma, async (tx) => {
    const state = await loadOnboardingState(tx, partnerId);
    if (!state) return { status: 404 as const, error: 'Transport partner not found' };
    const { partner, checklist } = state;
    if (!SUBMITTABLE_STATUSES.includes(partner.onboardingStatus)) {
      return { status: 409 as const, error: `Your application is ${partner.onboardingLabel.toLowerCase()}; there is nothing to submit.` };
    }
    if (!checklist.complete) {
      return { status: 400 as const, error: `Upload these documents first: ${checklist.missing.join(', ')}.` };
    }
    await tx.transportPartner.update({
      where: { id: partnerId },
      data: { onboardingStatus: 'UNDER_REVIEW', marketplaceStatus: 'UNDER_REVIEW' },
    });
    const reviewers = partner.onboardedByTenantId ? await tenantAdminEmails(tx, partner.onboardedByTenantId) : [];
    return { status: 200 as const, onboardedByTenantId: partner.onboardedByTenantId, reviewers };
  }));
  if ('response' in run) return run.response;
  const result = run.value;
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  await logAudit({
    tenantId: result.onboardedByTenantId ?? undefined,
    entityType: 'TransportPartner',
    entityId: partnerId,
    action: 'UPDATE',
    details: `${auth.ctx.legalName} submitted its compliance documents for activation review`,
    userId: auth.ctx.userId,
  });

  await notify(result.reviewers, `${auth.ctx.legalName} submitted its documents for activation`, [
    `${auth.ctx.legalName} has uploaded its compliance documents and is waiting for your review.`,
    'Review and activate it under Admin → Partner onboarding:',
    `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/admin/partner-onboarding`,
  ]);

  return NextResponse.json({ ok: true, onboardingStatus: 'UNDER_REVIEW' });
}
