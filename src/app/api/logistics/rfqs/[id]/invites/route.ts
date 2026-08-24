/**
 * POST /api/logistics/rfqs/[id]/invites
 *
 * Generates a carrier-portal invite (magic link) for a carrier on this RFQ.
 * domain.createCarrierPortalInvite mints a single-use-ish secure token (only its
 * hash is stored), adds the carrier to the RFQ's invited list, and returns the
 * raw token + portalPath so the operator can share the link. The carrier opens
 * that link to view the load and submit a bid — no account/password needed.
 *
 * Body: { carrierId (required), expiresAt? }
 * Auth: tenant operator session; tenantId / creator from x-tenant-id / x-user-id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { createCarrierPortalInvite } from '@/lib/logistics/domain';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;
  const createdBy = req.headers.get('x-user-id');

  let body: { carrierId?: string; expiresAt?: string | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.carrierId) {
    return NextResponse.json({ error: 'carrierId is required' }, { status: 400 });
  }

  try {
    const invite = await createCarrierPortalInvite({
      tenantId,
      rfqId: id,
      carrierId: body.carrierId,
      expiresAt: body.expiresAt ?? null,
      createdBy,
    });
    return NextResponse.json(invite, { status: 201 });
    } catch (e) {
    console.error('[logistics/rfqs/:id/invites POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to create invite' },
      { status: 500 },
    );
  }
}
