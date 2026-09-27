export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { partnerAuthFailure, requirePartnerContext } from '@/lib/exchange/partner-auth';
import { complianceFileResponse } from '@/lib/exchange/compliance-files';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/partner/compliance/:docId/file
 *
 * The file of one of the signed-in partner's own compliance documents.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ docId: string }> }) {
  const { docId } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req, { allowPending: true });
  if (!auth.ok) return partnerAuthFailure(auth);

  const doc = await withPlatformAdmin(prisma, (tx) =>
    tx.partnerComplianceDoc.findFirst({ where: { id: docId, partnerId: auth.ctx.partnerId }, select: { fileUrl: true } }),
  );
  if (!doc) return NextResponse.json({ error: 'Compliance document not found' }, { status: 404 });
  return complianceFileResponse(auth.ctx.partnerId, doc.fileUrl);
}
