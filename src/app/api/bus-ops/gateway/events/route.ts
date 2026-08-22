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
 * Auth: HMAC-SHA256 of the raw body, hex encoded in
 * `x-gateway-signature`, keyed by the per-gateway secret (falling back
 * to BLE_GATEWAY_SHARED_SECRET while the per-secret rollout completes).
 * A gateway with neither fails closed. This route is listed in
 * PUBLIC_PREFIXES because hardware has no operator session, so the
 * signature check here IS the trust boundary — not a second layer
 * behind one.
 *
 * NOT replay-protected. The previous version of this comment claimed
 * bodies were, which was never true: nothing binds a request to a time
 * window or a nonce, so a captured body can be re-sent. The per-event
 * dedup below absorbs an immediate resend, but a replay far enough
 * later resolves a DIFFERENT active trip and would apply the events
 * there. Fixing that needs a signed timestamp plus a freshness window,
 * which is a protocol change on the firmware side — tracked separately
 * rather than silently assumed to be handled.
 *
 * Idempotency: per-event dedup on
 * (scheduleId, passengerId, direction, method) within ±5s of
 * occurredAt — sending the same event twice in quick succession is safe.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  verifyGatewaySignatureWithSecret,
  resolveGatewaySecret,
  detectTransitions,
  type ProcessedGatewayEvent,
  type PresenceState,
  type RawScanWindow,
} from '@/lib/bus-gateway';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import type { BoardingEventSource } from '@prisma/client';
import {
  recordBoarding,
  logAlightEvent,
  type AttendanceContext,
} from '@/lib/bus-ops/passenger-attendance';

export const runtime = 'nodejs';

/**
 * Source recorded on every BoardingEvent this route writes.
 *
 * Was the string literal 'BLE_GATEWAY', which is not a member of the
 * boarding_event_source enum (BLE | QR | NFC | MANUAL | DRIVER_APP |
 * GEOFENCE). Both the dedup lookup and the insert therefore threw
 * "Invalid value for argument `method`" on every event, and the catch
 * around them counted it as a generic error — so the gateway received a
 * 200 while nothing was ever recorded and no passenger was ever marked
 * BOARDED.
 *
 * Typed as BoardingEventSource rather than a bare string so the compiler
 * rejects the next invalid value instead of leaving it to fail at
 * runtime. tsc did flag the original (TS2322 on both lines); CI's
 * typecheck is continue-on-error under KNOWN-TS-001, so it shipped.
 */
