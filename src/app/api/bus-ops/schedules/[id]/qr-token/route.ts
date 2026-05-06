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
import { prisma } from '@/lib/prisma';
import { issueQrToken } from '@/lib/bus-checkin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ttlSeconds = Math.max(60, Number(req.nextUrl.searchParams.get('ttlSeconds') ?? 900));
  const schedule = await prisma.tripSchedule.findUnique({
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
}
