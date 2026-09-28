export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { PartnerService } from '@/lib/exchange/partner-service';
import { OPERATIONS_ROLES, partnerAuthFailure, requirePartnerContext } from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * GET  /api/exchange/partner/drivers — the signed-in partner's active drivers
 * POST /api/exchange/partner/drivers — register a driver for that partner
 *
 * The partner comes from the caller's partner_users membership. (It used to
 * come from ?partnerId= / the body; without one GET listed every partner's
 * drivers with their mobile and licence numbers.)
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req, { allowPending: true });
  if (!auth.ok) return partnerAuthFailure(auth);

  const drivers = await withPlatformAdmin(prisma, (tx) =>
    tx.partnerDriver.findMany({
      where: { partnerId: auth.ctx.partnerId, isActive: true },
      orderBy: { createdAt: 'desc' },
    }),
  );

  return NextResponse.json({ drivers });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req, { roles: OPERATIONS_ROLES, allowPending: true });
  if (!auth.ok) return partnerAuthFailure(auth);
  const { partnerId } = auth.ctx;

  try {
    const body = await req.json().catch(() => ({}));
    const { fullName, mobileNumber, licenseNumber, licenseExpiry, permitType, permitExpiry } = body;

    if (!fullName || !mobileNumber) {
      return NextResponse.json({ error: 'Missing required driver fields' }, { status: 400 });
    }

    const driver = await PartnerService.registerDriver({
      partnerId,
      fullName,
      mobileNumber,
      licenseNumber,
      licenseExpiry,
      permitType,
      permitExpiry,
    });

    return NextResponse.json({ ok: true, driver });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to register driver' }, { status: 500 });
  }
}
