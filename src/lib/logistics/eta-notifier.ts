/**
 * ETA notifier + recompute service — the impure layer between the pure ETA
 * predictor and the database / notification senders.
 *
 * recomputeShipmentEta() is the heart of Gap #3's "continuous-update"
 * promise: called whenever a fresh GPS ping lands, it loads the shipment's
 * destination + recent tracking history, runs predictEta(), writes the new
 * ETA where the customer-tracking page already reads it (the latest tracking
 * event's metadata.etaAt), and — if the ETA has shifted materially since the
 * customer was last told — sends an SMS + email update.
 *
 * Every external call is best-effort: a failed notification or persist never
 * throws, so a flaky SMS gateway or a slow DB can't break GPS ingestion.
 */

import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { sendSms } from '@/lib/sms';
import {
  predictEta,
  etaDeltaMinutes,
  type EtaPrediction,
  type TrackingPoint,
} from './eta-predictor';
import type { LatLng } from './distance-matrix';

// ── Notify decision ──────────────────────────────────────────────────────────

export interface NotifyDecisionInput {
  prediction: EtaPrediction;
  /** ETA we last told the customer about (from shipment metadata). */
  lastNotifiedEtaAt: string | null;
  /** Shift, in minutes, that counts as "material". Default 15. */
  thresholdMinutes?: number;
}

export interface NotifyDecision {
  notify: boolean;
  reason: string;
  deltaMinutes: number | null;
}

/**
 * Should we proactively message the customer about this ETA?
 *   - Skip planned/arrived/low-confidence predictions — they're either not a
 *     dynamic signal or too uncertain to be worth a buzz.
 *   - Notify on the FIRST confident ETA (customer gets an initial estimate).
 *   - Otherwise notify only when the ETA moved ≥ threshold vs last told.
 * This keeps the customer informed without spamming on every GPS tick.
 */
export function decideNotify(input: NotifyDecisionInput): NotifyDecision {
  const threshold = input.thresholdMinutes ?? 15;
  const p = input.prediction;

  if (!p.etaAt) return { notify: false, reason: 'no ETA produced', deltaMinutes: null };
  if (p.method === 'planned' || p.method === 'arrived') {
    return { notify: false, reason: `method '${p.method}' is not a proactive ETA shift`, deltaMinutes: null };
  }
  if (p.confidence === 'low') {
    return { notify: false, reason: 'confidence too low to notify', deltaMinutes: null };
  }
  if (!input.lastNotifiedEtaAt) {
    return { notify: true, reason: 'first ETA for this shipment', deltaMinutes: null };
  }

  const delta = etaDeltaMinutes(input.lastNotifiedEtaAt, p.etaAt);
  if (delta == null) return { notify: false, reason: 'could not compute delta', deltaMinutes: null };
  if (Math.abs(delta) >= threshold) {
    return { notify: true, reason: `ETA moved ${delta}min (≥ ${threshold})`, deltaMinutes: delta };
  }
  return { notify: false, reason: `ETA moved only ${delta}min (< ${threshold})`, deltaMinutes: delta };
}

// ── Message formatting ───────────────────────────────────────────────────────

