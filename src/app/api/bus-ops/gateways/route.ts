/**
 * GET /api/bus-ops/gateways
 *
 * Returns the registered BLE gateway fleet with health status:
 *   - last-seen heartbeat (vs threshold to flag offline)
 *   - last actual event ingested
 *   - vehicle assignment
 *   - configured (= shared secret present in env)
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { gatewaySecretConfigured } from '@/lib/bus-gateway';

export const runtime = 'nodejs';

const OFFLINE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes without heartbeat → offline

export async function GET() {
  const gateways = await prisma.bleGateway.findMany({
    orderBy: { createdAt: 'desc' },
  });
  const now = Date.now();

  const out = gateways.map(g => {
    const lastSeenMs = g.lastSeenAt ? now - g.lastSeenAt.getTime() : null;
    const lastEventMs = g.lastEventAt ? now - g.lastEventAt.getTime() : null;
    return {
      ...g,
      health:
        g.isActive === false ? 'DISABLED'
        : lastSeenMs == null ? 'NEVER_SEEN'
        : lastSeenMs > OFFLINE_THRESHOLD_MS ? 'OFFLINE'
        : 'ONLINE',
      lastSeenSecondsAgo: lastSeenMs == null ? null : Math.round(lastSeenMs / 1000),
      lastEventSecondsAgo: lastEventMs == null ? null : Math.round(lastEventMs / 1000),
    };
  });

  return NextResponse.json({
    sharedSecretConfigured: gatewaySecretConfigured(),
    gateways: out,
  });
}
