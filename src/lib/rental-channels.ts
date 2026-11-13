/**
 * RAC Channel Manager registry, inbound OTA lifecycle payload normalization,
 * tenant-scoped webhook URL builder, and outbound ARI (Availability, Rates &
 * Inventory) feed builder + HMAC-SHA256 signer.
 *
 * Supported UAE & Global OTA / Mobility Channels:
 *   - Internal: DIRECT, CORPORATE, AGENCY, ONLINE
 *   - Global OTAs: RENTALCARS_COM (Booking.com Cars), BOOKING_COM, CARRENTALS_COM (Expedia), EXPEDIA, KAYAK, VIPCARS
 *   - UAE Marketplaces & Mobility: YANGO_DRIVE, SELFDRIVE_AE, ONECLICKDRIVE, HALA_CAREEM, DIRECT_API
 *
 * Pure functions only — no DB or network calls.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeRentalCategory } from '@/lib/rental-yield-engine';

export type ChannelKey =
  | 'DIRECT'
  | 'CORPORATE'
  | 'AGENCY'
  | 'ONLINE'
  | 'RENTALCARS_COM'
  | 'BOOKING_COM'
  | 'CARRENTALS_COM'
  | 'EXPEDIA'
  | 'KAYAK'
  | 'VIPCARS'
  | 'YANGO_DRIVE'
  | 'SELFDRIVE_AE'
  | 'ONECLICKDRIVE'
  | 'HALA_CAREEM'
  | 'DIRECT_API';

export type ChannelWebhookEventType =
  | 'BOOKING_CREATED'
  | 'BOOKING_MODIFIED'
  | 'BOOKING_CANCELLED';

export interface ChannelDescriptor {
  key: ChannelKey;
  label: string;
  category: 'internal' | 'ota' | 'fleet';
  /** Prefix prepended to external reservation IDs when not already prefixed. */
  refPrefix: string;
  /** Whether external partners post bookings/modifications/cancellations into our webhook. */
  supportsInboundWebhook: boolean;
  /** Whether we push live Availability, Rates & Inventory (ARI) snapshots out. */
  supportsOutboundSync: boolean;
  /** Env var holding the platform fallback HMAC master secret for this channel. */
  secretEnvVar: string | null;
  description: string;
}

