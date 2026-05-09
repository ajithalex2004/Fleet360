/**
 * BLE gateway ingest helpers — pure functions for the gateway-events route.
 *
 * Two ingest patterns are supported:
 *
 *   1. PRE-PROCESSED EVENTS (recommended for production)
 *      The on-device gateway runs RSSI thresholding + presence hysteresis
 *      itself and posts ready-to-apply BOARD/ALIGHT events. Server's job is
 *      auth, identity resolution, and persistence.
 *
 *   2. RAW SCAN BATCHES (fallback for low-cost gateways without on-device logic)
 *      Gateway posts every observation it heard in the last window
 *      (tag, RSSI, sample count, first/last seen). Server runs the
 *      detector against the BleGatewayPresence cache to derive transitions.
 *
 * Both arrive at the same place: a list of resolved transitions ready to
 * write into BoardingEvent + denormalise onto TripPassenger.status.
 */

import { createHmac, timingSafeEqual } from 'crypto';

const SHARED_SECRET_ENV = 'BLE_GATEWAY_SHARED_SECRET';

/* ── HMAC verification ──────────────────────────────────────────────────── */

export function verifyGatewaySignature(rawBody: string, signatureHex: string | null): boolean {
  const secret = process.env[SHARED_SECRET_ENV];
  if (!secret || !signatureHex) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  if (expected.length !== signatureHex.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

export function gatewaySecretConfigured(): boolean {
  return Boolean(process.env[SHARED_SECRET_ENV]);
}

/* ── Pre-processed events ──────────────────────────────────────────────── */

export interface ProcessedGatewayEvent {
  kind: 'BOARD' | 'ALIGHT';
  tagId: string;
  occurredAt: string;        // ISO 8601
  rssiDbm?: number;
  location?: { lat: number; lng: number };
}

/* ── Raw scan path (gateway has no on-device logic) ────────────────────── */

export interface RawScanObservation {
  tagId: string;
  /** The strongest RSSI seen for this tag in this window (dBm, negative). */
  rssiMaxDbm: number;
  /** Average RSSI over samples. */
  rssiAvgDbm: number;
  /** How many advertising packets we received. */
  sampleCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface RawScanWindow {
  startedAt: string;
  endedAt: string;
  location?: { lat: number; lng: number };
  observations: RawScanObservation[];
}

/* ── Pure presence-detection state machine ─────────────────────────────── */

export interface PresenceState {
  tagId: string;
  scheduleId: string | null;
  isPresent: boolean;
  lastSeenAt: Date;
}

export interface DetectedTransition {
  tagId: string;
  kind: 'BOARD' | 'ALIGHT';
  occurredAt: Date;
  rssiDbm?: number;
  reason: string;
}

export interface DetectorConfig {
  /** RSSI weaker than this is treated as "out of range" for boarding. */
  rssiThresholdDbm: number;       // e.g. -75
  /** Minimum sample count in window to count as a board. Filters drive-bys. */
  minSampleCount: number;         // e.g. 3
  /** How long a tag must be unseen before we declare alighting. */
  presenceGraceSeconds: number;   // e.g. 10
}

export const DEFAULT_DETECTOR: DetectorConfig = {
  rssiThresholdDbm: -75,
  minSampleCount: 3,
  presenceGraceSeconds: 10,
};

/**
 * Pure: given a raw scan window + the prior presence state for each tag,
 * decide which BOARD/ALIGHT transitions to emit.
 *
 * Caller is responsible for persisting the new presence state afterwards.
 */
export function detectTransitions(
  window: RawScanWindow,
  prior: Map<string, PresenceState>,
  config: DetectorConfig = DEFAULT_DETECTOR,
): { transitions: DetectedTransition[]; nextPresence: Map<string, PresenceState> } {
  const transitions: DetectedTransition[] = [];
  const next = new Map<string, PresenceState>();
  const windowEnd = new Date(window.endedAt);

  // 1) Tags seen in this window
  const seenTagIds = new Set<string>();
  for (const obs of window.observations) {
    seenTagIds.add(obs.tagId);
    const inRange = obs.rssiMaxDbm >= config.rssiThresholdDbm;
    const enoughSamples = obs.sampleCount >= config.minSampleCount;

    const wasPresent = prior.get(obs.tagId)?.isPresent === true;
    const lastSeen = new Date(obs.lastSeenAt);

    if (inRange && enoughSamples) {
      // Presence confirmed.
      if (!wasPresent) {
        transitions.push({
          tagId: obs.tagId,
          kind: 'BOARD',
          occurredAt: new Date(obs.firstSeenAt),
          rssiDbm: obs.rssiAvgDbm,
          reason: `${obs.sampleCount} hits at avg ${obs.rssiAvgDbm} dBm`,
        });
      }
      next.set(obs.tagId, {
        tagId: obs.tagId,
        scheduleId: prior.get(obs.tagId)?.scheduleId ?? null,
        isPresent: true,
        lastSeenAt: lastSeen,
      });
    } else {
      // Heard something but too weak / too few — keep prior state, refresh lastSeen.
      next.set(obs.tagId, {
        tagId: obs.tagId,
        scheduleId: prior.get(obs.tagId)?.scheduleId ?? null,
        isPresent: wasPresent,
        lastSeenAt: wasPresent ? (prior.get(obs.tagId)?.lastSeenAt ?? lastSeen) : lastSeen,
      });
    }
  }

  // 2) Tags previously present but absent this window — check grace.
  for (const [tagId, state] of prior) {
    if (seenTagIds.has(tagId)) continue;
    if (!state.isPresent) {
      next.set(tagId, state);
      continue;
    }
    const goneSeconds = (windowEnd.getTime() - state.lastSeenAt.getTime()) / 1000;
    if (goneSeconds >= config.presenceGraceSeconds) {
      transitions.push({
        tagId,
        kind: 'ALIGHT',
        occurredAt: windowEnd,
        reason: `unseen for ${Math.round(goneSeconds)}s (grace ${config.presenceGraceSeconds}s)`,
      });
      next.set(tagId, { ...state, isPresent: false });
    } else {
      // Still inside grace window — preserve presence.
      next.set(tagId, state);
    }
  }

  return { transitions, nextPresence: next };
}
