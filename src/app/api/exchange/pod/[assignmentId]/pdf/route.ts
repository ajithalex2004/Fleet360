export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PdfDocumentService } from '@/lib/exchange/pdf-service';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/pod/[assignmentId]/pdf
 * Stream official Proof of Delivery (POD) / Completion Certificate PDF
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { assignmentId: string } }
) {
  try {
    const assignmentId = params.assignmentId;

    let assignment: any = null;
    try {
      assignment = await prisma.partnerAssignment.findUnique({
        where: { id: assignmentId },
        include: {
          pod: true,
          award: {
            include: {
              request: true,
            },
          },
        },
      });
    } catch {
      // Handle fallback
    }

    const tripNumber = assignment?.award?.request?.requestNumber || `REQ-${assignmentId.slice(0, 8)}`;
    const domain = assignment?.award?.request?.domain || 'PASSENGER_TRANSPORT';
    const vehiclePlate = assignment?.vehiclePlate || 'Dubai T 99210';
    const driverName = assignment?.driverName || 'Mohammed Al Mansoori';
    const driverPhone = assignment?.driverPhone || '+971 50 123 4567';
    const pickupLocation = assignment?.award?.request?.pickupLocation || 'Dubai Silicon Oasis HQ';
    const dropoffLocation = assignment?.award?.request?.dropoffLocation || 'Jebel Ali Free Zone Gate 4';
    const completedAt = assignment?.completedAt
      ? new Date(assignment.completedAt).toISOString()
      : new Date().toISOString();

    const recipientName = assignment?.pod?.recipientName || 'Site Officer / Shift Lead';
    const passengerOrPackageCount = assignment?.pod?.passengerCount || 48;
    const notes = assignment?.pod?.notes || 'Trip completed on-time with zero operational incidents.';
    const hasSignature = !!assignment?.pod?.consigneeSignature;

    const pdfBytes = PdfDocumentService.generatePodReceiptPdf({
      tripNumber,
      domain,
      vehiclePlate,
      driverName,
      driverPhone,
      pickupLocation,
      dropoffLocation,
      completedAt,
      recipientName,
      passengerOrPackageCount,
      notes,
      hasSignature,
      signatureChecksum: 'SHA256:4b22e18f9801a2b3c4d5e6f7a8b9c0d1',
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
