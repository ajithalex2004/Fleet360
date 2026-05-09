/**
 * GET    /api/bus-ops/staff/[id]/ble-tag — read tag for staff member
 * PUT    /api/bus-ops/staff/[id]/ble-tag — register / update
 * DELETE /api/bus-ops/staff/[id]/ble-tag — soft-disable (lost / replaced)
 *
 * Body: { tagId: string, formFactor?: 'KEYRING'|'CARD'|'WRISTBAND'|'FOB',
 *         batteryReplacedAt?: ISO, isActive?: boolean, notes?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const tag = await prisma.staffBleTag.findUnique({ where: { staffMemberId: params.id } });
  return tag ? NextResponse.json(tag) : NextResponse.json({ error: 'No tag registered' }, { status: 404 });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const tagId = String(body?.tagId ?? '').trim();
  if (!tagId) return NextResponse.json({ error: 'tagId is required' }, { status: 400 });

  const conflict = await prisma.staffBleTag.findUnique({ where: { tagId } });
  if (conflict && conflict.staffMemberId !== params.id) {
    return NextResponse.json({ error: 'This tag is already registered to another staff member' }, { status: 409 });
  }

  const tag = await prisma.staffBleTag.upsert({
    where: { staffMemberId: params.id },
    update: {
      tagId,
      formFactor: body?.formFactor ?? null,
      batteryReplacedAt: body?.batteryReplacedAt ? new Date(body.batteryReplacedAt) : undefined,
      isActive: body?.isActive ?? true,
      notes: body?.notes ?? null,
    },
    create: {
      staffMemberId: params.id,
      tagId,
      formFactor: body?.formFactor ?? null,
      batteryReplacedAt: body?.batteryReplacedAt ? new Date(body.batteryReplacedAt) : null,
      isActive: body?.isActive ?? true,
      notes: body?.notes ?? null,
    },
  });

  void logAudit({
    tenantId: req.headers.get('x-tenant-id') ?? undefined,
    userId: req.headers.get('x-user-id') ?? 'system',
    userRole: req.headers.get('x-user-role') ?? 'STAFF',
    entityType: 'StaffBleTag',
    entityId: tag.id,
    action: 'UPDATE',
    details: `BLE tag ${tagId} (${body?.formFactor ?? 'unspecified'}) issued to staff ${params.id}`,
  });

  return NextResponse.json(tag);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  await prisma.staffBleTag.update({
    where: { staffMemberId: params.id },
    data: { isActive: false },
  }).catch(() => null);
  void logAudit({
    tenantId: req.headers.get('x-tenant-id') ?? undefined,
    userId: req.headers.get('x-user-id') ?? 'system',
    userRole: req.headers.get('x-user-role') ?? 'STAFF',
    entityType: 'StaffBleTag',
    action: 'DELETE',
    details: `BLE tag disabled (lost / returned) for staff ${params.id}`,
  });
  return NextResponse.json({ ok: true });
}
