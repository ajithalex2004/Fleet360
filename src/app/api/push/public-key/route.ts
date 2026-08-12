/**
 * GET /api/push/public-key
 * Returns the VAPID public key so the PWA can subscribe(). Safe to expose
 * — VAPID public keys are meant to be public (the private key is what
 * signs push messages).
 *
 * Cache: public, long max-age. The key changes only on a server-side
 * rotation; if it does change, the SW + PWA will fail to subscribe until
 * the user re-enables notifications, and a server restart pushes a new
 * build with the new key anyway.
 */

import { NextResponse } from 'next/server';
import { getPublicVapidKey } from '@/lib/push/server';

export async function GET() {
  try {
    const key = getPublicVapidKey();
    return NextResponse.json(
      { publicKey: key },
      { headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'VAPID not configured' },
      { status: 503 },
    );
  }
}
