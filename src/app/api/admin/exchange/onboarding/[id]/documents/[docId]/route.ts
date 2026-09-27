export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { notProvisionedAware } from '@/lib/exchange/partner-auth';
import { COMPLIANCE_CATALOG } from '@/lib/exchange/partner-activation';
import { findReviewablePartner, reviewerScope } from '@/lib/exchange/onboarding-review';

export const runtime = 'nodejs';

/**
 * PATCH /api/admin/exchange/onboarding/:id/documents/:docId
 *   { decision: 'APPROVE' | 'REJECT', note? }
 *
 * The onboarding tenant's administrator approves (VALID) or rejects
 * (REJECTED, with a note the partner sees) one compliance document.
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string; docId: string }> }) {
  const { id: partnerId, docId } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const reviewer = reviewerScope(req.headers, authz.tenantId);
  if (!reviewer.ok) return reviewer.response;
  const { scope } = reviewer;
  const reviewerId = req.headers.get('x-user-id') ?? undefined;

  const body = stripTenantOwnershipFields(await req.json().catch(() => ({}))) as Record<string, unknown>;
  const decision = body.decision;
  if (decision !== 'APPROVE' && decision !== 'REJECT') {
    return NextResponse.json({ error: 'decision must be APPROVE or REJECT' }, { status: 400 });
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  if (decision === 'REJECT' && !note) {
    return NextResponse.json({ error: 'A rejection needs a note for the partner' }, { status: 400 });
  }

  const run = await notProvisionedAware(() => withPlatformAdmin(prisma, async (tx) => {
    const partner = await findReviewablePartner(tx, scope, partnerId);
    if (!partner) return null;
    const doc = await tx.partnerComplianceDoc.findFirst({ where: { id: docId, partnerId }, select: { id: true, docType: true } });
    if (!doc) return null;
    const document = await tx.partnerComplianceDoc.update({
      where: { id: docId },
      data: {
        status: decision === 'APPROVE' ? 'VALID' : 'REJECTED',
        reviewNote: note,
        reviewedAt: new Date(),
        reviewedBy: reviewerId ?? null,
      },
      select: { id: true, docType: true, status: true, reviewNote: true, reviewedAt: true },
    });
    return { partner, document };
  }));
  if ('response' in run) return run.response;
  if (!run.value) return NextResponse.json({ error: 'Compliance document not found' }, { status: 404 });
  const { partner, document } = run.value;

  await logAudit({
    tenantId: partner.onboardedByTenantId ?? undefined,
    entityType: 'PartnerComplianceDoc',
    entityId: document.id,
    action: 'UPDATE',
    details: `${decision === 'APPROVE' ? 'Approved' : 'Rejected'} ${COMPLIANCE_CATALOG[document.docType]?.label ?? document.docType} for ${partner.legalName}${note ? `: ${note}` : ''}`,
    userId: reviewerId,
  });

  return NextResponse.json({ document });
}