function fmtLocalTime(iso: string): string {
  // Display in GST (UTC+4) — the operating region. No timezone lib: add 4h.
  const d = new Date(new Date(iso).getTime() + 4 * 3_600_000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const day = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  return `${day}, ${hh}:${mm} GST`;
}

export function formatEtaSms(args: { shipmentNo: string; destination: string | null; etaAt: string; deltaMinutes: number | null }): string {
  const when = fmtLocalTime(args.etaAt);
  const dir = args.deltaMinutes == null ? '' : args.deltaMinutes > 0 ? ' (delayed)' : ' (earlier)';
  const dest = args.destination ? ` to ${args.destination}` : '';
  return `Fleet360: Shipment ${args.shipmentNo}${dest} is now estimated to arrive ${when}${dir}.`;
}

export function formatEtaEmail(args: { shipmentNo: string; customerName: string | null; destination: string | null; etaAt: string; deltaMinutes: number | null }): { subject: string; text: string; html: string } {
  const when = fmtLocalTime(args.etaAt);
  const dir = args.deltaMinutes == null ? 'estimated' : args.deltaMinutes > 0 ? `delayed by ${args.deltaMinutes} min` : `arriving ${Math.abs(args.deltaMinutes)} min earlier`;
  const dest = args.destination ? ` to ${args.destination}` : '';
  const subject = `Updated ETA for shipment ${args.shipmentNo} — ${when}`;
  const greeting = args.customerName ? `Hi ${args.customerName},` : 'Hello,';
  const text =
    `${greeting}\n\n` +
    `The estimated arrival for your shipment ${args.shipmentNo}${dest} has updated.\n` +
    `New ETA: ${when} (${dir}).\n\n` +
    `You can track it live in your Fleet360 portal.\n\n— Fleet360`;
  const html =
    `<p>${greeting}</p>` +
    `<p>The estimated arrival for your shipment <strong>${args.shipmentNo}</strong>${dest} has updated.</p>` +
    `<p><strong>New ETA: ${when}</strong> (${dir}).</p>` +
    `<p>You can track it live in your Fleet360 portal.</p><p>— Fleet360</p>`;
  return { subject, text, html };
}

// ── Recompute service ────────────────────────────────────────────────────────

interface ShipmentEtaRow {
  shipment_no: string | null;
  destination_name: string | null;
  cargo_owner_name: string | null;
  cargo_owner_email: string | null;
  cargo_owner_phone: string | null;
  delivery_window_to: string | null;
  metadata: Record<string, unknown> | null;
  dest_lat: string | number | null;
  dest_lng: string | number | null;
  dest_planned_at: string | null;
  lane_avg_speed: string | number | null;
}

export interface RecomputeResult {
  prediction: EtaPrediction | null;
  notified: boolean;
  notifyDecision: NotifyDecision | null;
  channels: { email: boolean; sms: boolean };
  reason: string;
}

const EMPTY: RecomputeResult = {
  prediction: null, notified: false, notifyDecision: null,
  channels: { email: false, sms: false }, reason: '',
};

function num(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function recomputeShipmentEta(args: {
  tenantId: string;
  shipmentOrderId: string;
  /** ISO now — injectable for tests. Defaults to current time. */
  now?: string;
  thresholdMinutes?: number;
  /** Skip the actual sends (decision still computed). For dry-run/tests. */
  suppressNotifications?: boolean;
}): Promise<RecomputeResult> {
  const now = args.now ?? new Date().toISOString();

  // 1) Load the shipment + its delivery destination (coords from the last
  //    DELIVERY stop) + customer contact + last-notified ETA from metadata.
  const rows = await prisma.$queryRawUnsafe<ShipmentEtaRow[]>(
    `SELECT s.shipment_no, s.destination_name,
            s.cargo_owner_name, s.cargo_owner_email, s.cargo_owner_phone,
            s.delivery_window_to::text, s.metadata,
            d.latitude::text  AS dest_lat,
            d.longitude::text AS dest_lng,
            d.planned_arrival_at::text AS dest_planned_at,
            (s.metadata->>'laneAverageSpeedKmh') AS lane_avg_speed
       FROM logistics_shipment_orders s
       LEFT JOIN LATERAL (
         SELECT latitude, longitude, planned_arrival_at
           FROM logistics_shipment_stops
          WHERE shipment_order_id = s.id AND tenant_id = s.tenant_id
            AND stop_type = 'DELIVERY'
          ORDER BY sequence_no DESC LIMIT 1
       ) d ON TRUE
      WHERE s.id = $1 AND s.tenant_id = $2 AND s.deleted_at IS NULL
      LIMIT 1`,
    args.shipmentOrderId, args.tenantId,
  ).catch(() => [] as ShipmentEtaRow[]);

  const ship = rows[0];
  if (!ship) return { ...EMPTY, reason: 'shipment not found' };

  const destLat = num(ship.dest_lat);
  const destLng = num(ship.dest_lng);
  const destination: LatLng | null = destLat != null && destLng != null
    ? { latitude: destLat, longitude: destLng } : null;

  // 2) Load recent GPS pings (most recent 10, with coords).
  const eventRows = await prisma.$queryRawUnsafe<Array<{ id: string; latitude: string | number; longitude: string | number; occurred_at: string }>>(
    `SELECT id, latitude::text, longitude::text, occurred_at::text
       FROM logistics_tracking_events
      WHERE shipment_order_id = $1 AND tenant_id = $2
        AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY occurred_at DESC
      LIMIT 10`,
    args.shipmentOrderId, args.tenantId,
  ).catch(() => []);

  const trackingPoints: TrackingPoint[] = eventRows
    .map(e => ({ latitude: num(e.latitude)!, longitude: num(e.longitude)!, occurredAt: e.occurred_at }))
    .filter(p => p.latitude != null && p.longitude != null);

  // 3) Predict.
  const prediction = predictEta({
    trackingPoints,
    destination,
    now,
    plannedArrivalAt: ship.dest_planned_at ?? ship.delivery_window_to,
    laneAverageSpeedKmh: num(ship.lane_avg_speed),
  });

  // 4) Persist the ETA where customer-tracking reads it: the latest event's
  //    metadata.etaAt. (eventRows[0] is the most recent ping.)
  const latestEventId = eventRows[0]?.id ?? null;
  if (prediction.etaAt && latestEventId) {
    await prisma.$executeRawUnsafe(
      `UPDATE logistics_tracking_events
          SET metadata = COALESCE(metadata, '{}'::jsonb)
                       || jsonb_build_object('etaAt', $1::text, 'etaMethod', $2::text, 'etaConfidence', $3::text)
        WHERE id = $4 AND tenant_id = $5`,
      prediction.etaAt, prediction.method, prediction.confidence, latestEventId, args.tenantId,
    ).catch(() => { /* non-fatal */ });
  }

  // 5) Decide + send.
  const lastNotifiedEtaAt = (ship.metadata?.lastNotifiedEtaAt as string | undefined) ?? null;
  const decision = decideNotify({ prediction, lastNotifiedEtaAt, thresholdMinutes: args.thresholdMinutes });

  const channels = { email: false, sms: false };
  if (decision.notify && !args.suppressNotifications && prediction.etaAt) {
    if (ship.cargo_owner_email) {
      const { subject, text, html } = formatEtaEmail({
        shipmentNo: ship.shipment_no ?? args.shipmentOrderId.slice(0, 8),
        customerName: ship.cargo_owner_name,
        destination: ship.destination_name,
        etaAt: prediction.etaAt,
        deltaMinutes: decision.deltaMinutes,
      });
      const res = await sendEmail({ to: ship.cargo_owner_email, subject, text, html }).catch(() => ({ sent: false }));
      channels.email = !!res?.sent;
    }
    if (ship.cargo_owner_phone) {
      const body = formatEtaSms({
        shipmentNo: ship.shipment_no ?? args.shipmentOrderId.slice(0, 8),
        destination: ship.destination_name,
        etaAt: prediction.etaAt,
        deltaMinutes: decision.deltaMinutes,
      });
      const res = await sendSms({ to: ship.cargo_owner_phone, body }).catch(() => ({ sent: false }));
      channels.sms = !!res?.sent;
    }

    // Record what we told the customer so the next recompute compares against it.
    await prisma.$executeRawUnsafe(
      `UPDATE logistics_shipment_orders
          SET metadata = COALESCE(metadata, '{}'::jsonb)
                       || jsonb_build_object('lastNotifiedEtaAt', $1::text, 'lastNotifiedAt', $2::text),
              updated_at = NOW()
        WHERE id = $3 AND tenant_id = $4`,
      prediction.etaAt, now, args.shipmentOrderId, args.tenantId,
    ).catch(() => { /* non-fatal */ });
  }

  return {
    prediction,
    notified: decision.notify && !args.suppressNotifications,
    notifyDecision: decision,
    channels,
    reason: decision.reason,
  };
}