export const CHANNELS: ChannelDescriptor[] = [
  {
    key: 'DIRECT',
    label: 'Direct (Walk-in)',
    category: 'internal',
    refPrefix: 'DIR',
    supportsInboundWebhook: false,
    supportsOutboundSync: false,
    secretEnvVar: null,
    description: 'Bookings created at the branch counter or reservation desk.',
  },
  {
    key: 'CORPORATE',
    label: 'Corporate Account',
    category: 'internal',
    refPrefix: 'CORP',
    supportsInboundWebhook: false,
    supportsOutboundSync: false,
    secretEnvVar: null,
    description: 'Contracted corporate B2B accounts with negotiated tariffs.',
  },
  {
    key: 'AGENCY',
    label: 'Travel Agency',
    category: 'internal',
    refPrefix: 'AGY',
    supportsInboundWebhook: false,
    supportsOutboundSync: false,
    secretEnvVar: null,
    description: 'Inbound reservations from travel desks, hotels, and tour operators.',
  },
  {
    key: 'ONLINE',
    label: 'Brand Website',
    category: 'internal',
    refPrefix: 'WEB',
    supportsInboundWebhook: false,
    supportsOutboundSync: false,
    secretEnvVar: null,
    description: 'Direct retail bookings placed on the operator web & mobile portal.',
  },
  {
    key: 'RENTALCARS_COM',
    label: 'Rentalcars.com (Booking.com Cars)',
    category: 'ota',
    refPrefix: 'RC',
    supportsInboundWebhook: true,
    supportsOutboundSync: true,
    secretEnvVar: 'RENTALCARS_COM_WEBHOOK_SECRET',
    description: 'Booking Holdings global car rental aggregator — full lifecycle webhooks & outbound ARI sync.',
  },
  {
    key: 'BOOKING_COM',
    label: 'Booking.com',
    category: 'ota',
    refPrefix: 'BDC',
    supportsInboundWebhook: true,
    supportsOutboundSync: true,
    secretEnvVar: 'BOOKING_COM_WEBHOOK_SECRET',
    description: 'Booking.com OTA accommodations + car hire bundle channel with ARI push.',
  },
  {
    key: 'CARRENTALS_COM',
    label: 'CarRentals.com (Expedia Group)',
    category: 'ota',
    refPrefix: 'CRC',
    supportsInboundWebhook: true,
    supportsOutboundSync: true,
    secretEnvVar: 'CARRENTALS_COM_WEBHOOK_SECRET',
    description: 'Expedia Group CarRentals.com marketplace — inbound reservations & outbound ARI sync.',
  },
  {
    key: 'EXPEDIA',
    label: 'Expedia',
    category: 'ota',
    refPrefix: 'EXP',
    supportsInboundWebhook: true,
    supportsOutboundSync: true,
    secretEnvVar: 'EXPEDIA_WEBHOOK_SECRET',
    description: 'Expedia / EAN global travel distribution with live ARI rate & inventory push.',
  },
  {
    key: 'KAYAK',
    label: 'KAYAK',
    category: 'ota',
    refPrefix: 'KYK',
    supportsInboundWebhook: true,
    supportsOutboundSync: true,
    secretEnvVar: 'KAYAK_WEBHOOK_SECRET',
    description: 'KAYAK & Momondo metasearch instant-book connectivity and ARI feed.',
  },
  {
    key: 'VIPCARS',
    label: 'VIPCars',
    category: 'ota',
    refPrefix: 'VIP',
    supportsInboundWebhook: true,
    supportsOutboundSync: true,
    secretEnvVar: 'VIPCARS_WEBHOOK_SECRET',
    description: 'VIPCars international broker popular for DXB/AUH airport tourist arrivals.',
  },
  {
    key: 'YANGO_DRIVE',
    label: 'Yango Drive',
    category: 'ota',
    refPrefix: 'YNG',
    supportsInboundWebhook: true,
    supportsOutboundSync: true,
    secretEnvVar: 'YANGO_DRIVE_WEBHOOK_SECRET',
    description: 'Yango Drive UAE super-app daily & weekly car rental marketplace.',
  },
  {
    key: 'SELFDRIVE_AE',
    label: 'SelfDrive.ae',
    category: 'ota',
    refPrefix: 'SDA',
    supportsInboundWebhook: true,
    supportsOutboundSync: true,
    secretEnvVar: 'SELFDRIVE_AE_WEBHOOK_SECRET',
    description: 'SelfDrive.ae UAE on-demand daily, weekly & micro-lease mobility platform.',
  },
  {
    key: 'ONECLICKDRIVE',
    label: 'OneClickDrive',
    category: 'ota',
    refPrefix: 'OCD',
    supportsInboundWebhook: true,
    supportsOutboundSync: true,
    secretEnvVar: 'ONECLICKDRIVE_WEBHOOK_SECRET',
    description: 'OneClickDrive UAE car rental marketplace — economy, SUV & luxury fleet listings.',
  },
  {
    key: 'HALA_CAREEM',
    label: 'Hala by Careem',
    category: 'fleet',
    refPrefix: 'HALA',
    supportsInboundWebhook: true,
    supportsOutboundSync: true,
    secretEnvVar: 'HALA_CAREEM_WEBHOOK_SECRET',
    description: 'Careem super-app fleet partner — daily rentals & ARI availability sync in the UAE.',
  },
  {
    key: 'DIRECT_API',
    label: 'Direct Partner API',
    category: 'ota',
    refPrefix: 'API',
    supportsInboundWebhook: true,
    supportsOutboundSync: true,
    secretEnvVar: 'DIRECT_API_WEBHOOK_SECRET',
    description: 'Standardized REST/Webhook integration for B2B travel portals, airlines & GSA partners.',
  },
];

const CHANNEL_BY_KEY = new Map<string, ChannelDescriptor>(
  CHANNELS.map((c) => [c.key, c]),
);

