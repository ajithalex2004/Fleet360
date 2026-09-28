export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { findReviewablePartner, reviewerScope } from '@/lib/exchange/onboarding-review';
import { complianceFileResponse } from '@/lib/exchange/compliance-files';

export const runtime = 'nodejs';

/**
 * GET /api/admin/exchange/onboarding/:id/documents/:docId/file
 *
 * The file of a partner's compliance document, for the administrators
 * reviewing the partner.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string; docId: string }> }) {
  const { id: partnerId, docId } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const reviewer = reviewerScope(req.headers, authz.tenantId);
  if (!reviewer.ok) return reviewer.response;
  const { scope } = reviewer;

  const doc = await withPlatformAdmin(prisma, async (tx) => {
    if (!(await findReviewablePartner(tx, scope, partnerId))) return null;
    return tx.partnerComplianceDoc.findFirst({ where: { id: docId, partnerId }, select: { fileUrl: true } });
  });
  if (!doc) return NextResponse.json({ error: 'Compliance document not found' }, { status: 404 });
  return complianceFileResponse(partnerId, doc.fileUrl, {
    userId: req.headers.get('x-user-id') ?? 'unknown', tenantId: authz.tenantId, docId, as: 'reviewer',
  });
}
