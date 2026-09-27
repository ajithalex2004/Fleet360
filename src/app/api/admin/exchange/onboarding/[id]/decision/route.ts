export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { notProvisionedAware } from '@/lib/exchange/partner-auth';
import { loadOnboardingState } from '@/lib/exchange/onboarding-state';
import { findReviewablePartner, notify, partnerMemberEmails, reviewerScope } from '@/lib/exchange/onboarding-review';

export const runtime = 'nodejs';

/**
 * POST /api/admin/exchange/onboarding/:id/decision
 *   { decision: 'ACTIVATE' | 'MORE_INFO' | 'REJECT', note? }
 *
 * The onboarding tenant's administrator decides a partner's application:
 *  - ACTIVATE: every mandatory document approved and in date, and at least
 *    one service area set. The partner becomes active (onboarding APPROVED,
 *    marketplace APPROVED, operational ACTIVE) and joins the tenant's
 *    partner network.
 *  - MORE_INFO: back to the partner with a note (MORE_INFO_REQUIRED); it can
 *    upload again and resubmit.
 *  - REJECT: with a note (REJECTED).
 * The partner's administrators are emailed the outcome.
 */

const DECISIONS = ['ACTIVATE', 'MORE_INFO', 'REJECT'] as const;
type Decision = (typeof DECISIONS)[number];

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: partnerId } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const reviewer = reviewerScope(req.headers, authz.tenantId);
  if (!reviewer.ok) return reviewer.response;
  const { scope } = reviewer;
  const reviewerId = req.headers.get('x-user-id') ?? undefined;

  const body = stripTenantOwnershipFields(await req.json().catch(() => ({}))) as Record<string, unknown>;
  const decision = body.decision as Decision;
  if (!DECISIONS.includes(decision)) {
    return NextResponse.json({ error: `decision must be one of ${DECISIONS.join(', ')}` }, { status: 400 });
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : null;
  if (decision !== 'ACTIVATE' && !note) {
    return NextResponse.json({ error: 'Add a note telling the partner what is needed or why' }, { status: 400 });
  }

  const run = await notProvisionedAware(() => withPlatformAdmin(prisma, async (tx) => {
    const found = await findReviewablePartner(tx, scope, partnerId);
    if (!found) return { status: 404 as const, error: 'Transport partner not found' };
    const state = await loadOnboardingState(tx, partnerId);
    if (!state) return { status: 404 as const, error: 'Transport partner not found' };
    const { partner, checklist } = state;
    if (partner.onboardingStatus === 'APPROVED') {
      return { status: 409 as const, error: `${partner.legalName} is already active` };
    }

    if (decision === 'ACTIVATE') {
      if (partner.domains.length === 0) {
        return { status: 409 as const, error: 'Set the partner\'s service areas before activating it' };
      }
      if (!checklist.allApproved) {
        const open = checklist.items.filter((i) => i.status !== 'VALID' && i.status !== 'EXPIRING').map((i) => i.label);
        return { status: 409 as const, error: `Approve every mandatory document first. Still open: ${open.join(', ')}` };
      }
      await tx.transportPartner.update({
        where: { id: partnerId },
        data: {
          onboardingStatus: 'APPROVED',
          marketplaceStatus: 'APPROVED',
          operationalStatus: 'ACTIVE',
          approvedAt: new Date(),
          approvedBy: reviewerId ?? null,
          rejectionReason: null,
        },
      });
      if (partner.onboardedByTenantId) {
        // Its onboarding tenant's network; a BLOCKED relationship stays blocked.
        await tx.tenantPartnerRelationship.upsert({
          where: { tenantId_partnerId: { tenantId: partner.onboardedByTenantId, partnerId } },
          create: { tenantId: partner.onboardedByTenantId, partnerId, status: 'APPROVED' },
          update: {},
        });
      }
    } else {
      await tx.transportPartner.update({
        where: { id: partnerId },
        data: decision === 'MORE_INFO'
          ? { onboardingStatus: 'MORE_INFO_REQUIRED', marketplaceStatus: 'NOT_APPLIED', rejectionReason: note }
          : { onboardingStatus: 'REJECTED', marketplaceStatus: 'REJECTED', rejectionReason: note },
      });
    }
    const emails = await partnerMemberEmails(tx, partnerId, ['PARTNER_ADMIN']);
    return { status: 200 as const, partner, emails };
  }));
  if ('response' in run) return run.response;
  const result = run.value;
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
  const { partner, emails } = result;

  const outcome = { ACTIVATE: 'Activated', MORE_INFO: 'Asked for more information from', REJECT: 'Rejected' }[decision];
  await logAudit({
    tenantId: partner.onboardedByTenantId ?? undefined,
    entityType: 'TransportPartner',
    entityId: partnerId,
    action: 'UPDATE',
    details: `${outcome} transport partner ${partner.legalName}${note ? `: ${note}` : ''}`,
    userId: reviewerId,
  });

  const portal = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/exchange/compliance`;
  await notify(
    emails,
    decision === 'ACTIVATE'
      ? `${partner.legalName} is now active on Fleet360 Exchange`
      : decision === 'MORE_INFO'
        ? `More information needed for ${partner.legalName}`
        : `${partner.legalName}'s application was not approved`,
    decision === 'ACTIVATE'
      ? [`Your compliance documents were approved and ${partner.legalName} is now active.`, 'You can now see and quote on jobs from your network.', portal]
      : [decision === 'MORE_INFO' ? 'Your reviewer asked for more information:' : 'Your application was not approved:', note ?? '', '', portal],
  );

  return NextResponse.json({ ok: true, decision });
}
