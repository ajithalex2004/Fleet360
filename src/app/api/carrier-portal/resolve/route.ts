/**
 * POST /api/carrier-portal/resolve
 *
 * The carrier portal's auth + data fetch in one call. The invite token (from the
 * magic link) IS the credential — domain.resolveCarrierPortalInvite hashes it,
 * looks up an ACTIVE, unexpired invite, and returns the carrier's view of the
 * load (RFQ + shipment + their existing bid + compliance). No tenant/operator
 * session is involved, which is why this path is exempt from the session
 * middleware. The token is sent in the body (not the URL) so it isn't logged.
 *
 * Body: { token }  →  the resolveCarrierPortalInvite context, or 404 when the
 * token is invalid / expired / revoked.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveCarrierPortalInvite } from '@/lib/logistics/domain';

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
  if (!token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }

  try {
    const context = await resolveCarrierPortalInvite(token);
    if (!context) {
      return NextResponse.json(
        { error: 'This invite link is invalid or has expired. Ask the shipper for a new one.' },
        { status: 404 },
      );
    }
    return NextResponse.json(context, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
    console.error('[carrier-portal/resolve POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load the invite' },
      { status: 500 },
    );
  }
}
