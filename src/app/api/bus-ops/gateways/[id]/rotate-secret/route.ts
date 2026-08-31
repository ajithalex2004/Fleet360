export const dynamic = 'force-dynamic';

/**
 * POST /api/bus-ops/gateways/[id]/rotate-secret
 *
 * Generate a new random secret for this gateway, store it, and return
 * the plaintext ONCE (this is the only time the caller can see it).
 * The gateway hardware must be updated to use the new secret; anything
 * still signing with the old one will fail HMAC verification on the
 * next ingest.
 *
 * Auth: tenant admin (relies on middleware-stamped x-tenant-id +
 * downstream tenant-scope check on the gateway row).
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const { id } = await ctx.params;

      // Tenant scope: gateway must belong to the caller's tenant.
      const gateway = await tx.bleGateway.findFirst({
        where: { id, tenantId },
        select: { id: true, gatewayId: true },
      });
      if (!gateway) return NextResponse.json({ error: 'Gateway not found' }, { status: 404 });

      // 48 bytes → 64 base64url chars. Plenty for HMAC-SHA256 keying.
      const newSecret = randomBytes(48).toString('base64url');

      await tx.bleGateway.update({
        where: { id },
        data: { secret: newSecret, secretRotatedAt: new Date() },
      });

      // ONE-TIME REVEAL: response includes the plaintext. Do NOT log this
      // or persist it anywhere else — the row-level column stores it
      // canonically and is what the ingest verifier reads.
      return NextResponse.json({
        ok: true,
        gatewayId: gateway.gatewayId,
        secret: newSecret,
        rotatedAt: new Date().toISOString(),
        warning: 'This secret is shown once. Update the gateway hardware now — future rotations require re-running this endpoint.',
      });
  });
}