const BLE_METHOD: BoardingEventSource = 'BLE';

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
  const rawBody = await req.text();
  const sig = req.headers.get('x-gateway-signature');

  // Peek gatewayId from body BEFORE HMAC verify so we can resolve the
  // per-gateway secret. The JSON parse is a read-only side-effect-free
  // op; nothing downstream acts on payload until HMAC verifies below.
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
    select: {
      vehicleId: true, tenantId: true, isActive: true,
      rssiThresholdDbm: true, presenceGraceSeconds: true,
      // Per-gateway secret. When null, resolveGatewaySecret falls back
      // to the BLE_GATEWAY_SHARED_SECRET env var for backward compat
      // during the per-secret rollout.
      secret: true,
    },
  });
  // Unregistered/inactive gateway and bad signature deliberately return
  // the SAME 401 with the same body. This endpoint is unauthenticated at
  // the middleware layer, so a distinguishable "not registered" response
  // lets anyone enumerate which gateway ids exist by posting a garbage
  // signature and watching for 404 vs 401 — the same oracle that
  // returning 403 instead of 404 gives on a tenant-scoped lookup.
  // A legitimate operator debugging real hardware has the server logs;
  // an anonymous prober learns nothing either way.
  //
  // resolveGatewaySecret returns null when the row has no secret and no
  // BLE_GATEWAY_SHARED_SECRET fallback is configured, and
  // verifyGatewaySignatureWithSecret treats a null secret as failure —
  // so a secret-less gateway fails closed, not open.
  const authOk =
    gateway != null &&
    gateway.isActive !== false &&
    verifyGatewaySignatureWithSecret(rawBody, sig, resolveGatewaySecret(gateway.secret));

  // `!gateway ||` is redundant with authOk at runtime but narrows the
  // type for every gateway.* access below.
  if (!gateway || !authOk) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  // tenantId is derived from the gateway row — hardware devices authenticate
  // via HMAC and never send x-tenant-id. May be null for pre-migration rows;
  // those are still allowed through (RLS tenant_id IS NULL branch covers them).
  const tenantId = gateway.tenantId ?? null;

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
          tenantId,
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
          tenantId,
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
              ...(tenantId ? { tenantId } : {}),
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

    // Also audit batches that only produced errors. Previously this was
    // gated on transitionsApplied > 0, so a batch where every event
    // failed left no audit trail at all — combined with the hardcoded
    // ok: true, a totally broken ingest was invisible from both ends.
    if (summary.transitionsApplied > 0 || summary.errors > 0) {
      void logAudit({
        userId: `gateway:${gatewayId}`,
        userRole: 'GATEWAY',
        entityType: 'TripSchedule',
        entityId: activeTrip?.id,
        action: 'UPDATE',
        details: `Gateway ingest (${summary.payload}): ${summary.transitionsApplied} transitions, ${summary.duplicates} dedup, ${summary.unknownTags.length} unknown, ${summary.noActiveTrip} no-trip, ${summary.errors} errors.`,
      });
    }

    // `ok` reflects whether every event in the batch was actually
    // recorded — NOT merely that the request was parsed and authorised.
    //
    // This previously returned a hardcoded `ok: true` whenever the
    // handler didn't throw, while per-event failures were swallowed into
    // summary.errors by the catch inside applyTransition. A gateway
    // pushing boardings therefore saw 200 { ok: true } while every event
    // was discarded — the exact failure mode the BLE_METHOD bug above
    // produced, invisible for as long as nobody read the summary.
    //
    // The batch still returns 200: partial success is a real outcome
    // (one unknown tag shouldn't fail nineteen good boardings), and a
    // 5xx would make gateways retry events that were stored fine. The
    // signal moves into the body instead, where a client can act on it.
    const ok = summary.errors === 0;
    return NextResponse.json({
      ok,
      // Flat counters alongside the summary so a gateway can alert on
      // partial failure without understanding the nested shape.
      processed: summary.transitionsApplied + summary.duplicates + summary.errors,
      boarded:   summary.transitionsApplied,
      errors:    summary.errors,
      summary,
    });
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
  tenantId: string | null,
  summary: IngestSummary,
) {
  if (!activeTripId) {
    summary.noActiveTrip += 1;
    return;
  }

  // Resolve tag → staff member. Use findFirst (not findUnique) so we can
  // scope by tenantId when known — prevents cross-tenant tag collisions.
  const tag = await prisma.staffBleTag.findFirst({
    where: { tagId: t.tagId, ...(tenantId ? { tenantId } : {}) },
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
      method: BLE_METHOD,
      performedAt: { gte: dedupWindowStart, lte: dedupWindowEnd },
    },
    select: { id: true },
  });
  if (dup) {
    summary.duplicates += 1;
    return;
  }

  try {
    // Routed through the shared attendance service rather than writing
    // status directly. The direct write skipped the passenger state
    // machine entirely, so this path could produce states the manual API
    // then refused to leave — two rules governing one column. It also
    // means a rider who missed their assigned stop and caught the bus
    // further along is now correctly re-boarded (ABSENT → BOARDED),
    // with the earlier absence left intact in the event log.
    const ctx: AttendanceContext = {
      scheduleId:    activeTripId,
      passengerId:   passenger.id,
      staffMemberId: tag.staffMemberId,
      tenantId,
      source:        BLE_METHOD,
      identifier:    t.tagId,
      occurredAt:    t.occurredAt,
      performedBy:   `gateway:${gatewayId}`,
      rawPayload:    { rssiDbm: t.rssiDbm ?? null, location: t.location ?? null },
    };

    const result = await prisma.$transaction((tx) =>
      t.kind === 'BOARD'
        // ALIGHT deliberately does NOT move status to ALIGHTED here.
        // Onboard count is derived from the event log, and flipping
        // status on a stop-level alight would end the passenger's trip
        // early on multi-leg routes. recordAlighting exists for callers
        // that do want the status change.
        ? recordBoarding(tx, ctx)
        : logAlightEvent(tx, ctx),
    );

    if (result.applied) {
      summary.transitionsApplied += 1;
    } else if (result.reason === 'already in target state') {
      // A second detection of someone already aboard. The ±5s window
      // above catches exact resends; this catches the same rider being
      // re-scanned later in the trip, which is normal for a BLE gateway
      // seeing a stationary tag. Counted as a duplicate, not an unknown
      // tag — it is a known rider in a known state.
      summary.duplicates += 1;
    } else {
      // A move the state machine forbids (e.g. a stale BOARD arriving
      // after the passenger already alighted). Not the gateway's fault,
      // so it must not inflate summary.errors and flip ok to false, but
      // worth surfacing rather than swallowing.
      summary.unknownTags.push({ tagId: t.tagId, reason: result.reason ?? 'transition rejected' });
    }
  } catch (err) {
    summary.errors += 1;
    captureException(err, { context: 'bus-gateway.applyTransition', tags: { gatewayId, tagId: t.tagId } });
  }
}
