/**
 * RAC Channel Manager registry + inbound payload normalization.
 *
 * "Channels" are the sources that send us bookings: direct walk-ins, corporate
 * accounts, travel agencies, our own website (ONLINE), and external OTA / fleet
 * partners — most importantly Hala by Careem in the GCC.
 *
 * For inbound integrations we expose a single webhook endpoint per channel:
 *
 *   POST /api/rental/channels/[channel]/webhook
 *
 * Each external channel posts its native booking payload along with an
 * HMAC-SHA256 signature in the `x-channel-signature` header. We verify the
 * signature against the per-channel secret in env, normalize the payload via
 * the channel's adapter, and create a RentalBooking with `channel` set
 * appropriately.
 *
 * Pure functions only — no DB calls.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export type ChannelKey =
  | 'DIRECT'
  | 'CORPORATE'
  | 'AGENCY'
  | 'ONLINE'
  | 'BOOKING_COM'
  | 'EXPEDIA'
  | 'HALA_CAREEM';

export interface ChannelDescriptor {
  key: ChannelKey;
  label: string;
  category: 'internal' | 'ota' | 'fleet';
  /** Whether external partners post bookings into our webhook. */
  supportsInboundWebhook: boolean;
  /** Whether we push rate / availability out (not yet implemented in v1.0). */
  supportsOutboundSync: boolean;
  /** Env var holding the HMAC shared secret for this channel. */
  secretEnvVar: string | null;
  description: string;
}

export const CHANNELS: ChannelDescriptor[] = [
  { key: 'DIRECT',       label: 'Direct (Walk-in)',  category: 'internal', supportsInboundWebhook: false, supportsOutboundSync: false, secretEnvVar: null,                              description: 'Bookings created at the counter or by call.' },
  { key: 'CORPORATE',    label: 'Corporate Account', category: 'internal', supportsInboundWebhook: false, supportsOutboundSync: false, secretEnvVar: null,                              description: 'Negotiated-rate corporate clients.' },
  { key: 'AGENCY',       label: 'Travel Agency',     category: 'internal', supportsInboundWebhook: false, supportsOutboundSync: false, secretEnvVar: null,                              description: 'Inbound from offline travel agencies.' },
  { key: 'ONLINE',       label: 'Our Website',       category: 'internal', supportsInboundWebhook: false, supportsOutboundSync: false, secretEnvVar: null,                              description: 'Direct online bookings via our brand site.' },
  { key: 'BOOKING_COM',  label: 'Booking.com',       category: 'ota',      supportsInboundWebhook: true,  supportsOutboundSync: false, secretEnvVar: 'BOOKING_COM_WEBHOOK_SECRET',      description: 'Booking.com OTA — inbound only in v1.0.' },
  { key: 'EXPEDIA',      label: 'Expedia',           category: 'ota',      supportsInboundWebhook: true,  supportsOutboundSync: false, secretEnvVar: 'EXPEDIA_WEBHOOK_SECRET',          description: 'Expedia / EAN — inbound only in v1.0.' },
  { key: 'HALA_CAREEM',  label: 'Hala by Careem',    category: 'fleet',    supportsInboundWebhook: true,  supportsOutboundSync: false, secretEnvVar: 'HALA_CAREEM_WEBHOOK_SECRET',      description: 'Careem Hala fleet partner — daily rentals from the Hala app.' },
];

const CHANNEL_BY_KEY = new Map(CHANNELS.map((c) => [c.key, c]));

export function getChannel(key: string): ChannelDescriptor | undefined {
  return CHANNEL_BY_KEY.get(key.toUpperCase() as ChannelKey);
}

/** Constant-time HMAC-SHA256 verification. */
export function verifyChannelSignature(
  secret: string,
  rawBody: string,
  signatureHex: string | null,
): boolean {
  if (!signatureHex) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  // Both must be the same length for timingSafeEqual. Reject if not.
  if (expected.length !== signatureHex.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

/* ── Normalized booking shape we ingest into RentalBooking ─────────────── */

export interface NormalizedChannelBooking {
  /** Reference assigned by the channel — used for dedup. */
  externalRef: string;
  customer: {
    fullName: string;
    phone?: string | null;
    email?: string | null;
    nationality?: string | null;
  };
  vehicleCategory: string | null;
  pickupDate: Date;
  dropoffDate: Date;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  dailyRate: number | null;
  totalAmount: number | null;
  currency: string;
  notes: string | null;
}

/* ── Per-channel adapters ──────────────────────────────────────────────── */

/** Raw payload shape Hala by Careem sends. Documented from partner integration spec. */
export interface HalaCareemPayload {
  bookingId: string;
  customer: { name: string; phoneNumber?: string; email?: string };
  vehicle: { category: string };
  pickup: { datetime: string; location?: string };
  dropoff: { datetime: string; location?: string };
  pricing: { dailyRate?: number; totalAmount?: number; currency?: string };
  notes?: string;
}

export function normalizeHalaCareem(p: HalaCareemPayload): NormalizedChannelBooking {
  return {
    externalRef: `HALA-${p.bookingId}`,
    customer: {
      fullName: p.customer.name,
      phone: p.customer.phoneNumber ?? null,
      email: p.customer.email ?? null,
    },
    vehicleCategory: p.vehicle.category,
    pickupDate: new Date(p.pickup.datetime),
    dropoffDate: new Date(p.dropoff.datetime),
    pickupLocation: p.pickup.location ?? null,
    dropoffLocation: p.dropoff.location ?? null,
    dailyRate: p.pricing.dailyRate ?? null,
    totalAmount: p.pricing.totalAmount ?? null,
    currency: p.pricing.currency ?? 'AED',
    notes: p.notes ?? null,
  };
}

/** Generic OTA payload (Booking.com / Expedia adapter — minimal schema). */
export interface GenericOtaPayload {
  reservation_id: string;
  guest: { name: string; phone?: string; email?: string; nationality?: string };
  rate_plan: { category: string; daily_rate?: number; total?: number; currency?: string };
  pickup_at: string;
  dropoff_at: string;
  pickup_location?: string;
  dropoff_location?: string;
  remarks?: string;
}

export function normalizeGenericOta(prefix: string, p: GenericOtaPayload): NormalizedChannelBooking {
  return {
    externalRef: `${prefix}-${p.reservation_id}`,
    customer: {
      fullName: p.guest.name,
      phone: p.guest.phone ?? null,
      email: p.guest.email ?? null,
      nationality: p.guest.nationality ?? null,
    },
    vehicleCategory: p.rate_plan.category,
    pickupDate: new Date(p.pickup_at),
    dropoffDate: new Date(p.dropoff_at),
    pickupLocation: p.pickup_location ?? null,
    dropoffLocation: p.dropoff_location ?? null,
    dailyRate: p.rate_plan.daily_rate ?? null,
    totalAmount: p.rate_plan.total ?? null,
    currency: p.rate_plan.currency ?? 'AED',
    notes: p.remarks ?? null,
  };
}

/** Dispatch raw payload to the right adapter. Throws on unknown channel. */
export function normalizeChannelPayload(channel: ChannelKey, raw: unknown): NormalizedChannelBooking {
  switch (channel) {
    case 'HALA_CAREEM':
      return normalizeHalaCareem(raw as HalaCareemPayload);
    case 'BOOKING_COM':
      return normalizeGenericOta('BDC', raw as GenericOtaPayload);
    case 'EXPEDIA':
      return normalizeGenericOta('EXP', raw as GenericOtaPayload);
    default:
      throw new Error(`Channel ${channel} does not support inbound webhooks`);
  }
}
