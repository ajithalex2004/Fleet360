export const dynamic = 'force-dynamic';

/**
 * GET    /api/bus-ops/vehicles/[id]/gateway — read gateway for vehicle
 * PUT    /api/bus-ops/vehicles/[id]/gateway — register / update
 * DELETE /api/bus-ops/vehicles/[id]/gateway — soft-disable
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      // Use findFirst so we can include tenantId in the where clause — findUnique
      // only accepts the unique key field(s), not extra filters.
      const gw = await tx.bleGateway.findFirst({ where: { vehicleId: params.id, tenantId } });
      return gw ? NextResponse.json(gw) : NextResponse.json({ error: 'No gateway registered' }, { status: 404 });
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
      const gatewayId = String(body?.gatewayId ?? '').trim();
      if (!gatewayId) return NextResponse.json({ error: 'gatewayId is required' }, { status: 400 });

      // Tags are globally unique across vehicles.
      const conflict = await tx.bleGateway.findUnique({ where: { gatewayId } });
      if (conflict && conflict.vehicleId !== params.id) {
        return NextResponse.json({ error: 'This gatewayId is already registered to another vehicle' }, { status: 409 });
      }

      const gw = await tx.bleGateway.upsert({
        where: { vehicleId: params.id },
        update: {
          gatewayId,
          model: body?.model ?? null,
          rssiThresholdDbm: typeof body?.rssiThresholdDbm === 'number' ? body.rssiThresholdDbm : undefined,
          presenceGraceSeconds: typeof body?.presenceGraceSeconds === 'number' ? body.presenceGraceSeconds : undefined,
          isActive: body?.isActive ?? true,
          notes: body?.notes ?? null,
          updatedAt: new Date(),
        },
        create: {
          vehicleId: params.id,
          tenantId,
          gatewayId,
          model: body?.model ?? null,
          rssiThresholdDbm: typeof body?.rssiThresholdDbm === 'number' ? body.rssiThresholdDbm : -75,
          presenceGraceSeconds: typeof body?.presenceGraceSeconds === 'number' ? body.presenceGraceSeconds : 10,
          isActive: body?.isActive ?? true,
          notes: body?.notes ?? null,
        },
      });

      void logAudit({
        tenantId: tenantId ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system',
        userRole: req.headers.get('x-user-role') ?? 'STAFF',
        entityType: 'BleGateway',
        entityId: gw.id,
        action: 'UPDATE',
        details: `Gateway ${gatewayId} registered for vehicle ${params.id} (${body?.model ?? 'no model'})`,
      });

      return NextResponse.json(gw);
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

      const existing = await tx.bleGateway.findFirst({ where: { vehicleId: params.id, tenantId } });
      if (!existing) return NextResponse.json({ error: 'No gateway registered' }, { status: 404 });
      await tx.bleGateway.update({
        where: { vehicleId: params.id },
        data: { isActive: false },
      }).catch(() => null);
      void logAudit({
        tenantId: tenantId ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system',
        userRole: req.headers.get('x-user-role') ?? 'STAFF',
        entityType: 'BleGateway',
        action: 'DELETE',
        details: `Gateway disabled for vehicle ${params.id}`,
      });
      return NextResponse.json({ ok: true });
  });
}

