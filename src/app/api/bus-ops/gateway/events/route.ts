/**
 * POST /api/bus-ops/gateway/events
 *
 * Bulk ingest endpoint for in-bus BLE gateways. Two payload shapes:
 *
 *   PRE-PROCESSED  (gateway did its own hysteresis; recommended):
 *   {
 *     gatewayId: 'GW-ABCDEF',
 *     events: [
 *       { kind:'BOARD',  tagId:'TAG-001', occurredAt:'2026-05-06T07:14:23Z', rssiDbm:-58 },
 *       { kind:'ALIGHT', tagId:'TAG-002', occurredAt:'2026-05-06T07:14:55Z' },
 *     ],
 *     location?: { lat: 25.197, lng: 55.274 },
 *   }
 *
 *   RAW SCAN (gateway has no on-device logic; server detects transitions):
 *   {
 *     gatewayId: 'GW-ABCDEF',
 *     scanWindow: {
 *       startedAt:'...', endedAt:'...',
 *       observations: [
 *         { tagId, rssiMaxDbm, rssiAvgDbm, sampleCount, firstSeenAt, lastSeenAt }
 *       ],
 *     },
 *   }
 *
 * Auth: HMAC-SHA256 of the raw body using BLE_GATEWAY_SHARED_SECRET, hex
 * encoded in `x-gateway-signature`. Bodies replay-protected by includes
 * timestamps, but you should also rotate the shared secret periodically.
 *
 * Idempotency: writes are keyed by (scheduleId, passengerId, occurredAt) —
 * sending the same event twice is safe.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  verifyGatewaySignature,
  detectTransitions,
  type ProcessedGatewayEvent,
  type PresenceState,
  type RawScanWindow,
} from '@/lib/bus-gateway';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { ensureBusOpsDeviceInfra } from '@/lib/bus-ops-route-guards';

export const runtime = 'nodejs';

interface IngestSummary {
  gatewayId: string;
  vehicleId: string | null;
  scheduleId: string | null;
  payload: 'PROCESSED' | 'RAW' | 'EMPTY';
  transitionsApplied: number;
  unknownTags: { tagId: string; reason: string }[];
  noActiveTrip: number;
  duplicates: number;
  errors: number;
}

export async function POST(req: NextRequest) {
  await ensureBusOpsDeviceInfra();

  const rawBody = await req.text();
  const sig = req.headers.get('x-gateway-signature');
  if (!verifyGatewaySignature(rawBody, sig)) {
    return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 });
  }

  let payload: { gatewayId?: string; events?: ProcessedGatewayEvent[]; scanWindow?: RawScanWindow; location?: { lat: number; lng: number } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const gatewayId = payload?.gatewayId?.trim();
  if (!gatewayId) {
    return NextResponse.json({ ok: false, error: 'gatewayId is required' }, { status: 400 });
  }

  const gateway = await prisma.bleGateway.findUnique({
    where: { gatewayId },
    select: { vehicleId: true, isActive: true, rssiThresholdDbm: true, presenceGraceSeconds: true },
  });
  if (!gateway || gateway.isActive === false) {
    return NextResponse.json({ ok: false, error: 'Gateway not registered or inactive' }, { status: 404 });
  }

  // Heartbeat the gateway up-front, even if the payload is empty.
  await prisma.bleGateway.update({
    where: { gatewayId },
    data: { lastSeenAt: new Date() },
  }).catch(() => {});

  const summary: IngestSummary = {
    gatewayId,
    vehicleId: gateway.vehicleId,
    scheduleId: null,
    payload: 'EMPTY',
    transitionsApplied: 0,
    unknownTags: [],
    noActiveTrip: 0,
    duplicates: 0,
    errors: 0,
  };

  try {
    // Determine the active trip for this vehicle right now.
    const now = new Date();
    const activeTrip = await prisma.tripSchedule.findFirst({
      where: {
        vehicleId: gateway.vehicleId,
        deletedAt: null,
        status: { in: ['SCHEDULED', 'DEPARTED', 'IN_TRANSIT'] },
        // Trip is "active" if it's within ±2h of departure, or currently in
        // transit. Simple heuristic — adjust if shifts are longer than 4h.
        departureTime: { lte: new Date(now.getTime() + 2 * 60 * 60 * 1000) },
      },
      orderBy: { departureTime: 'desc' },
      select: { id: true, status: true },
    });
    summary.scheduleId = activeTrip?.id ?? null;

    /* ─ Path A: pre-processed events ─────────────────────────────────── */
    if (Array.isArray(payload.events) && payload.events.length > 0) {
      summary.payload = 'PROCESSED';
      for (const ev of payload.events) {
        await applyTransition(
          { tagId: ev.tagId, kind: ev.kind, occurredAt: new Date(ev.occurredAt), rssiDbm: ev.rssiDbm, location: ev.location ?? payload.location },
          gateway.vehicleId,
          activeTrip?.id ?? null,
          gatewayId,
          summary,
        );
      }
    }
    /* ─ Path B: raw scan window — server-side detection ─────────────── */
    else if (payload.scanWindow) {
      summary.payload = 'RAW';
      const window = payload.scanWindow;

      // Load prior presence for these tags on the active trip.
      const tagIds = window.observations.map(o => o.tagId);
      const priorRows = activeTrip
        ? await prisma.bleGatewayPresence.findMany({
            where: { gatewayId, tagId: { in: tagIds }, scheduleId: activeTrip.id },
          })
        : [];
      const prior = new Map<string, PresenceState>(
        priorRows.map(r => [r.tagId, {
          tagId: r.tagId,
          scheduleId: r.scheduleId,
          isPresent: r.isPresent,
          lastSeenAt: r.lastSeenAt,
        }]),
      );

      const config = {
        rssiThresholdDbm: gateway.rssiThresholdDbm ?? -75,
        minSampleCount: 3,
        presenceGraceSeconds: gateway.presenceGraceSeconds ?? 10,
      };
      const { transitions, nextPresence } = detectTransitions(window, prior, config);

      // Apply transitions.
      for (const t of transitions) {
        await applyTransition(
          { tagId: t.tagId, kind: t.kind, occurredAt: t.occurredAt, rssiDbm: t.rssiDbm, location: window.location },
          gateway.vehicleId,
          activeTrip?.id ?? null,
          gatewayId,
          summary,
        );
      }

      // Persist presence cache for next window.
      if (activeTrip) {
        for (const obs of window.observations) {
          const state = nextPresence.get(obs.tagId);
          if (!state) continue;
          await prisma.bleGatewayPresence.upsert({
            where: { gatewayId_tagId_scheduleId: { gatewayId, tagId: obs.tagId, scheduleId: activeTrip.id } },
            update: {
              firstSeenAt: state.isPresent ? state.lastSeenAt : new Date(obs.firstSeenAt),
              lastSeenAt: state.lastSeenAt,
              lastRssiDbm: obs.rssiMaxDbm,
              isPresent: state.isPresent,
              alightedAt: state.isPresent ? null : new Date(window.endedAt),
            },
            create: {
              gatewayId,
              vehicleId: gateway.vehicleId,
              tagId: obs.tagId,
              scheduleId: activeTrip.id,
              firstSeenAt: new Date(obs.firstSeenAt),
              lastSeenAt: state.lastSeenAt,
              lastRssiDbm: obs.rssiMaxDbm,
              isPresent: state.isPresent,
            },
          }).catch(err => {
            summary.errors += 1;
            captureException(err, { context: 'bus-gateway.presence.upsert', tags: { gatewayId, tagId: obs.tagId } });
          });
        }
      }
    }

    if (summary.transitionsApplied > 0) {
      await prisma.bleGateway.update({
        where: { gatewayId },
        data: { lastEventAt: new Date() },
      }).catch(() => {});
    }

    if (summary.transitionsApplied > 0) {
      void logAudit({
        userId: `gateway:${gatewayId}`,
        userRole: 'GATEWAY',
        entityType: 'TripSchedule',
        entityId: activeTrip?.id,
        action: 'UPDATE',
        details: `Gateway ingest (${summary.payload}): ${summary.transitionsApplied} transitions, ${summary.duplicates} dedup, ${summary.unknownTags.length} unknown, ${summary.noActiveTrip} no-trip, ${summary.errors} errors.`,
      });
    }

    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    captureException(err, { context: 'bus-ops.gateway.events', tags: { gatewayId } });
    return NextResponse.json({ ok: false, error: 'Ingest failed', summary }, { status: 500 });
  }
}

