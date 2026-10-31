export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { getDriverTenantContext } from '@/lib/driver-session';
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

  const driverCtx = await getDriverTenantContext(req);
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  const tenantId = driverCtx?.tenantId || (authz.ok ? authz.tenantId : '');
  if (!tenantId) {
    return NextResponse.json(
      { error: !authz.ok ? authz.error : 'Unauthorized' },
      { status: !authz.ok ? authz.status : 401 },
    );
  }

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
      await withTenantRls(prisma, tenantId, async (tx) => {
        await clearPortInspection(tx, {
          tenantId,
          jobId,
          agency: 'CUSTOMS',
          newSealNumber: scannedSeal || undefined,
          clearedBy: String(body.driverName || 'Driver ISO 6346 Scanner'),
          notes: `ISO 6346 Container (${scannedContainer}) & Bolt Seal (${scannedSeal}) verified via Driver Mobile App`,
          actor: String(body.driverName || 'Driver Mobile App'),
        });
      });
      return NextResponse.json({
        success: true,
        jobId,
        scannedContainerNumber: scannedContainer,
        scannedSealNumber: scannedSeal,
        verifiedAt: new Date().toISOString(),
      });
    }

    // 3. Sign-on-Glass ePOD Signature Submission
    if (action === 'EPOD_SIGN') {
      const receiverName = String(body.receiverName ?? 'Warehouse Dock Supervisor').trim();
      const podRes = await withTenantRls(prisma, tenantId, async (tx) => {
        return submitJobPodEvidence(tx, {
          tenantId,
          jobId,
          receiverName,
          photoUrl: body.signatureDataUri ? String(body.signatureDataUri) : (body.photo ? String(body.photo) : null),
          notes: body.notes ? String(body.notes) : undefined,
          actor: String(body.driverName || 'Driver Mobile App'),
        });
      });
      return NextResponse.json({
        success: true,
        ...podRes,
      });
    }

    // 4. Standard Drayage Status Update (including optional ePOD signature / photo / ETC)
    const status = String(body.status ?? 'PLACED_AT_RAMP');
    const etcTime = body.etc || body.etcTime || null;
    const notes = body.notes ? String(body.notes) : undefined;
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
      if (body.receiverName || body.photo) {
        await submitJobPodEvidence(tx, {
          tenantId,
          jobId,
          receiverName: String(body.receiverName || body.driverName || 'Driver Inspection'),
          photoUrl: body.signatureDataUri ? String(body.signatureDataUri) : (body.photo ? String(body.photo) : null),
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
