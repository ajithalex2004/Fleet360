export const dynamic = 'force-dynamic';

/**
 * GET /api/bus-ops/schedules/[id]/qr-token
 *
 * Issues a short-lived (15 minute) HMAC-signed QR token bound to this trip.
 * The driver displays this in the bus app; passengers scan with their phone
 * camera to check in.
 *
 * Returns the raw token string. The PWA encodes it into a QR client-side
 * (no server-side image generation needed; keeps payload tiny).
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { issueQrToken } from '@/lib/bus-checkin';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const ttlSeconds = Math.max(60, Number(req.nextUrl.searchParams.get('ttlSeconds') ?? 900));
      const schedule = await tx.tripSchedule.findUnique({
        where: { id: params.id },
        select: { id: true, status: true },
      });
      if (!schedule) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
      if (['COMPLETED', 'CANCELLED'].includes(schedule.status ?? '')) {
        return NextResponse.json({ error: `Trip is ${schedule.status} — QR not issued` }, { status: 409 });
      }
      try {
        const token = issueQrToken(params.id, ttlSeconds);
        const expiresAt = parseInt(token.split('.')[1], 10);
        return NextResponse.json({ token, expiresAt, ttlSeconds });
        } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'QR signing failed' }, { status: 500 });
      }
  });
}

