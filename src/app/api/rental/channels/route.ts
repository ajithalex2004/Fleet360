/**
 * GET /api/rental/channels
 *
 * Returns the channel registry annotated with per-channel booking counts and
 * "configured" flag (i.e. shared secret is present in env). Used by the
 * Channel Manager admin page to give operators a one-glance health view.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { CHANNELS } from '@/lib/rental-channels';

export const runtime = 'nodejs';

export async function GET() {
  // Aggregate booking counts per channel.
  const grouped = await prisma.rentalBooking.groupBy({
    by: ['channel'],
    where: { deletedAt: null },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const byKey = new Map(grouped.map((g) => [g.channel ?? 'DIRECT', g]));

  const out = CHANNELS.map((c) => {
    const stat = byKey.get(c.key);
    return {
      key: c.key,
      label: c.label,
      category: c.category,
      supportsInboundWebhook: c.supportsInboundWebhook,
      supportsOutboundSync: c.supportsOutboundSync,
      configured: c.secretEnvVar ? Boolean(process.env[c.secretEnvVar]) : true,
      description: c.description,
      bookingCount: stat?._count._all ?? 0,
      lastBookingAt: stat?._max.createdAt ?? null,
    };
  });

  return NextResponse.json(out);
}