const CHANNEL_ALIASES: Record<string, ChannelKey> = {
  'RENTALCARS': 'RENTALCARS_COM',
  'RENTALCARS.COM': 'RENTALCARS_COM',
  'RENTALCARS-COM': 'RENTALCARS_COM',
  'BOOKING.COM': 'BOOKING_COM',
  'BOOKING-COM': 'BOOKING_COM',
  'CARRENTALS': 'CARRENTALS_COM',
  'CARRENTALS.COM': 'CARRENTALS_COM',
  'CARRENTALS-COM': 'CARRENTALS_COM',
  'YANGO': 'YANGO_DRIVE',
  'YANGO-DRIVE': 'YANGO_DRIVE',
  'SELFDRIVE': 'SELFDRIVE_AE',
  'SELFDRIVE.AE': 'SELFDRIVE_AE',
  'SELFDRIVE-AE': 'SELFDRIVE_AE',
  'ONECLICKDRIVE.COM': 'ONECLICKDRIVE',
  'ONE-CLICK-DRIVE': 'ONECLICKDRIVE',
  'HALA-CAREEM': 'HALA_CAREEM',
  'CAREEM': 'HALA_CAREEM',
  'DIRECT-API': 'DIRECT_API',
};

export function getChannel(key: string): ChannelDescriptor | undefined {
  const norm = String(key ?? '').trim().toUpperCase();
  if (!norm) return undefined;
  const direct = CHANNEL_BY_KEY.get(norm);
  if (direct) return direct;
  const underscored = norm.replace(/[.-]/g, '_');
  const byUnderscore = CHANNEL_BY_KEY.get(underscored);
  if (byUnderscore) return byUnderscore;
  const aliased = CHANNEL_ALIASES[norm];
  return aliased ? CHANNEL_BY_KEY.get(aliased) : undefined;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Builds the canonical tenant-scoped inbound OTA webhook URL.
 * Middleware strips client-supplied `x-tenant-id`, so `?tenantId=` (or `X-OTA-Tenant-Id`)
 * is mandatory for external OTA partners to target the right tenant deterministically.
 */
export function buildChannelWebhookUrl(
  baseUrl: string,
  channelKey: string,
  tenantId: string,
): string {
  const cleanBase = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  const cleanChannel = String(channelKey ?? '').trim().toLowerCase();
  return `${cleanBase}/api/rental/channels/${cleanChannel}/webhook?tenantId=${encodeURIComponent(tenantId)}`;
}

/** Constant-time HMAC-SHA256 verification. */
export function verifyChannelSignature(
  secret: string,
  rawBody: string,
  signatureHex: string | null,
): boolean {
  if (!secret || !signatureHex) return false;
  const cleanedSig = signatureHex.trim().replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleanedSig)) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  if (expected.length !== cleanedSig.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(cleanedSig, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Signs an outbound ARI JSON payload with HMAC-SHA256 (`hex` digest).
 */
export function signOutboundAriPayload(payloadJson: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadJson, 'utf8').digest('hex');
}

export interface OutboundAriCategoryInput {
  category: string;
  availableUnits: number;
  totalUnits: number;
  baseDailyRate: number;
  weeklyRate: number | null;
  monthlyRate: number | null;
  currency: string;
}

export interface OutboundAriCategoryLine {
  category: string;
  availableUnits: number;
  totalUnits: number;
  utilizationPct: number;
  status: 'OPEN' | 'STOP_SELL';
  baseDailyRate: number;
  channelDailyRate: number;
  weeklyRate: number | null;
  channelWeeklyRate: number | null;
  monthlyRate: number | null;
  channelMonthlyRate: number | null;
  vatPct: number;
  currency: string;
}

export interface OutboundAriPayload {
  schemaVersion: 'fleet360.rac.ari.v1';
  event: 'ARI_SNAPSHOT';
  tenantId: string;
  channelKey: string;
  generatedAt: string;
  markupPct: number;
  summary: {
    totalCategories: number;
    totalUnits: number;
    availableUnits: number;
    openCategories: number;
    stopSellCategories: number;
  };
  categories: OutboundAriCategoryLine[];
}

/**
 * Builds a standardized OTA Availability, Rates & Inventory (ARI) payload,
 * applying the channel `markupPct` (`rate * (1 + markupPct / 100)`) across
 * daily, weekly, and monthly tariffs.
 */
export function buildOutboundAriPayload(args: {
  tenantId: string;
  channelKey: string;
  markupPct?: number;
  generatedAt?: string;
  categories: OutboundAriCategoryInput[];
}): OutboundAriPayload {
  const markupPct = Number.isFinite(Number(args.markupPct)) ? round2(Number(args.markupPct)) : 0;
  const factor = Math.max(0, 1 + markupPct / 100);
  const generatedAt = args.generatedAt ?? new Date().toISOString();

  const categories: OutboundAriCategoryLine[] = (args.categories ?? []).map((item) => {
    const totalUnits = Math.max(0, Math.floor(Number(item.totalUnits ?? 0)));
    const availableUnits = Math.min(totalUnits, Math.max(0, Math.floor(Number(item.availableUnits ?? 0))));
    const utilizationPct =
      totalUnits > 0 ? Math.min(100, Math.round(((totalUnits - availableUnits) / totalUnits) * 100)) : 0;

    const baseDailyRate = Math.max(0, round2(Number(item.baseDailyRate ?? 0)));
    const channelDailyRate = round2(baseDailyRate * factor);

    const weeklyRate =
      item.weeklyRate != null && Number.isFinite(Number(item.weeklyRate))
        ? Math.max(0, round2(Number(item.weeklyRate)))
        : null;
    const channelWeeklyRate = weeklyRate != null ? round2(weeklyRate * factor) : null;

    const monthlyRate =
      item.monthlyRate != null && Number.isFinite(Number(item.monthlyRate))
        ? Math.max(0, round2(Number(item.monthlyRate)))
        : null;
    const channelMonthlyRate = monthlyRate != null ? round2(monthlyRate * factor) : null;

    return {
      category: normalizeRentalCategory(item.category) || item.category.toUpperCase(),
      availableUnits,
      totalUnits,
      utilizationPct,
      status: availableUnits > 0 && channelDailyRate > 0 ? 'OPEN' : 'STOP_SELL',
      baseDailyRate,
      channelDailyRate,
      weeklyRate,
      channelWeeklyRate,
      monthlyRate,
      channelMonthlyRate,
      vatPct: 5,
      currency: item.currency || 'AED',
    };
  });

  const totalUnits = categories.reduce((sum, c) => sum + c.totalUnits, 0);
  const availableUnits = categories.reduce((sum, c) => sum + c.availableUnits, 0);
  const openCategories = categories.filter((c) => c.status === 'OPEN').length;

  return {
    schemaVersion: 'fleet360.rac.ari.v1',
    event: 'ARI_SNAPSHOT',
    tenantId: args.tenantId,
    channelKey: args.channelKey.toUpperCase(),
    generatedAt,
    markupPct,
    summary: {
      totalCategories: categories.length,
      totalUnits,
      availableUnits,
      openCategories,
      stopSellCategories: categories.length - openCategories,
    },
    categories,
  };
}

/**
 * Validates an outbound partner webhook URL to prevent SSRF against loopback,
 * RFC1918 private networks, link-local, or cloud instance metadata endpoints.
 */
export function validateOutboundWebhookUrl(rawUrl: unknown): string | null {
  if (rawUrl === null || rawUrl === undefined || rawUrl === '') return null;
  if (typeof rawUrl !== 'string') {
    throw new Error('outboundWebhookUrl must be a string');
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (trimmed.length > 1024) {
    throw new Error('outboundWebhookUrl exceeds maximum length (1024 characters)');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('outboundWebhookUrl must be a valid URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('outboundWebhookUrl must use https://');
  }
  if (parsed.username || parsed.password) {
    throw new Error('outboundWebhookUrl must not embed credentials');
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('::ffff:127.') ||
    host.startsWith('::ffff:10.') ||
    host.startsWith('::ffff:192.168.') ||
    host.startsWith('::ffff:169.254.')
  ) {
    throw new Error('outboundWebhookUrl cannot target loopback, internal, or metadata hosts');
  }

  // Check IPv4 literals for loopback, private, link-local, or multicast ranges
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1, 5).map(Number);
    if (octets.some((o) => o < 0 || o > 255)) {
      throw new Error('outboundWebhookUrl contains an invalid IPv4 address');
    }
    const [a, b] = octets;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    ) {
      throw new Error('outboundWebhookUrl cannot target private, loopback, or link-local IPv4 addresses');
    }
  }

  return parsed.toString();
}

