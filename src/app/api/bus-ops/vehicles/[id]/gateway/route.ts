/**
 * GET    /api/bus-ops/vehicles/[id]/gateway — read gateway for vehicle
 * PUT    /api/bus-ops/vehicles/[id]/gateway — register / update
 * DELETE /api/bus-ops/vehicles/[id]/gateway — soft-disable
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { requireBusEntity, requireBusOpsContext } from '@/lib/bus-ops-route-guards';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireBusOpsContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const boundary = await requireBusEntity(ctx, 'vehicles', id, 'Vehicle');
  if (boundary) return boundary;
  const gw = await prisma.bleGateway.findUnique({ where: { vehicleId: id } });
  return gw ? NextResponse.json(gw) : NextResponse.json({ error: 'No gateway registered' }, { status: 404 });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireBusOpsContext(req, { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const boundary = await requireBusEntity(ctx, 'vehicles', id, 'Vehicle');
  if (boundary) return boundary;
  const body = await req.json();
  const gatewayId = String(body?.gatewayId ?? '').trim();
  if (!gatewayId) return NextResponse.json({ error: 'gatewayId is required' }, { status: 400 });

  // Tags are globally unique across vehicles.
  const conflict = await prisma.bleGateway.findUnique({ where: { gatewayId } });
  if (conflict && conflict.vehicleId !== id) {
    return NextResponse.json({ error: 'This gatewayId is already registered to another vehicle' }, { status: 409 });
  }

  const gw = await prisma.bleGateway.upsert({
    where: { vehicleId: id },
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
      vehicleId: id,
      gatewayId,
      model: body?.model ?? null,
      rssiThresholdDbm: typeof body?.rssiThresholdDbm === 'number' ? body.rssiThresholdDbm : -75,
      presenceGraceSeconds: typeof body?.presenceGraceSeconds === 'number' ? body.presenceGraceSeconds : 10,
      isActive: body?.isActive ?? true,
      notes: body?.notes ?? null,
    },
  });

  void logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    userRole: ctx.role,
    entityType: 'BleGateway',
    entityId: gw.id,
    action: 'UPDATE',
    details: `Gateway ${gatewayId} registered for vehicle ${id} (${body?.model ?? 'no model'})`,
  });

  return NextResponse.json(gw);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireBusOpsContext(req, { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const boundary = await requireBusEntity(ctx, 'vehicles', id, 'Vehicle');
  if (boundary) return boundary;
  await prisma.bleGateway.update({
    where: { vehicleId: id },
    data: { isActive: false },
  }).catch(() => null);
  void logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    userRole: ctx.role,
    entityType: 'BleGateway',
    action: 'DELETE',
    details: `Gateway disabled for vehicle ${id}`,
  });
  return NextResponse.json({ ok: true });
}
