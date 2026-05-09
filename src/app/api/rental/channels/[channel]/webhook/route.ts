/**
 * POST /api/rental/channels/[channel]/webhook
 *
 * Inbound channel webhook. External partners (Hala by Careem, Booking.com,
 * Expedia, ...) post their native booking payload here. We:
 *
 *   1. Verify HMAC-SHA256 signature in `x-channel-signature` header against
 *      the per-channel shared secret in env (e.g. HALA_CAREEM_WEBHOOK_SECRET).
 *   2. Normalize the payload via the channel adapter.
 *   3. Upsert a RentalBooking — dedup is by (channel, externalRef) stored
 *      verbatim in `bookingRef`. This keeps the v1.0 schema unchanged.
 *   4. Find-or-create a RentalCustomer by phone OR email match.
 *   5. Audit-log + return { ok, bookingId, status }.
 *
 * Failures never throw 5xx into the partner — we log to Sentry and return
 * a structured 200 with the failure reason. Partners that retry on 5xx will
 * otherwise hammer us during transient issues.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  getChannel,
  normalizeChannelPayload,
  verifyChannelSignature,
  type ChannelKey,
  type NormalizedChannelBooking,
} from '@/lib/rental-channels';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ channel: string }> }) {
  const { channel: channelParam } = await params;
  const descriptor = getChannel(channelParam);

  if (!descriptor) {
    return NextResponse.json({ ok: false, error: `Unknown channel: ${channelParam}` }, { status: 404 });
  }
  if (!descriptor.supportsInboundWebhook) {
    return NextResponse.json({ ok: false, error: `Channel ${descriptor.key} does not accept inbound webhooks` }, { status: 400 });
  }

  // Signature verification — read raw body so HMAC is computed against bytes
  // exactly as sent.
  const rawBody = await req.text();
  const signature = req.headers.get('x-channel-signature');
  const secret = descriptor.secretEnvVar ? process.env[descriptor.secretEnvVar] : null;

  if (!secret) {
    captureException(new Error(`Channel ${descriptor.key} webhook hit but ${descriptor.secretEnvVar} not configured`), {
      context: 'rental.channels.webhook.no_secret',
      tags: { channel: descriptor.key },
    });
    return NextResponse.json({ ok: false, error: 'Channel not configured on this environment' }, { status: 503 });
  }
  if (!verifyChannelSignature(secret, rawBody, signature)) {
    return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON payload' }, { status: 400 });
  }

  let normalized: NormalizedChannelBooking;
  try {
    normalized = normalizeChannelPayload(descriptor.key as ChannelKey, payload);
  } catch (err) {
    captureException(err, { context: 'rental.channels.webhook.normalize', tags: { channel: descriptor.key } });
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to normalize payload',
    }, { status: 400 });
  }

  // Sanity checks on normalized booking.
  if (Number.isNaN(normalized.pickupDate.getTime()) || Number.isNaN(normalized.dropoffDate.getTime())) {
    return NextResponse.json({ ok: false, error: 'Invalid pickup/dropoff dates' }, { status: 400 });
  }
  if (normalized.dropoffDate <= normalized.pickupDate) {
    return NextResponse.json({ ok: false, error: 'dropoffDate must be after pickupDate' }, { status: 400 });
  }

  try {
    // Idempotency: same external ref → return existing booking unchanged.
    const existing = await prisma.rentalBooking.findUnique({
      where: { bookingRef: normalized.externalRef },
    });
    if (existing) {
      return NextResponse.json({ ok: true, bookingId: existing.id, status: existing.status, dedup: true });
    }

    // Find-or-create customer by phone OR email match.
    const customer = await findOrCreateChannelCustomer(normalized);

    // Compute totals if missing.
    const days = Math.max(1, Math.ceil((normalized.dropoffDate.getTime() - normalized.pickupDate.getTime()) / 86400000));
    const dailyRate = normalized.dailyRate ?? null;
    const totalAmount =
      normalized.totalAmount ?? (dailyRate != null ? dailyRate * days : null);

    const booking = await prisma.rentalBooking.create({
      data: {
        bookingRef: normalized.externalRef,
        customerId: customer.id,
        vehicleCategory: normalized.vehicleCategory,
        pickupDate: normalized.pickupDate,
        dropoffDate: normalized.dropoffDate,
        pickupLocation: normalized.pickupLocation,
        dropoffLocation: normalized.dropoffLocation,
        totalDays: days,
        dailyRate,
        totalAmount,
        currency: normalized.currency,
        channel: descriptor.key,
        status: 'PENDING',
        notes: normalized.notes,
      },
    });

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: `channel:${descriptor.key}`,
      userRole: 'CHANNEL',
      entityType: 'RentalBooking',
      entityId: booking.id,
      action: 'CREATE',
      details: `Inbound booking from ${descriptor.label}: ${normalized.externalRef} for ${customer.fullName}, ${days} day${days === 1 ? '' : 's'} ${normalized.vehicleCategory ?? ''}.`,
    });

    return NextResponse.json({ ok: true, bookingId: booking.id, status: booking.status, dedup: false });
  } catch (err) {
    captureException(err, {
      context: 'rental.channels.webhook.persist',
      tags: { channel: descriptor.key, externalRef: normalized.externalRef },
    });
    console.error('[channel webhook] persist error:', err);
    return NextResponse.json({ ok: false, error: 'Failed to persist booking' }, { status: 500 });
  }
}

async function findOrCreateChannelCustomer(n: NormalizedChannelBooking) {
  const phone = n.customer.phone?.trim() || null;
  const email = n.customer.email?.trim().toLowerCase() || null;

  const orClauses: Array<{ phone: string } | { email: string }> = [];
  if (phone) orClauses.push({ phone });
  if (email) orClauses.push({ email });
  if (orClauses.length > 0) {
    const existing = await prisma.rentalCustomer.findFirst({
      where: { deletedAt: null, OR: orClauses },
    });
    if (existing) return existing;
  }

  return prisma.rentalCustomer.create({
    data: {
      fullName: n.customer.fullName,
      phone,
      email,
      nationality: n.customer.nationality ?? null,
      customerType: 'INDIVIDUAL',
    },
  });
}