/* ── Normalized booking & lifecycle shapes we ingest into RentalBooking ── */

export interface NormalizedChannelBooking {
  /** Lifecycle event type (`BOOKING_CREATED` | `BOOKING_MODIFIED` | `BOOKING_CANCELLED`). */
  eventType?: ChannelWebhookEventType;
  /** Reference assigned by the channel — used for dedup & lifecycle lookup. */
  externalRef: string;
  customer: {
    fullName: string;
    phone?: string | null;
    email?: string | null;
    nationality?: string | null;
  };
  vehicleCategory: string | null;
  vehicleId?: string | null;
  pickupDate: Date;
  dropoffDate: Date;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  dailyRate: number | null;
  totalAmount: number | null;
  currency: string;
  notes: string | null;
  cancellationReason?: string | null;
}

export interface NormalizedChannelWebhookEvent {
  eventType: ChannelWebhookEventType;
  externalRef: string;
  rawExternalId: string;
  customer: {
    fullName: string | null;
    phone: string | null;
    email: string | null;
    nationality: string | null;
  };
  vehicleCategory: string | null;
  vehicleId: string | null;
  pickupDate: Date | null;
  dropoffDate: Date | null;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  dailyRate: number | null;
  totalAmount: number | null;
  currency: string;
  notes: string | null;
  cancellationReason: string | null;
}

