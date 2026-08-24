/**
 * GET    /api/bus-ops/staff/[id]/rfid-tag — read RFID tag
 * PUT    /api/bus-ops/staff/[id]/rfid-tag — register / update tag
 * DELETE /api/bus-ops/staff/[id]/rfid-tag — soft-disable
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { normaliseNfcUid } from '@/lib/bus-checkin';
import { logAudit } from '@/lib/audit';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const tag = await tx.staffRfidTag.findUnique({ where: { staffMemberId: params.id } });
      return tag ? NextResponse.json(tag) : NextResponse.json({ error: 'No tag registered' }, { status: 404 });
  });
}


export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const tagUid = normaliseNfcUid(String(body?.tagUid ?? ''));
      if (!tagUid) return NextResponse.json({ error: 'tagUid is required' }, { status: 400 });

      // Tag UIDs are globally unique. Refuse if it's already on a different staff.
      const conflict = await tx.staffRfidTag.findUnique({ where: { tagUid } });
      if (conflict && conflict.staffMemberId !== params.id) {
        return NextResponse.json({ error: 'This tag is already registered to another staff member' }, { status: 409 });
      }

      const tag = await tx.staffRfidTag.upsert({
        where: { staffMemberId: params.id },
        update: { tagUid, isActive: body?.isActive ?? true, notes: body?.notes ?? null },
        create: { staffMemberId: params.id, tagUid, isActive: body?.isActive ?? true, notes: body?.notes ?? null },
      });

      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system',
        userRole: req.headers.get('x-user-role') ?? 'STAFF',
        entityType: 'StaffRfidTag',
        entityId: tag.id,
        action: 'UPDATE',
        details: `RFID tag ${tagUid} assigned to staff ${params.id}`,
      });

      return NextResponse.json(tag);
  });
}


export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    await tx.staffRfidTag.update({
        where: { staffMemberId: params.id },
        data: { isActive: false },
      }).catch(() => null);
      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system',
        userRole: req.headers.get('x-user-role') ?? 'STAFF',
        entityType: 'StaffRfidTag',
        action: 'DELETE',
        details: `RFID tag disabled for staff ${params.id}`,
      });
      return NextResponse.json({ ok: true });
  });
}

