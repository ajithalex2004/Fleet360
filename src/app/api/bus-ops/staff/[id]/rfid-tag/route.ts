/**
 * GET    /api/bus-ops/staff/[id]/rfid-tag — read RFID tag
 * PUT    /api/bus-ops/staff/[id]/rfid-tag — register / update tag
 * DELETE /api/bus-ops/staff/[id]/rfid-tag — soft-disable
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normaliseNfcUid } from '@/lib/bus-checkin';
import { logAudit } from '@/lib/audit';
import { requireBusEntity, requireBusOpsContext } from '@/lib/bus-ops-route-guards';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireBusOpsContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const boundary = await requireBusEntity(ctx, 'staff_members', id, 'Staff member');
  if (boundary) return boundary;
  const tag = await prisma.staffRfidTag.findUnique({ where: { staffMemberId: id } });
  return tag ? NextResponse.json(tag) : NextResponse.json({ error: 'No tag registered' }, { status: 404 });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireBusOpsContext(req, { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const boundary = await requireBusEntity(ctx, 'staff_members', id, 'Staff member');
  if (boundary) return boundary;
  const body = await req.json();
  const tagUid = normaliseNfcUid(String(body?.tagUid ?? ''));
  if (!tagUid) return NextResponse.json({ error: 'tagUid is required' }, { status: 400 });

  // Tag UIDs are globally unique. Refuse if it's already on a different staff.
  const conflict = await prisma.staffRfidTag.findUnique({ where: { tagUid } });
  if (conflict && conflict.staffMemberId !== id) {
    return NextResponse.json({ error: 'This tag is already registered to another staff member' }, { status: 409 });
  }

  const tag = await prisma.staffRfidTag.upsert({
    where: { staffMemberId: id },
    update: { tagUid, isActive: body?.isActive ?? true, notes: body?.notes ?? null },
    create: { staffMemberId: id, tagUid, isActive: body?.isActive ?? true, notes: body?.notes ?? null },
  });

  void logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    userRole: ctx.role,
    entityType: 'StaffRfidTag',
    entityId: tag.id,
    action: 'UPDATE',
    details: `RFID tag ${tagUid} assigned to staff ${id}`,
  });

  return NextResponse.json(tag);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireBusOpsContext(req, { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const boundary = await requireBusEntity(ctx, 'staff_members', id, 'Staff member');
  if (boundary) return boundary;
  await prisma.staffRfidTag.update({
    where: { staffMemberId: id },
    data: { isActive: false },
  }).catch(() => null);
  void logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    userRole: ctx.role,
    entityType: 'StaffRfidTag',
    action: 'DELETE',
    details: `RFID tag disabled for staff ${id}`,
  });
  return NextResponse.json({ ok: true });
}