/* ── Per-channel adapters ──────────────────────────────────────────────── */

/** Raw payload shape Hala by Careem sends. Documented from partner integration spec. */
export interface HalaCareemPayload {
  bookingId: string;
  eventType?: string;
  customer?: { name: string; phoneNumber?: string; email?: string };
  vehicle?: { category?: string; vehicleId?: string };
  pickup?: { datetime?: string; location?: string };
  dropoff?: { datetime?: string; location?: string };
  pricing?: { dailyRate?: number; totalAmount?: number; currency?: string };
  notes?: string;
  cancellationReason?: string;
}

export function normalizeHalaCareem(p: HalaCareemPayload): NormalizedChannelBooking {
  const rawId = String(p.bookingId ?? '').trim();
  const externalRef = rawId.toUpperCase().startsWith('HALA-') ? rawId : `HALA-${rawId}`;
  return {
    eventType: resolveEventType(p as unknown as Record<string, unknown>),
    externalRef,
    customer: {
      fullName: p.customer?.name ?? '',
      phone: p.customer?.phoneNumber ?? null,
      email: p.customer?.email ?? null,
    },
    vehicleCategory: p.vehicle?.category ?? null,
    vehicleId: p.vehicle?.vehicleId ?? null,
    pickupDate: new Date(p.pickup?.datetime ?? ''),
    dropoffDate: new Date(p.dropoff?.datetime ?? ''),
    pickupLocation: p.pickup?.location ?? null,
    dropoffLocation: p.dropoff?.location ?? null,
    dailyRate: p.pricing?.dailyRate ?? null,
    totalAmount: p.pricing?.totalAmount ?? null,
    currency: p.pricing?.currency ?? 'AED',
    notes: p.notes ?? null,
    cancellationReason: p.cancellationReason ?? null,
  };
}

/** Generic OTA payload (Booking.com / Expedia / aggregator adapter). */
export interface GenericOtaPayload {
  reservation_id: string;
  event?: string;
  guest?: { name: string; phone?: string; email?: string; nationality?: string };
  rate_plan?: { category?: string; daily_rate?: number; total?: number; currency?: string };
  pickup_at?: string;
  dropoff_at?: string;
  pickup_location?: string;
  dropoff_location?: string;
  vehicle_id?: string;
  remarks?: string;
  cancellation_reason?: string;
}

export function normalizeGenericOta(prefix: string, p: GenericOtaPayload): NormalizedChannelBooking {
  const rawId = String(p.reservation_id ?? '').trim();
  const upperPrefix = `${prefix.toUpperCase()}-`;
  const externalRef = rawId.toUpperCase().startsWith(upperPrefix) ? rawId : `${prefix}-${rawId}`;
  return {
    eventType: resolveEventType(p as unknown as Record<string, unknown>),
    externalRef,
    customer: {
      fullName: p.guest?.name ?? '',
      phone: p.guest?.phone ?? null,
      email: p.guest?.email ?? null,
      nationality: p.guest?.nationality ?? null,
    },
    vehicleCategory: p.rate_plan?.category ?? null,
    vehicleId: p.vehicle_id ?? null,
    pickupDate: new Date(p.pickup_at ?? ''),
    dropoffDate: new Date(p.dropoff_at ?? ''),
    pickupLocation: p.pickup_location ?? null,
    dropoffLocation: p.dropoff_location ?? null,
    dailyRate: p.rate_plan?.daily_rate ?? null,
    totalAmount: p.rate_plan?.total ?? null,
    currency: p.rate_plan?.currency ?? 'AED',
    notes: p.remarks ?? null,
    cancellationReason: p.cancellation_reason ?? null,
  };
}

