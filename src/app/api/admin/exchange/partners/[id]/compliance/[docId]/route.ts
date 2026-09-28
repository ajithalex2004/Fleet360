export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { isSuperAdmin } from '@/lib/admin-access';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { notProvisionedAware } from '@/lib/exchange/partner-auth';
import { withAuditedAction } from '@/lib/audited-action';

export const runtime = 'nodejs';

/**
 * PATCH /api/admin/exchange/partners/:id/compliance/:docId
 *   { decision: 'APPROVE' | 'REJECT', note? }
 *
 * Approves (status VALID) or rejects (status REJECTED) a partner's uploaded
 * compliance document. A rejection needs a note, which the partner sees in
 * its Compliance Vault. Platform administrators only (ADMIN_ROUTE_POLICY).
 */
async function handlePATCH(req: NextRequest, props: { params: Promise<{ id: string; docId: string }> }) {
  const { id: partnerId, docId } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  if (!isSuperAdmin(req.headers)) return NextResponse.json({ error: 'Platform administrators only' }, { status: 403 });
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
  const status = decision === 'APPROVE' ? 'VALID' : 'REJECTED';

  const run = await notProvisionedAware(() => withPlatformAdmin(prisma, async (tx) => {
    const doc = await tx.partnerComplianceDoc.findFirst({
      where: { id: docId, partnerId },
      select: { id: true, docType: true, partner: { select: { legalName: true } } },
    });
    if (!doc) return null;
    const updated = await tx.partnerComplianceDoc.update({
      where: { id: docId },
      data: { status, reviewNote: note, reviewedAt: new Date(), reviewedBy: reviewerId ?? null },
      select: { id: true, docType: true, status: true, reviewNote: true, reviewedAt: true },
    });
    return { doc, updated };
  }));
  if ('response' in run) return run.response;
  if (!run.value) return NextResponse.json({ error: 'Compliance document not found' }, { status: 404 });
  const { doc, updated } = run.value;

  await logAudit({
    entityType: 'PartnerComplianceDoc',
    entityId: doc.id,
    action: 'UPDATE',
    details: `${decision === 'APPROVE' ? 'Approved' : 'Rejected'} ${doc.docType} for ${doc.partner.legalName}${note ? `: ${note}` : ''}`,
    userId: reviewerId,
  });

  return NextResponse.json({ document: updated });
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PATCH = withAuditedAction(handlePATCH);
