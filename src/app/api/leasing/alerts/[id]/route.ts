export const dynamic = 'force-dynamic';

/**
 * /api/leasing/alerts/[id] — PATCH + DELETE single alert.
 *
 * Tenant scoping: requires x-tenant-id.
 *
 * Note: the Prisma `LeaseAlert` model has no `deletedAt` column. The
 * original DELETE route was a pre-existing type error (KNOWN-TS-001);
 * this rewrite replaces soft-delete with a status flip to RESOLVED.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const existing = await prisma.leaseAlert.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);
    const { action, acknowledgedBy, ...data } = body;

    const updateData: Record<string, unknown> = { ...data };

    if (action === 'ACKNOWLEDGE') {
      updateData.status = 'ACKNOWLEDGED';
      updateData.acknowledgedBy = acknowledgedBy ?? null;
    } else if (action === 'RESOLVE') {
      updateData.status = 'RESOLVED';
      updateData.resolvedAt = new Date();
    }

    const alert = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseAlert.update({
      where: { id: params.id },
      data: updateData,
    }),
    );
    return NextResponse.json(alert);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const existing = await prisma.leaseAlert.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    // No deletedAt column — flip to RESOLVED so the alert stops appearing
    // in the OPEN/ACKNOWLEDGED views. (Operations that need a real delete
    // can do it via a DB migration + soft-delete column later.)
    await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseAlert.update({
      where: { id: params.id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    }),
    );
    return NextResponse.json({ success: true });
    } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