function asStr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

function asNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function resolveEventType(obj: Record<string, unknown>): ChannelWebhookEventType {
  const raw = String(
    obj.eventType ?? obj.event_type ?? obj.event ?? obj.action ?? obj.type ?? obj.status ?? '',
  )
    .trim()
    .toUpperCase();

  if (
    raw === 'BOOKING_CANCELLED' ||
    raw === 'BOOKING_CANCELED' ||
    raw === 'RESERVATION_CANCELLED' ||
    raw === 'RESERVATION_CANCELED' ||
    raw === 'CANCELLED' ||
    raw === 'CANCELED' ||
    raw === 'CANCEL'
  ) {
    return 'BOOKING_CANCELLED';
  }

  if (
    raw === 'BOOKING_MODIFIED' ||
    raw === 'RESERVATION_UPDATED' ||
    raw === 'RESERVATION_MODIFIED' ||
    raw === 'BOOKING_UPDATED' ||
    raw === 'MODIFIED' ||
    raw === 'UPDATED' ||
    raw === 'AMENDED'
  ) {
    return 'BOOKING_MODIFIED';
  }

  return 'BOOKING_CREATED';
}

/**
 * Normalizes any supported external OTA or mobility partner webhook payload
 * across `BOOKING_CREATED`, `BOOKING_MODIFIED`, and `BOOKING_CANCELLED` events.
 */
