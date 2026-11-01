export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  updateDrayageJobExecutionStatus,
  submitJobPodEvidence,
  sendDispatchChatMessage,
  clearPortInspection,
} from '@/lib/logistics/drayage-domain';

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const jobId = params.id;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const rawBody = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(rawBody);
    const action = body.action ? String(body.action) : 'STATUS_UPDATE';

    // 1. In-App Dispatch <-> Driver Chat
    if (action === 'CHAT') {
      const msg = String(body.message ?? '').trim();
      if (!msg) {
        return NextResponse.json({ error: 'Message is required' }, { status: 400 });
      }
      const chatRes = await withTenantRls(prisma, tenantId, async (tx) => {
        return sendDispatchChatMessage(tx, {
          tenantId,
          jobId,
          senderRole: 'DRIVER',
          senderName: String(body.driverName || 'Assigned Driver'),
          message: msg,
          isUrgent: Boolean(body.isUrgent),
        });
      });
      return NextResponse.json({
        success: true,
        id: chatRes.id,
        createdAt: new Date().toISOString(),
      });
    }

    // 2. ISO 6346 Container & Bolt Seal Verification
    if (action === 'SCAN_VERIFY') {
      const scannedContainer = String(body.scannedContainerNumber ?? '').trim().toUpperCase();
      const scannedSeal = String(body.scannedSealNumber ?? '').trim().toUpperCase();
      const scannedEir = String(body.scannedEirNumber ?? '').trim().toUpperCase();
      const scanStage = String(body.scanStage ?? 'CONTAINER_LOADED').trim();
      await withTenantRls(prisma, tenantId, async (tx) => {
        await clearPortInspection(tx, {
          tenantId,
          jobId,
          agency: 'CUSTOMS',
          newSealNumber: scannedSeal || undefined,
          clearedBy: String(body.driverName || 'Driver Gemini Vision OCR Scanner'),
          notes: `Gemini Vision OCR [${scanStage}]: Container (${scannedContainer})${scannedSeal ? `, Customs Seal (${scannedSeal})` : ''}${scannedEir ? `, EIR Gate Slip (${scannedEir})` : ''} verified via Driver Mobile App`,
          actor: String(body.driverName || 'Driver Mobile App'),
        });
      });
      return NextResponse.json({
        success: true,
        jobId,
        scannedContainerNumber: scannedContainer,
        scannedSealNumber: scannedSeal,
        scannedEirNumber: scannedEir,
        scanStage,
        verifiedAt: new Date().toISOString(),
      });
    }

    // 3. Sign-on-Glass ePOD Signature Submission
    if (action === 'EPOD_SIGN') {
      const receiverName = String(body.receiverName ?? 'Warehouse Dock Supervisor').trim();
      const rampBayNumber = body.rampBayNumber ? String(body.rampBayNumber).trim() : '';
      const sealCargoPhotoUrl = body.sealCargoPhotoUrl ? String(body.sealCargoPhotoUrl) : null;
      const combinedNotes = [
        rampBayNumber ? `Ramp Bay: ${rampBayNumber}` : '',
        body.notes ? String(body.notes) : '',
        sealCargoPhotoUrl ? 'Timestamped Seal/Cargo Photo Captured' : '',
      ]
        .filter(Boolean)
        .join(' · ');

      const podRes = await withTenantRls(prisma, tenantId, async (tx) => {
        return submitJobPodEvidence(tx, {
          tenantId,
          jobId,
          receiverName: rampBayNumber ? `${receiverName} (${rampBayNumber})` : receiverName,
          photoUrl: body.signatureDataUri
            ? String(body.signatureDataUri)
            : body.photo
            ? String(body.photo)
            : sealCargoPhotoUrl,
          notes: combinedNotes || undefined,
          actor: String(body.driverName || 'Driver Mobile App'),
        });
      });
      return NextResponse.json({
        success: true,
        rampBayNumber,
        ...podRes,
      });
    }

    // 4. Standard Drayage Status Update (including optional ePOD signature / photo / ETC / Ramp Bay)
    const status = String(body.status ?? 'PLACED_AT_RAMP');
    const etcTime = body.etc || body.etcTime || null;
    const rampBayNumber = body.rampBayNumber ? String(body.rampBayNumber).trim() : '';
    const sealCargoPhotoUrl = body.sealCargoPhotoUrl ? String(body.sealCargoPhotoUrl) : null;
    const rawNotes = body.notes ? String(body.notes) : '';
    const notes = [
      rampBayNumber ? `Ramp Bay: ${rampBayNumber}` : '',
      rawNotes,
      sealCargoPhotoUrl ? `Timestamped Seal/Cargo Photo Attached` : '',
    ]
      .filter(Boolean)
      .join(' · ') || undefined;
    const placementLocation =
      body.placementLocation === 'YARD'
        ? 'YARD'
        : body.placementLocation === 'RAMP'
        ? 'RAMP'
        : status.includes('RAMP')
        ? 'RAMP'
        : status.includes('YARD')
        ? 'YARD'
        : undefined;
    const detachTrailer =
      body.detachTrailer !== undefined
        ? Boolean(body.detachTrailer)
        : status === 'TRAILER_ATTACHED'
        ? false
        : status.includes('DETACHED') || status === 'READY_FOR_PICKUP' || status === 'CONTAINER_DROPPED';

    const result = await withTenantRls(prisma, tenantId, async (tx) => {
      if (body.receiverName || body.photo || body.signatureDataUri || sealCargoPhotoUrl) {
        const baseReceiver = String(body.receiverName || body.driverName || 'Warehouse Dock Supervisor').trim();
        await submitJobPodEvidence(tx, {
          tenantId,
          jobId,
          receiverName: rampBayNumber ? `${baseReceiver} (${rampBayNumber})` : baseReceiver,
          photoUrl: body.signatureDataUri
            ? String(body.signatureDataUri)
            : body.photo
            ? String(body.photo)
            : sealCargoPhotoUrl,
          notes,
          actor: body.driverName ? String(body.driverName) : 'Driver Mobile App',
        });
      }
      return updateDrayageJobExecutionStatus(tx, {
        tenantId,
        jobId,
        status,
        placementLocation,
        detachTrailer,
        etcTime,
        notes,
        actor: body.driverName || 'Driver Mobile App',
      });
    });

    return NextResponse.json({
      success: true,
      jobId,
      status: result.status,
      etcTime: result.etcTime,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[api/driver/jobs/[id]/status POST]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update job status from driver app' },
      { status: 500 },
    );
  }
}
