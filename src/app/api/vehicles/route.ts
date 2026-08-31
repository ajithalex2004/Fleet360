export const dynamic = 'force-dynamic';

/**
 * /api/vehicles — Maintenance module vehicle access
 *
 * Hub-and-Spoke rule: Vehicles are OWNED by Fleet Management.
 * This route is READ-ONLY for all non-Fleet modules.
 * To create a vehicle, use POST /api/fleet/vehicles.
 *
 * GET  — returns vehicles from the central Fleet registry
 * POST — returns 405 with a redirect hint to the Fleet Hub
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
function serialize(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(serialize);
  if (typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, serialize(v)])
    );
  }
  return obj;
}

export async function GET(request: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const sp = request.nextUrl.searchParams;
        const status       = sp.get('status');
        const vehicleUsage = sp.get('vehicleUsage') ?? sp.get('usage');
        const search       = sp.get('search');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // The whole fleet list. Without tenantId this returned every
        // organisation's vehicles.
        const where: any = { tenantId, deletedAt: null };
        if (status)       where.status       = status;
        if (vehicleUsage) where.vehicleUsage = vehicleUsage;
        if (search) {
          where.OR = [
            { make: { contains: search, mode: 'insensitive' } },
            { model: { contains: search, mode: 'insensitive' } },
            { licensePlate: { contains: search, mode: 'insensitive' } },
            { vin: { contains: search, mode: 'insensitive' } },
          ];
        }

        const vehicles = await tx.vehicle.findMany({
          where,
          orderBy: { createdAt: 'desc' },
        });

        return NextResponse.json(serialize(vehicles));
      } catch (e) {
        console.error('[Fleet Hub] Failed to fetch vehicles:', e);
        return NextResponse.json(
          { error: 'Internal Server Error', details: String(e) },
          { status: 500 }
        );
      }
  });
}


/**
 * Vehicle creation is centralised in Fleet Management.
 * Direct POST to /api/vehicles is not permitted from operational modules.
 */
export async function POST(request: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return NextResponse.json(
    {
      error: 'Vehicle creation is centralised in Fleet Management.',
      message: 'Use POST /api/fleet/vehicles to register a new vehicle. All modules reference vehicles by ID.',
      hub: '/api/fleet/vehicles',
    },
    { status: 405 }
  );
}
