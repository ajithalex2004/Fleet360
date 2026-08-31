export const dynamic = 'force-dynamic';

/**
 * POST /api/logistics/carriers/[id]/app-device
 *
 * Issues a mobile-app device token for an owner-operator (gig driver) carrier —
 * the credential their app uses to post GPS heartbeats. Mirrors the carrier-portal
 * invite pattern: only the token's hash is stored; the raw token is returned ONCE
 * for the app to keep. Optionally registers the FCM/APNs push token at the same
 * time (Phase 1 push channel).
 *
 * Body: { platform?, pushToken? }
 * Auth: tenant operator session; tenantId / issuer from x-tenant-id / x-user-id.
 *
 * (Until the mobile app's own onboarding/login exists, this operator-issued token
 * is how a driver's app gets provisioned.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { issueCarrierAppDevice } from '@/lib/logistics/domain';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;
  const createdBy = req.headers.get('x-user-id');

  let body: { platform?: string | null; pushToken?: string | null } = {};
  try { body = await req.json(); } catch { /* body optional */ }

  try {
    const device = await issueCarrierAppDevice({
      tenantId,
      carrierId: params.id,
      platform: body.platform ?? null,
      pushToken: body.pushToken ?? null,
      createdBy,
    });
    return NextResponse.json(device, { status: 201 });
    } catch (e) {
    console.error('[carriers/:id/app-device POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to issue device token' },
      { status: 500 },
    );
  }
}
