/**
 * GET    /api/bus-ops/staff/[id]/ble-tag — read tag for staff member
 * PUT    /api/bus-ops/staff/[id]/ble-tag — register / update
 * DELETE /api/bus-ops/staff/[id]/ble-tag — soft-disable (lost / replaced)
 *
 * Body: { tagId: string, formFactor?: 'KEYRING'|'CARD'|'WRISTBAND'|'FOB',
 *         batteryReplacedAt?: ISO, isActive?: boolean, notes?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
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
    const tag = await tx.staffBleTag.findUnique({ where: { staffMemberId: params.id } });
      return tag ? NextResponse.json(tag) : NextResponse.json({ error: 'No tag registered' }, { status: 404 });
  });
}


export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  // Built inside the transaction, written after it commits — auditing from
  // inside one either loses the entry (fire-and-forget promise abandoned on
  // return) or holds this transaction's connection while logAudit checks out
  // a second one from the same pool.
  let audit: Parameters<typeof logAudit>[0] | null = null;

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const tagId = String(body?.tagId ?? '').trim();
      if (!tagId) return NextResponse.json({ error: 'tagId is required' }, { status: 400 });

      const conflict = await tx.staffBleTag.findUnique({ where: { tagId } });
      if (conflict && conflict.staffMemberId !== params.id) {
        return NextResponse.json({ error: 'This tag is already registered to another staff member' }, { status: 409 });
      }

      const tag = await tx.staffBleTag.upsert({
        where: { staffMemberId: params.id },
        update: {
          tagId,
          formFactor: body?.formFactor ?? null,
          batteryReplacedAt: body?.batteryReplacedAt ? new Date(body.batteryReplacedAt) : undefined,
          isActive: body?.isActive ?? true,
          notes: body?.notes ?? null,
        },
        create: {
          tenantId,
          staffMemberId: params.id,
          tagId,
          formFactor: body?.formFactor ?? null,
          batteryReplacedAt: body?.batteryReplacedAt ? new Date(body.batteryReplacedAt) : null,
          isActive: body?.isActive ?? true,
          notes: body?.notes ?? null,
        },
      });

      audit = {
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system',
        userRole: req.headers.get('x-user-role') ?? 'STAFF',
        entityType: 'StaffBleTag',
        entityId: tag.id,
        action: 'UPDATE',
        details: `BLE tag ${tagId} (${body?.formFactor ?? 'unspecified'}) issued to staff ${params.id}`,
      };

      return NextResponse.json(tag);
  });

  if (audit) await logAudit(audit);
  return response;
}


export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  // See the note in PUT — the audit write must happen after the transaction.
  let audit: Parameters<typeof logAudit>[0] | null = null;

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    await tx.staffBleTag.update({
        where: { staffMemberId: params.id },
        data: { isActive: false },
      }).catch(() => null);
      audit = {
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system',
        userRole: req.headers.get('x-user-role') ?? 'STAFF',
        entityType: 'StaffBleTag',
        action: 'DELETE',
        details: `BLE tag disabled (lost / returned) for staff ${params.id}`,
      };
      return NextResponse.json({ ok: true });
  });

  if (audit) await logAudit(audit);
  return response;
}

