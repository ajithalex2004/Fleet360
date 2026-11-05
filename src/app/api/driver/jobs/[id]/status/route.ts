export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  updateDrayageJobExecutionStatus,
  recordDrayageDriverLocationPing,
  submitJobPodEvidence,
  sendDispatchChatMessage,
  acknowledgeDrayageAlert,
  clearPortInspection,
  submitDriverExpenseReceipt,
} from '@/lib/logistics/drayage-domain';
import { requireDriverSession } from '@/lib/driver-session';
import { emitDrayageEvent } from '@/lib/logistics/drayage-events';

async function resolveDriverActorLabel(
  tx: { $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T> },
  tenantId: string,
  jobId: string,
  fallbackName?: unknown,
): Promise<string> {
  const rawFallback = typeof fallbackName === 'string' ? fallbackName.trim() : '';
  const rows = await tx
    .$queryRawUnsafe<Array<{ driver_name: string | null; employee_id: string | null }>>(
      `SELECT
         COALESCE(
           NULLIF(TRIM(CONCAT(COALESCE(d.first_name, ''), ' ', COALESCE(d.last_name, ''))), ''),
           NULLIF(TRIM(d.name), ''),
           NULLIF(TRIM(j.assigned_driver_name), '')
         ) AS driver_name,
         COALESCE(
           (
             SELECT NULLIF(TRIM(u."employeeId"), '')
               FROM "User" u
              WHERE u.id = d.id::text
                 OR u.id = j.assigned_driver_id
                 OR (u.email IS NOT NULL AND d.email IS NOT NULL AND LOWER(u.email) = LOWER(d.email))
              LIMIT 1
           ),
           NULLIF(TRIM(d.dallas_id), ''),
           NULLIF(TRIM(d.license_number), '')
         ) AS employee_id
       FROM logistics_drayage_jobs j
       LEFT JOIN drivers d
         ON d.deleted_at IS NULL
        AND (
          d.id::text = j.assigned_driver_id
          OR (
            j.assigned_driver_name IS NOT NULL
            AND LOWER(TRIM(COALESCE(NULLIF(TRIM(CONCAT(COALESCE(d.first_name, ''), ' ', COALESCE(d.last_name, ''))), ''), d.name, ''))) =
                LOWER(TRIM(j.assigned_driver_name))
          )
        )
      WHERE j.id = $1 AND j.tenant_id = $2
      LIMIT 1`,
      jobId,
      tenantId,
    )
    .catch(() => []);

  const dbName = rows[0]?.driver_name?.trim() || '';
  const empId = rows[0]?.employee_id?.trim() || '';
  const name = rawFallback || dbName || 'Driver';
  if (empId && !name.includes(empId)) {
    return `${name} (${empId})`;
  }
  return name;
}

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
      emitDrayageEvent(tenantId, {
        type: 'chat_message',
        action: 'driver_chat',
        jobId,
      });
      return NextResponse.json({
        success: true,
        id: chatRes.id,
        createdAt: new Date().toISOString(),
      });
    }

    // 1b. Acknowledge Fleet Broadcast Message (persisted in DB per-driver & tenant)
    if (action === 'ACK_BROADCAST') {
      const messageId = String(body.messageId || jobId || '').trim();
      if (!messageId) {
        return NextResponse.json({ error: 'messageId is required' }, { status: 400 });
      }
      await withTenantRls(prisma, tenantId, async (tx) => {
        const ctx = await requireDriverSession(req).catch(() => null);
        const driverId = ctx && !(ctx instanceof NextResponse) ? ctx.userId : null;
        if (driverId) {
          await acknowledgeDrayageAlert(tx, {
            tenantId,
            alertKey: `BROADCAST_ACK:${driverId}:${messageId}`,
          });
        }
        await acknowledgeDrayageAlert(tx, {
          tenantId,
          alertKey: `BROADCAST_ACK:${messageId}`,
        });
      });
      return NextResponse.json({
        success: true,
        messageId,
        acknowledgedAt: new Date().toISOString(),
      });
    }

    // 1c. 1-Minute In-Transit GPS Breadcrumb Ping (ACCEPTED -> COMPLETED)
    if (action === 'LOCATION_PING') {
      const lat = body.latitude != null ? Number(body.latitude) : NaN;
      const lng = body.longitude != null ? Number(body.longitude) : NaN;
      if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
        return NextResponse.json({ error: 'Valid latitude and longitude are required' }, { status: 400 });
      }
      const pingRes = await withTenantRls(prisma, tenantId, async (tx) => {
        const driverActor = await resolveDriverActorLabel(tx, tenantId, jobId, body.driverName);
        return recordDrayageDriverLocationPing(tx, {
          tenantId,
          jobId,
          latitude: lat,
          longitude: lng,
          speedKmh: body.speedKmh != null ? Number(body.speedKmh) : null,
          heading: body.heading != null ? Number(body.heading) : null,
          location: body.location ? String(body.location) : null,
          actor: driverActor,
        });
      });
      emitDrayageEvent(tenantId, {
        type: 'telemetry_ping',
        action: 'driver_location_ping',
        jobId,
      });
      return NextResponse.json({
        success: true,
        ...pingRes,
      });
    }

    // 2. ISO 6346 Container & Bolt Seal Verification
    if (action === 'SCAN_VERIFY') {
      const scannedContainer = String(body.scannedContainerNumber ?? '').trim().toUpperCase();
      const scannedSeal = String(body.scannedSealNumber ?? '').trim().toUpperCase();
      const scannedEir = String(body.scannedEirNumber ?? '').trim().toUpperCase();
      const scanStage = String(body.scanStage ?? 'CONTAINER_LOADED').trim();
      await withTenantRls(prisma, tenantId, async (tx) => {
        const driverActor = await resolveDriverActorLabel(tx, tenantId, jobId, body.driverName);
        await clearPortInspection(tx, {
          tenantId,
          jobId,
          agency: 'CUSTOMS',
          newSealNumber: scannedSeal || undefined,
          clearedBy: driverActor,
          notes: `Gemini Vision OCR [${scanStage}]: Container (${scannedContainer})${scannedSeal ? `, Customs Seal (${scannedSeal})` : ''}${scannedEir ? `, EIR Gate Slip (${scannedEir})` : ''} verified via Driver Mobile App`,
          actor: driverActor,
          latitude: body.latitude != null ? Number(body.latitude) : null,
          longitude: body.longitude != null ? Number(body.longitude) : null,
          location: body.location ? String(body.location) : null,
        });
      });
      emitDrayageEvent(tenantId, {
        type: 'status_updated',
        action: 'driver_scan_verify',
        jobId,
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

    // 3. Sign-on-Glass ePOD Signature / Uploaded Signed POD Submission
    if (action === 'EPOD_SIGN') {
      const receiverName = String(body.receiverName ?? 'Warehouse Dock Supervisor').trim();
      const rampBayNumber = body.rampBayNumber ? String(body.rampBayNumber).trim() : '';
      const sealCargoPhotoUrl = body.sealCargoPhotoUrl ? String(body.sealCargoPhotoUrl) : null;
      const captureMethod = body.captureMethod ? String(body.captureMethod) : undefined;
      const eventStatus = body.eventStatus ? String(body.eventStatus) : 'POD_SIGNED / EPOD_CAPTURED';
      const combinedNotes = [
        rampBayNumber ? `Ramp Bay: ${rampBayNumber}` : '',
        body.notes ? String(body.notes) : '',
        sealCargoPhotoUrl ? 'Timestamped Seal/Cargo Photo Captured' : '',
      ]
        .filter(Boolean)
        .join(' · ');

      const podRes = await withTenantRls(prisma, tenantId, async (tx) => {
        const driverActor = await resolveDriverActorLabel(tx, tenantId, jobId, body.driverName);
        return submitJobPodEvidence(tx, {
          tenantId,
          jobId,
          receiverName: rampBayNumber ? `${receiverName} (${rampBayNumber})` : receiverName,
          photoUrl: body.uploadedPodDataUri
            ? String(body.uploadedPodDataUri)
            : body.signatureDataUri
            ? String(body.signatureDataUri)
            : body.photo
            ? String(body.photo)
            : sealCargoPhotoUrl,
          notes: combinedNotes || undefined,
          actor: driverActor,
          latitude: body.latitude != null ? Number(body.latitude) : null,
          longitude: body.longitude != null ? Number(body.longitude) : null,
          location: body.location ? String(body.location) : null,
          eventStatus,
          captureMethod,
        });
      });
      emitDrayageEvent(tenantId, {
        type: 'status_updated',
        action: 'driver_epod_sign',
        jobId,
      });
      return NextResponse.json({
        success: true,
        rampBayNumber,
        ...podRes,
      });
    }

    // 3b. Driver Expense Receipt & Voice Note Submission (auto-synced to Driver Payments Approval screen)
    if (action === 'EXPENSE_RECEIPT') {
      const receiptRes = await withTenantRls(prisma, tenantId, async (tx) => {
        return submitDriverExpenseReceipt(tx, {
          tenantId,
          jobId,
          driverName: body.driverName ? String(body.driverName) : undefined,
          receiptCategory: String(body.receiptCategory || 'PORT_GATE_PASS'),
          receiptLabel: String(body.receiptLabel || 'Port Gate Pass Receipt'),
          amountAed: Number(body.amountAed || 0),
          receiptNumber: body.receiptNumber ? String(body.receiptNumber) : undefined,
          notes: body.notes ? String(body.notes) : undefined,
          receiptPhotoUrl: body.receiptPhotoUrl ? String(body.receiptPhotoUrl) : null,
          voiceNoteDataUrl: body.voiceNoteDataUrl ? String(body.voiceNoteDataUrl) : null,
          voiceNoteDurationSec: body.voiceNoteDurationSec ? Number(body.voiceNoteDurationSec) : 0,
        });
      });
      emitDrayageEvent(tenantId, {
        type: 'status_updated',
        action: 'driver_expense_receipt',
        jobId,
      });
      return NextResponse.json({
        success: true,
        ...receiptRes,
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
      const driverActor = await resolveDriverActorLabel(tx, tenantId, jobId, body.driverName);
      const reqLat = body.latitude != null ? Number(body.latitude) : null;
      const reqLng = body.longitude != null ? Number(body.longitude) : null;
      const reqLoc = body.location ? String(body.location) : null;
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
          actor: driverActor,
          latitude: reqLat,
          longitude: reqLng,
          location: reqLoc,
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
        actor: driverActor,
        latitude: reqLat,
        longitude: reqLng,
        location: reqLoc,
      });
    });

    emitDrayageEvent(tenantId, {
      type: 'status_updated',
      action: 'driver_status_update',
      jobId,
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