/* ── Apply one resolved transition (BOARD or ALIGHT) ──────────────────── */

async function applyTransition(
  t: { tagId: string; kind: 'BOARD' | 'ALIGHT'; occurredAt: Date; rssiDbm?: number; location?: { lat: number; lng: number } },
  vehicleId: string,
  activeTripId: string | null,
  gatewayId: string,
  summary: IngestSummary,
) {
  if (!activeTripId) {
    summary.noActiveTrip += 1;
    return;
  }

  // Resolve tag → staff member.
  const tag = await prisma.staffBleTag.findUnique({
    where: { tagId: t.tagId },
    select: { staffMemberId: true, isActive: true },
  });
  if (!tag || tag.isActive === false) {
    summary.unknownTags.push({ tagId: t.tagId, reason: 'unknown or inactive' });
    return;
  }

  // Resolve passenger row on this trip.
  const passenger = await prisma.tripPassenger.findFirst({
    where: { tripId: activeTripId, staffMemberId: tag.staffMemberId },
    select: { id: true, status: true },
  });
  if (!passenger) {
    summary.unknownTags.push({ tagId: t.tagId, reason: 'staff not on trip manifest' });
    return;
  }

  // Idempotency: same tag + trip + occurredAt within 5s already exists?
  const dedupWindowStart = new Date(t.occurredAt.getTime() - 5_000);
  const dedupWindowEnd = new Date(t.occurredAt.getTime() + 5_000);
  const dup = await prisma.boardingEvent.findFirst({
    where: {
      scheduleId: activeTripId,
      passengerId: passenger.id,
      direction: t.kind,
      method: 'BLE_GATEWAY',
      performedAt: { gte: dedupWindowStart, lte: dedupWindowEnd },
    },
    select: { id: true },
  });
  if (dup) {
    summary.duplicates += 1;
    return;
  }

  try {
    await prisma.$transaction([
      prisma.boardingEvent.create({
        data: {
          scheduleId: activeTripId,
          passengerId: passenger.id,
          staffMemberId: tag.staffMemberId,
          method: 'BLE_GATEWAY',
          direction: t.kind,
          identifier: t.tagId,
          performedAt: t.occurredAt,
          performedBy: `gateway:${gatewayId}`,
          rawPayload: { rssiDbm: t.rssiDbm ?? null, location: t.location ?? null },
        },
      }),
      // BOARD flips status; ALIGHT keeps BOARDED but the event log is the
      // source of truth for actual onboard count.
      prisma.tripPassenger.update({
        where: { id: passenger.id },
        data: t.kind === 'BOARD'
          ? { status: 'BOARDED', boardedAt: t.occurredAt }
          : {},
      }),
    ]);
    summary.transitionsApplied += 1;
  } catch (err) {
    summary.errors += 1;
    captureException(err, { context: 'bus-gateway.applyTransition', tags: { gatewayId, tagId: t.tagId } });
  }
}
