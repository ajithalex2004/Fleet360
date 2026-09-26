export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { PartnerService } from '@/lib/exchange/partner-service';
import { OPERATIONS_ROLES, partnerAuthFailure, requirePartnerContext } from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * GET  /api/exchange/partner/compliance — the signed-in partner's compliance documents
 * POST /api/exchange/partner/compliance — upload a document for that partner
 *
 * The partner comes from the caller's partner_users membership. (It used to
 * come from ?partnerId= / the body; without one GET listed every partner's
 * documents.)
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req);
  if (!auth.ok) return partnerAuthFailure(auth);

  const documents = await withPlatformAdmin(prisma, (tx) =>
    tx.partnerComplianceDoc.findMany({
      where: { partnerId: auth.ctx.partnerId },
      // Not reviewed_by: the reviewing administrator's user id stays internal.
      select: {
        id: true, createdAt: true, updatedAt: true, partnerId: true, docType: true, docNumber: true,
        fileUrl: true, expiryDate: true, status: true, reviewNote: true, reviewedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  );

  return NextResponse.json({ documents });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req, { roles: OPERATIONS_ROLES });
  if (!auth.ok) return partnerAuthFailure(auth);
  const { partnerId } = auth.ctx;

  try {
    const body = await req.json().catch(() => ({}));
    const { docType, docNumber, fileUrl, expiryDate } = body;

    if (!docType || !fileUrl) {
      return NextResponse.json({ error: 'Missing required compliance document fields' }, { status: 400 });
    }

    const doc = await PartnerService.uploadComplianceDoc({
      partnerId,
      docType,
      docNumber,
      fileUrl,
      expiryDate,
    });

    return NextResponse.json({ ok: true, document: doc });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to upload document' }, { status: 500 });
  }
}
