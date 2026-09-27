export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { notProvisionedAware } from '@/lib/exchange/partner-auth';
import { loadOnboardingState } from '@/lib/exchange/onboarding-state';
import { findReviewablePartner, reviewerScope } from '@/lib/exchange/onboarding-review';

export const runtime = 'nodejs';

/**
 * GET /api/admin/exchange/onboarding/:id
 *
 * One partner's application: company details, service areas, emirate, its
 * compliance documents and the mandatory-document checklist. For the
 * onboarding tenant's administrators (and platform administrators).
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const reviewer = reviewerScope(req.headers, authz.tenantId);
  if (!reviewer.ok) return reviewer.response;
  const { scope } = reviewer;

  const run = await notProvisionedAware(() => withPlatformAdmin(prisma, async (tx) => {
    if (!(await findReviewablePartner(tx, scope, id))) return null;
    return loadOnboardingState(tx, id);
  }));
  if ('response' in run) return run.response;
  if (!run.value) return NextResponse.json({ error: 'Transport partner not found' }, { status: 404 });
  return NextResponse.json(run.value);
}
