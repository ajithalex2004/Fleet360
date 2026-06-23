/**
 * GET    /api/bus-ops/vehicles/[id]/beacon  — read beacon for vehicle
 * PUT    /api/bus-ops/vehicles/[id]/beacon  — register / update beacon
 * DELETE /api/bus-ops/vehicles/[id]/beacon  — soft-disable
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normaliseBleUuid } from '@/lib/bus-checkin';
import { logAudit } from '@/lib/audit';
import { requireBusEntity, requireBusOpsContext } from '@/lib/bus-ops-route-guards';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireBusOpsContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const boundary = await requireBusEntity(ctx, 'vehicles', id, 'Vehicle');
  if (boundary) return boundary;
  const beacon = await prisma.vehicleBeacon.findUnique({ where: { vehicleId: id } });
  return beacon ? NextResponse.json(beacon) : NextResponse.json({ error: 'No beacon registered' }, { status: 404 });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireBusOpsContext(req, { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const boundary = await requireBusEntity(ctx, 'vehicles', id, 'Vehicle');
  if (boundary) return boundary;
  const body = await req.json();
  const bleUuid = normaliseBleUuid(String(body?.bleUuid ?? ''));
  if (!bleUuid) return NextResponse.json({ error: 'bleUuid is required' }, { status: 400 });

  const beacon = await prisma.vehicleBeacon.upsert({
    where: { vehicleId: id },
    update: {
      bleUuid,
      major: body?.major ?? null,
      minor: body?.minor ?? null,
      isActive: body?.isActive ?? true,
      notes: body?.notes ?? null,
    },
    create: {
      vehicleId: id,
      bleUuid,
      major: body?.major ?? null,
      minor: body?.minor ?? null,
      isActive: body?.isActive ?? true,
      notes: body?.notes ?? null,
    },
  });

  void logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    userRole: ctx.role,
    entityType: 'VehicleBeacon',
    entityId: beacon.id,
    action: 'UPDATE',
    details: `Beacon registered for vehicle ${id}: ${bleUuid}`,
  });

  return NextResponse.json(beacon);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireBusOpsContext(req, { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const boundary = await requireBusEntity(ctx, 'vehicles', id, 'Vehicle');
  if (boundary) return boundary;
  await prisma.vehicleBeacon.update({
    where: { vehicleId: id },
    data: { isActive: false },
  }).catch(() => null);
  void logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    userRole: ctx.role,
    entityType: 'VehicleBeacon',
    action: 'DELETE',
    details: `Beacon disabled for vehicle ${id}`,
  });
  return NextResponse.json({ ok: true });
}
