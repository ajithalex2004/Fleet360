/**
 * POST /api/carrier-portal/offer/resolve
 *
 * Resolves a driver-broadcast OFFER token (the magic link) to the driver's view
 * of the load + the fixed offer. Token-authed (no operator session); this path
 * is exempt from the session middleware. The token is sent in the body so it
 * isn't logged.
 *
 * Body: { token }  →  the resolveBroadcastOffer context, or 404 when unknown.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveBroadcastOffer } from '@/lib/logistics/domain';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  let body: { token?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const token = String(body.token ?? '').trim();
  if (!token) return NextResponse.json({ error: 'token is required' }, { status: 400 });

  try {
    const ctx = await resolveBroadcastOffer(token);
    if (!ctx) {
      return NextResponse.json({ error: 'This offer link is invalid or has expired.' }, { status: 404 });
    }
    return NextResponse.json(ctx, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
    console.error('[carrier-portal/offer/resolve]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed to load offer' }, { status: 500 });
  }
}
