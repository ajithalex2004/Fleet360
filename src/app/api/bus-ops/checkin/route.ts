/**
 * POST /api/bus-ops/checkin
 *
 * Unified multi-method boarding endpoint. Accepts:
 *
 * QR (driver displays trip QR; passenger scans):
 *   { method:'QR', token:'<scheduleId>.<expiry>.<sig>', staffMemberId, direction }
 *
 * QR (passenger displays personal QR; driver scans):
 *   { method:'QR', token:'<scheduleId>.<expiry>.<sig>', staffEmployeeId, direction }
 *
 * NFC (Web NFC reads RFID tag UID):
 *   { method:'NFC', scheduleId, tagUid, direction }
 *
 * BLE (Web Bluetooth detects vehicle beacon proximity):
 *   { method:'BLE', scheduleId, beaconUuid, staffMemberId, rssi?, direction }
 *
 * MANUAL (passenger self-tap or driver tap):
 *   { method:'MANUAL', scheduleId, staffMemberId|passengerId, direction }
 *
 * Server validates the method-specific identifier and:
 *   1. Creates an immutable BoardingEvent row.
 *   2. Updates TripPassenger.status (BOARD → BOARDED, ALIGHT → keeps).
 *   3. Returns the event + denormalised passenger snapshot.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  verifyQrToken,
  normaliseBleUuid,
  normaliseNfcUid,
  type CheckinMethod,
  type CheckinDirection,
} from '@/lib/bus-checkin';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const METHODS: CheckinMethod[] = ['QR', 'NFC', 'BLE', 'MANUAL'];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const method = String(body?.method ?? '').toUpperCase() as CheckinMethod;
    if (!METHODS.includes(method)) {
      return NextResponse.json({ error: `method must be one of: ${METHODS.join(', ')}` }, { status: 400 });
    }
    const direction: CheckinDirection = body?.direction === 'ALIGHT' ? 'ALIGHT' : 'BOARD';

    let scheduleId: string | null = null;
    let staffMemberId: string | null = body?.staffMemberId ?? null;
    let identifier: string | null = null;
    let resolvedNote = '';

    /* ── Resolve schedule + identity by method ──────────────────────────── */

    if (method === 'QR') {
      const token = String(body?.token ?? '');
      const verify = verifyQrToken(token);
      if (!verify.ok) {
        return NextResponse.json({ error: `QR ${verify.reason}` }, { status: 400 });
      }
      scheduleId = verify.scheduleId!;
      identifier = token;
      // Caller may pass either staffMemberId OR staffEmployeeId.
      if (!staffMemberId && body?.staffEmployeeId) {
        const m = await prisma.staffMember.findUnique({
          where: { employeeId: String(body.staffEmployeeId) },
          select: { id: true },
        });
        staffMemberId = m?.id ?? null;
      }
    }
    else if (method === 'NFC') {
      scheduleId = body?.scheduleId ?? null;
      const tagUid = normaliseNfcUid(String(body?.tagUid ?? ''));
      if (!scheduleId || !tagUid) {
        return NextResponse.json({ error: 'scheduleId and tagUid are required for NFC' }, { status: 400 });
      }
      const tag = await prisma.staffRfidTag.findUnique({
        where: { tagUid },
        select: { staffMemberId: true, isActive: true },
      });
      if (!tag || tag.isActive === false) {
        return NextResponse.json({ error: 'Unknown or inactive RFID tag' }, { status: 404 });
      }
      staffMemberId = tag.staffMemberId;
      identifier = tagUid;
    }
    else if (method === 'BLE') {
      scheduleId = body?.scheduleId ?? null;
      const beaconUuid = normaliseBleUuid(String(body?.beaconUuid ?? ''));
      if (!scheduleId || !beaconUuid || !staffMemberId) {
        return NextResponse.json({ error: 'scheduleId, beaconUuid, and staffMemberId are required for BLE' }, { status: 400 });
      }
      // Beacon must match the trip's assigned vehicle.
      const sched = await prisma.tripSchedule.findUnique({
        where: { id: scheduleId },
        select: { vehicleId: true, status: true },
      });
      if (!sched?.vehicleId) {
        return NextResponse.json({ error: 'Trip has no vehicle assigned — cannot validate BLE beacon' }, { status: 412 });
      }
      const beacon = await prisma.vehicleBeacon.findUnique({
        where: { vehicleId: sched.vehicleId },
        select: { bleUuid: true, isActive: true },
      });
      if (!beacon || beacon.isActive === false || beacon.bleUuid.toLowerCase() !== beaconUuid) {
        return NextResponse.json({ error: 'Beacon UUID does not match trip vehicle' }, { status: 403 });
      }
      identifier = beaconUuid;
      resolvedNote = ` rssi=${body?.rssi ?? '—'}`;
    }
    else if (method === 'MANUAL') {
      scheduleId = body?.scheduleId ?? null;
      if (!scheduleId) {
        return NextResponse.json({ error: 'scheduleId is required for MANUAL' }, { status: 400 });
      }
      // staffMemberId or passengerId — either works.
    }

    if (!scheduleId) {
      return NextResponse.json({ error: 'Could not resolve scheduleId' }, { status: 400 });
    }

    /* ── Resolve TripPassenger (the link to denormalise status onto) ──── */

    let passengerId: string | null = body?.passengerId ?? null;
    if (!passengerId && staffMemberId) {
      const p = await prisma.tripPassenger.findFirst({
        where: { tripId: scheduleId, staffMemberId },
        select: { id: true },
      });
      passengerId = p?.id ?? null;
    }
    if (!passengerId && staffMemberId === null) {
      return NextResponse.json({ error: 'Could not identify staff member or passenger' }, { status: 400 });
    }
    if (!passengerId) {
      return NextResponse.json({ error: `Staff member is not a passenger on this trip` }, { status: 404 });
    }

    /* ── Persist immutable event + denormalise status ──────────────────── */

    const performedBy = req.headers.get('x-user-id') ?? body?.performedBy ?? null;
    const performedAt = body?.performedAt ? new Date(body.performedAt) : new Date();

    const [event, passenger] = await prisma.$transaction([
      prisma.boardingEvent.create({
        data: {
          scheduleId,
          passengerId,
          staffMemberId,
          method,
          direction,
          identifier,
          stopId: body?.stopId ?? null,
          performedAt,
          performedBy,
          rawPayload: body && typeof body === 'object'
            ? (body as Record<string, unknown>)
            : null,
        },
      }),
      prisma.tripPassenger.update({
        where: { id: passengerId },
        data: direction === 'BOARD'
          ? { status: 'BOARDED', boardedAt: performedAt }
          : { /* ALIGHT — preserve BOARDED status, no fields to mutate */ status: 'BOARDED' },
      }),
    ]);

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: performedBy ?? `method:${method}`,
      userRole: req.headers.get('x-user-role') ?? 'STAFF',
      entityType: 'TripPassenger',
      entityId: passengerId,
      action: 'UPDATE',
      details: `${direction} via ${method}${identifier ? ` (${identifier.slice(0, 16)})` : ''}${resolvedNote} on schedule ${scheduleId.slice(0, 8)}.`,
    });

    return NextResponse.json({ ok: true, event, passenger });
  } catch (err) {
    captureException(err, { context: 'bus-ops.checkin' });
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Check-in failed' }, { status: 500 });
  }
}
