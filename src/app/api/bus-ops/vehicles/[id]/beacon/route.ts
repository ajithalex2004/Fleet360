export const dynamic = 'force-dynamic';

/**
 * GET    /api/bus-ops/vehicles/[id]/beacon  — read beacon for vehicle
 * PUT    /api/bus-ops/vehicles/[id]/beacon  — register / update beacon
 * DELETE /api/bus-ops/vehicles/[id]/beacon  — soft-disable
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { normaliseBleUuid } from '@/lib/bus-checkin';
import { logAudit } from '@/lib/audit';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const beacon = await tx.vehicleBeacon.findUnique({ where: { vehicleId: params.id } });
      return beacon ? NextResponse.json(beacon) : NextResponse.json({ error: 'No beacon registered' }, { status: 404 });
  });
}


export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const bleUuid = normaliseBleUuid(String(body?.bleUuid ?? ''));
      if (!bleUuid) return NextResponse.json({ error: 'bleUuid is required' }, { status: 400 });

      const beacon = await tx.vehicleBeacon.upsert({
        where: { vehicleId: params.id },
        update: {
          bleUuid,
          major: body?.major ?? null,
          minor: body?.minor ?? null,
          isActive: body?.isActive ?? true,
          notes: body?.notes ?? null,
        },
        create: {
          vehicleId: params.id,
          bleUuid,
          major: body?.major ?? null,
          minor: body?.minor ?? null,
          isActive: body?.isActive ?? true,
          notes: body?.notes ?? null,
        },
      });

      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system',
        userRole: req.headers.get('x-user-role') ?? 'STAFF',
        entityType: 'VehicleBeacon',
        entityId: beacon.id,
        action: 'UPDATE',
        details: `Beacon registered for vehicle ${params.id}: ${bleUuid}`,
      });

      return NextResponse.json(beacon);
  });
}


export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    await tx.vehicleBeacon.update({
        where: { vehicleId: params.id },
        data: { isActive: false },
      }).catch(() => null);
      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system',
        userRole: req.headers.get('x-user-role') ?? 'STAFF',
        entityType: 'VehicleBeacon',
        action: 'DELETE',
        details: `Beacon disabled for vehicle ${params.id}`,
      });
      return NextResponse.json({ ok: true });
  });
}