export function normalizeChannelWebhookEvent(
  channel: ChannelKey,
  raw: unknown,
): NormalizedChannelWebhookEvent {
  const descriptor = getChannel(channel);
  if (!descriptor || !descriptor.supportsInboundWebhook) {
    throw new Error(`Channel ${channel} does not support inbound webhooks`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Webhook payload must be a JSON object');
  }

  const obj = raw as Record<string, unknown>;
  const eventType = resolveEventType(obj);

  const rawId =
    asStr(obj.externalRef) ??
    asStr(obj.external_ref) ??
    asStr(obj.reservation_id) ??
    asStr(obj.reservationId) ??
    asStr(obj.bookingId) ??
    asStr(obj.booking_id) ??
    asStr(obj.bookingRef) ??
    asStr(obj.booking_ref) ??
    asStr(obj.orderId) ??
    asStr(obj.order_id) ??
    (typeof obj.id === 'string' || typeof obj.id === 'number' ? String(obj.id).trim() : null) ??
    '';

  if (!rawId) {
    throw new Error('Missing booking/reservation identifier in channel webhook payload');
  }

  const prefix = descriptor.refPrefix;
  const externalRef =
    rawId.toUpperCase().startsWith(`${prefix}-`) || rawId.toUpperCase().startsWith('RBK-')
      ? rawId
      : `${prefix}-${rawId}`;

  const guestObj = (obj.customer ?? obj.guest ?? obj.renter ?? obj.driver ?? {}) as Record<
    string,
    unknown
  >;
  const vehicleObj = (obj.vehicle ?? {}) as Record<string, unknown>;
  const ratePlanObj = (obj.rate_plan ?? obj.ratePlan ?? obj.pricing ?? {}) as Record<
    string,
    unknown
  >;
  const pickupObj = typeof obj.pickup === 'object' && obj.pickup ? (obj.pickup as Record<string, unknown>) : null;
  const dropoffObj = typeof obj.dropoff === 'object' && obj.dropoff ? (obj.dropoff as Record<string, unknown>) : null;

  const fullName =
    asStr(guestObj.fullName) ??
    asStr(guestObj.full_name) ??
    asStr(guestObj.name) ??
    asStr(obj.customerName) ??
    asStr(obj.guestName);

  const phone =
    asStr(guestObj.phone) ??
    asStr(guestObj.phoneNumber) ??
    asStr(guestObj.phone_number) ??
    asStr(guestObj.mobile);

  const email = asStr(guestObj.email);
  const nationality = asStr(guestObj.nationality) ?? asStr(guestObj.country);

  const rawCategory =
    asStr(obj.vehicleCategory) ??
    asStr(obj.vehicle_category) ??
    asStr(obj.category) ??
    asStr(obj.carGroup) ??
    asStr(vehicleObj.category) ??
    asStr(ratePlanObj.category);

  const vehicleCategory = rawCategory
    ? normalizeRentalCategory(rawCategory) || rawCategory.toUpperCase()
    : null;

  const vehicleId =
    asStr(obj.vehicleId) ??
    asStr(obj.vehicle_id) ??
    asStr(vehicleObj.vehicleId) ??
    asStr(vehicleObj.id);

  const pickupStr =
    asStr(obj.pickupDate) ??
    asStr(obj.pickup_date) ??
    asStr(obj.pickup_at) ??
    asStr(obj.pickupAt) ??
    asStr(obj.startDate) ??
    asStr(pickupObj?.datetime) ??
    asStr(pickupObj?.at);

  const dropoffStr =
    asStr(obj.dropoffDate) ??
    asStr(obj.dropoff_date) ??
    asStr(obj.dropoff_at) ??
    asStr(obj.dropoffAt) ??
    asStr(obj.endDate) ??
    asStr(dropoffObj?.datetime) ??
    asStr(dropoffObj?.at);

  const pickupDate = pickupStr ? new Date(pickupStr) : null;
  const dropoffDate = dropoffStr ? new Date(dropoffStr) : null;

  const pickupLocation =
    asStr(obj.pickupLocation) ??
    asStr(obj.pickup_location) ??
    asStr(pickupObj?.location) ??
    asStr(pickupObj?.branch);

  const dropoffLocation =
    asStr(obj.dropoffLocation) ??
    asStr(obj.dropoff_location) ??
    asStr(dropoffObj?.location) ??
    asStr(dropoffObj?.branch);

  const dailyRate =
    asNum(obj.dailyRate) ??
    asNum(obj.daily_rate) ??
    asNum(ratePlanObj.dailyRate) ??
    asNum(ratePlanObj.daily_rate);

  const totalAmount =
    asNum(obj.totalAmount) ??
    asNum(obj.total_amount) ??
    asNum(ratePlanObj.totalAmount) ??
    asNum(ratePlanObj.total_amount) ??
    asNum(ratePlanObj.total);

  const currency =
    asStr(obj.currency) ?? asStr(ratePlanObj.currency) ?? 'AED';

  const notes = asStr(obj.notes) ?? asStr(obj.remarks);
  const cancellationReason =
    asStr(obj.cancellationReason) ??
    asStr(obj.cancellation_reason) ??
    asStr(obj.reason);

  return {
    eventType,
    externalRef,
    rawExternalId: rawId,
    customer: {
      fullName,
      phone,
      email,
      nationality,
    },
    vehicleCategory,
    vehicleId,
    pickupDate,
    dropoffDate,
    pickupLocation,
    dropoffLocation,
    dailyRate,
    totalAmount,
    currency,
    notes,
    cancellationReason,
  };
}

/** Dispatch raw payload to the channel adapter. Throws on unsupported channel. */
export function normalizeChannelPayload(channel: ChannelKey, raw: unknown): NormalizedChannelBooking {
  const ev = normalizeChannelWebhookEvent(channel, raw);
  return {
    eventType: ev.eventType,
    externalRef: ev.externalRef,
    customer: {
      fullName: ev.customer.fullName ?? '',
      phone: ev.customer.phone,
      email: ev.customer.email,
      nationality: ev.customer.nationality,
    },
    vehicleCategory: ev.vehicleCategory,
    vehicleId: ev.vehicleId,
    pickupDate: ev.pickupDate ?? new Date('Invalid'),
    dropoffDate: ev.dropoffDate ?? new Date('Invalid'),
    pickupLocation: ev.pickupLocation,
    dropoffLocation: ev.dropoffLocation,
    dailyRate: ev.dailyRate,
    totalAmount: ev.totalAmount,
    currency: ev.currency,
    notes: ev.notes,
    cancellationReason: ev.cancellationReason,
  };
}
