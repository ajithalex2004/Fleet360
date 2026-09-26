export const dynamic = 'force-dynamic';

import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { PdfDocumentService } from '@/lib/exchange/pdf-service';
import { canSeePartnerRecord } from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/pod/[assignmentId]/pdf
 * Stream official Proof of Delivery (POD) / Completion Certificate PDF
 *
 * For the assignment's partner (its members) and the award's buying tenant
 * (that tenant's staff) only. An unknown assignment is a 404: this used to
 * render a complete POD certificate from made-up placeholder values (driver,
 * plate, locations, signature checksum) for any id, for anyone signed in.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  if (!authz.userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  try {
    const { assignmentId } = await params;

    // The award belongs to the buying tenant, which may not be the caller's
    // (a partner user's): load in platform context, then decide access below.
    const assignment = await withPlatformAdmin(prisma, (tx) =>
      tx.partnerAssignment.findUnique({
        where: { id: assignmentId },
        include: { pod: true, award: { include: { request: true } } },
      }),
    );

    if (
      !assignment ||
      !(await canSeePartnerRecord(
        { userId: authz.userId, tenantId: authz.tenantId },
        { partnerId: assignment.partnerId, tenantId: assignment.award.tenantId },
      ))
    ) {
      return NextResponse.json({ error: 'Proof of delivery not found' }, { status: 404 });
    }
    if (!assignment.completedAt) {
      return NextResponse.json({ error: 'This trip has not been completed yet' }, { status: 409 });
    }

    const { award, pod } = assignment;
    const tripNumber = award.request.requestNumber;
    const pdfBytes = PdfDocumentService.generatePodReceiptPdf({
      tripNumber,
      domain: award.request.domain,
      vehiclePlate: assignment.vehiclePlate ?? '',
      driverName: assignment.driverName ?? '',
      driverPhone: assignment.driverPhone ?? undefined,
      pickupLocation: award.request.pickupLocation,
      dropoffLocation: award.request.dropoffLocation,
      completedAt: assignment.completedAt.toISOString(),
      recipientName: pod?.signedByName ?? '',
      passengerOrPackageCount: pod?.passengerCount ?? '',
      notes: pod?.completionNotes ?? undefined,
      hasSignature: !!pod?.signatureUrl,
      signatureChecksum: pod?.signatureUrl
        ? `SHA256:${createHash('sha256').update(pod.signatureUrl).digest('hex')}`
        : 'none',
    });

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="pod-receipt-${tripNumber}.pdf"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate POD PDF' },
      { status: 500 }
    );
  }
}
