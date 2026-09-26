export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { runAsTenant } from '@/lib/rls-scope';
import { OutsourceEngine } from '@/lib/exchange/outsource-engine';
import {
  awardTenantForPartner,
  OPERATIONS_ROLES,
  partnerAuthFailure,
  requirePartnerContext,
} from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * POST /api/exchange/jobs/assign
 *
 * Partner assigns a vehicle and driver to an awarded job and generates a secure driver execution link.
 * The partner comes from the caller's partner_users membership (it used to
 * come from the body), and the vehicle and driver must be its own.
 */
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req, { roles: OPERATIONS_ROLES });
  if (!auth.ok) return partnerAuthFailure(auth);
  const { partnerId, userId } = auth.ctx;

  try {
    const body = await req.json().catch(() => ({}));
    const { awardId, vehicleId, vehiclePlate, driverId, driverName, driverPhone } = body;

    if (!awardId || !vehiclePlate || !driverName || !driverPhone) {
      return NextResponse.json({ error: 'Missing required assignment fields' }, { status: 400 });
    }

    const tenantId = await awardTenantForPartner(partnerId, String(awardId));
    if (!tenantId) return NextResponse.json({ error: 'Award not found for your company' }, { status: 404 });

    // The engine only checks a vehicle's or driver's own compliance, not whose
    // it is: refuse another partner's.
    const [vehicle, driver] = await withPlatformAdmin(prisma, async (tx) => [
      vehicleId ? await tx.partnerVehicle.findFirst({ where: { id: String(vehicleId), partnerId }, select: { id: true } }) : true,
      driverId ? await tx.partnerDriver.findFirst({ where: { id: String(driverId), partnerId }, select: { id: true } }) : true,
    ]);
    if (!vehicle) return NextResponse.json({ error: 'Vehicle not found in your fleet' }, { status: 404 });
    if (!driver) return NextResponse.json({ error: 'Driver not found in your roster' }, { status: 404 });

    // The award belongs to the buyer's tenant (runAsTenant: the engine uses
    // the global client).
    const res = await runAsTenant(tenantId, () =>
      OutsourceEngine.assignVehicleAndDriver({
        awardId: String(awardId),
        partnerId,
        vehicleId,
        vehiclePlate,
        driverId,
        driverName,
        driverPhone,
        actorUserId: userId,
      }),
    );

    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to assign vehicle/driver' }, { status: 500 });
  }
}
