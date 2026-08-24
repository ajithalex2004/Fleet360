/**
 * POST /api/carrier-portal/offer/accept
 *
 * A driver accepts (or declines) a broadcast offer via their magic link. The
 * token authenticates the driver and scopes the action to exactly that offer.
 * Accepting bumps the broadcast to CONFIRMING; MULTIPLE drivers may accept — the
 * operator confirms one. Token-authed (no operator session).
 *
 * Body: { token, action: 'accept' | 'decline' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { respondToBroadcastOffer } from '@/lib/logistics/domain';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  let body: { token?: string; action?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const token = String(body.token ?? '').trim();
  if (!token) return NextResponse.json({ error: 'token is required' }, { status: 400 });
  const action = body.action === 'decline' ? 'decline' : 'accept';

  try {
    const ctx = await respondToBroadcastOffer(token, action);
    return NextResponse.json(ctx);
  } catch (e) {
    // "already taken" / "expired" / "invalid" are caller-facing → 409.
    console.error('[carrier-portal/offer/accept]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed to respond' }, { status: 409 });
  }
}
