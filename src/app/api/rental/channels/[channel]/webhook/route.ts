export const dynamic = 'force-dynamic';

/**
 * POST /api/rental/channels/[channel]/webhook
 *
 * Inbound channel webhook. External partners post native booking payloads.
 * TENANT-001: uses withWebhookTenant — identify tenant, then tenant-scoped writes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withWebhookTenant, withTenantRls } from '@/lib/rls';
import {
  getChannel,
  normalizeChannelPayload,
  verifyChannelSignature,
  type ChannelKey,
  type NormalizedChannelBooking,
} from '@/lib/rental-channels';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ channel: string }> }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const { channel: channelParam } = await params;
  const descriptor = getChannel(channelParam);

  if (!descriptor) {
    return NextResponse.json({ ok: false, error: `Unknown channel: ${channelParam}` }, { status: 404 });
  }
  if (!descriptor.supportsInboundWebhook) {
    return NextResponse.json(
      { ok: false, error: `Channel ${descriptor.key} does not accept inbound webhooks` },
      { status: 400 },
    );
  }

  const rawBody = await req.text();
  const signature = req.headers.get('x-channel-signature');
  const secret = descriptor.secretEnvVar ? process.env[descriptor.secretEnvVar] : null;

  if (!secret) {
    captureException(
      new Error(`Channel ${descriptor.key} webhook hit but ${descriptor.secretEnvVar} not configured`),
      { context: 'rental.channels.webhook.no_secret', tags: { channel: descriptor.key } },
    );
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
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to normalize payload' },
      { status: 400 },
    );
  }

  if (Number.isNaN(normalized.pickupDate.getTime()) || Number.isNaN(normalized.dropoffDate.getTime())) {
    return NextResponse.json({ ok: false, error: 'Invalid pickup/dropoff dates' }, { status: 400 });
  }
  if (normalized.dropoffDate <= normalized.pickupDate) {
    return NextResponse.json({ ok: false, error: 'dropoffDate must be after pickupDate' }, { status: 400 });
  }

  try {
    const result = await withWebhookTenant(
      prisma,
      async (tx): Promise<string | null> => {
        const fromHeader = req.headers.get('x-tenant-id');
        if (fromHeader) return fromHeader;
        const fallback = await tx.tenant.findFirst({
          where: { isActive: { not: false } },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        });
        return fallback?.id ?? null;
      },
      async ({ tx, tenantId }) => {
        const existing = await tx.rentalBooking.findFirst({
          where: { tenantId, bookingRef: normalized.externalRef } as any,
        });
        if (existing) {
          return NextResponse.json({
            ok: true,
            bookingId: existing.id,
            status: existing.status,
            dedup: true,
          });
        }

        const customer = await findOrCreateChannelCustomer(tx, tenantId, normalized);

        const days = Math.max(
          1,
          Math.ceil((normalized.dropoffDate.getTime() - normalized.pickupDate.getTime()) / 86400000),
        );
        const dailyRate = normalized.dailyRate ?? null;
        const totalAmount =
          normalized.totalAmount ?? (dailyRate != null ? dailyRate * days : null);

        const booking = await tx.rentalBooking.create({
          data: {
            tenantId,
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
          } as any,
        });

        void logAudit({
          tenantId,
          userId: `channel:${descriptor.key}`,
          userRole: 'CHANNEL',
          entityType: 'RentalBooking',
          entityId: booking.id,
          action: 'CREATE',
          details: `Inbound booking from ${descriptor.label}: ${normalized.externalRef} for ${customer.fullName}, ${days} day(s) ${normalized.vehicleCategory ?? ''}.`,
        });

        return NextResponse.json({
          ok: true,
          bookingId: booking.id,
          status: booking.status,
          dedup: false,
        });
      },
    );

    if (result === null) {
      return NextResponse.json(
        { ok: false, error: 'No active tenant to attribute this booking to' },
        { status: 503 },
      );
    }
    return result;
  } catch (err) {
    captureException(err, {
      context: 'rental.channels.webhook.persist',
      tags: { channel: descriptor.key, externalRef: normalized.externalRef },
    });
    console.error('[channel webhook] persist error:', err);
    return NextResponse.json({ ok: false, error: 'Failed to persist booking' }, { status: 500 });
  }
}

async function findOrCreateChannelCustomer(
  tx: { rentalCustomer: { findFirst: Function; create: Function } },
  tenantId: string,
  n: NormalizedChannelBooking,
) {
  const phone = n.customer.phone?.trim() || null;
  const email = n.customer.email?.trim().toLowerCase() || null;

  const orClauses: Array<{ phone: string } | { email: string }> = [];
  if (phone) orClauses.push({ phone });
  if (email) orClauses.push({ email });
  if (orClauses.length > 0) {
    const existing = await tx.rentalCustomer.findFirst({
      where: { tenantId, deletedAt: null, OR: orClauses },
    });
    if (existing) return existing;
  }

  return tx.rentalCustomer.create({
    data: {
      tenantId,
      fullName: n.customer.fullName,
      phone,
      email,
      nationality: n.customer.nationality ?? null,
      customerType: 'INDIVIDUAL',
    },
  });
}
