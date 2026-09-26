export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { PartnerService } from '@/lib/exchange/partner-service';
import { OPERATIONS_ROLES, partnerAuthFailure, requirePartnerContext } from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * GET  /api/exchange/partner/fleet — the signed-in partner's active vehicles
 * POST /api/exchange/partner/fleet — register a vehicle for that partner
 *
 * The partner comes from the caller's partner_users membership. (It used to
 * come from ?partnerId= / the body; without one GET listed every partner's
 * vehicles.)
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req);
  if (!auth.ok) return partnerAuthFailure(auth);

  const vehicles = await withPlatformAdmin(prisma, (tx) =>
    tx.partnerVehicle.findMany({
      where: { partnerId: auth.ctx.partnerId, isActive: true },
      orderBy: { createdAt: 'desc' },
    }),
  );

  return NextResponse.json({ vehicles });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req, { roles: OPERATIONS_ROLES });
  if (!auth.ok) return partnerAuthFailure(auth);
  const { partnerId } = auth.ctx;

  try {
    const body = await req.json().catch(() => ({}));
    const { licensePlate, plateEmirate, vehicleType, seatingCapacity, make, model, year, mulkiyaExpiry } = body;

    if (!licensePlate || !vehicleType || !seatingCapacity) {
      return NextResponse.json({ error: 'Missing required vehicle fields' }, { status: 400 });
    }

    const vehicle = await PartnerService.registerVehicle({
      partnerId,
      licensePlate,
      plateEmirate,
      vehicleType,
      seatingCapacity: Number(seatingCapacity),
      make,
      model,
      year: year ? Number(year) : undefined,
      mulkiyaExpiry,
    });

    return NextResponse.json({ ok: true, vehicle });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to register vehicle' }, { status: 500 });
  }
}
