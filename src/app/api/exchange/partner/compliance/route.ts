export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { COMPLIANCE_CATALOG } from '@/lib/exchange/partner-activation';
import { complianceFileProblem, ComplianceFileRejected, storeComplianceFile } from '@/lib/exchange/compliance-files';
import { OPERATIONS_ROLES, partnerAuthFailure, requirePartnerContext } from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * GET  /api/exchange/partner/compliance — the signed-in partner's compliance documents
 * POST /api/exchange/partner/compliance — upload a document for that partner:
 *      multipart form { file, docType, docNumber?, expiryDate? (YYYY-MM-DD) }.
 *      docType is one of COMPLIANCE_CATALOG (partner-activation.ts); the
 *      document waits (PENDING) for the onboarding tenant's review.
 *
 * Partners still Pending Activation may use both: uploading these documents
 * is how they get activated.
 *
 * The partner comes from the caller's partner_users membership. (It used to
 * come from ?partnerId= / the body; without one GET listed every partner's
 * documents.)
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req, { allowPending: true });
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

  // The stored path stays internal; files open through .../compliance/:docId/file.
  return NextResponse.json({
    documents: documents.map(({ fileUrl, ...d }) => ({ ...d, hasFile: fileUrl.startsWith('/uploads/exchange/partner-compliance/') })),
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req, { roles: OPERATIONS_ROLES, allowPending: true });
  if (!auth.ok) return partnerAuthFailure(auth);
  const { partnerId } = auth.ctx;

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: 'Attach the document file (multipart form field "file").' }, { status: 400 });
  }
  const field = (name: string) => {
    const v = form.get(name);
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  const docType = field('docType') ?? '';
  const docNumber = field('docNumber')?.slice(0, 100);
  const expiryDate = field('expiryDate');

  const type = COMPLIANCE_CATALOG[docType];
  if (!type) {
    return NextResponse.json({ error: `docType must be one of ${Object.keys(COMPLIANCE_CATALOG).join(', ')}` }, { status: 400 });
  }
  if (type.numbered && !docNumber) {
    return NextResponse.json({ error: `Enter the ${type.label.toLowerCase()} number.` }, { status: 400 });
  }
  let expiry: Date | null = null;
  if (expiryDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate) || Number.isNaN(Date.parse(expiryDate))) {
      return NextResponse.json({ error: 'expiryDate must be a date (YYYY-MM-DD).' }, { status: 400 });
    }
    expiry = new Date(`${expiryDate}T00:00:00Z`);
  }
  if (type.expires) {
    if (!expiry) return NextResponse.json({ error: `Enter the ${type.label.toLowerCase()} expiry date.` }, { status: 400 });
    if (expiry.getTime() < Date.now()) {
      return NextResponse.json({ error: `This ${type.label.toLowerCase()} has already expired; upload a current one.` }, { status: 400 });
    }
  }
  const problem = complianceFileProblem(file);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  let fileUrl: string;
  try {
    fileUrl = await storeComplianceFile(partnerId, file);
  } catch (err) {
    if (err instanceof ComplianceFileRejected) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
  const document = await withPlatformAdmin(prisma, (tx) =>
    tx.partnerComplianceDoc.create({
      data: { partnerId, docType, docNumber: docNumber ?? null, fileUrl, expiryDate: expiry, status: 'PENDING' },
      select: { id: true, docType: true, docNumber: true, expiryDate: true, status: true, createdAt: true },
    }),
  );

  await logAudit({
    entityType: 'PartnerComplianceDoc',
    entityId: document.id,
    action: 'CREATE',
    details: `${auth.ctx.legalName} uploaded ${type.label}${docNumber ? ` (${docNumber})` : ''}`,
    userId: auth.ctx.userId,
  });

  return NextResponse.json({ ok: true, document }, { status: 201 });
}
