export const dynamic = 'force-dynamic';

/**
 * /api/leasing/inquiries/[id] — single inquiry detail / PATCH / DELETE.
 *
 * Tenant scoping: requires x-tenant-id. Refuses to touch inquiries from
 * another tenant.
 */

import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

async function guardTenant(tenantId: string, id: string) {
  const owned = await prisma.leaseInquiry.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  return { owned: !!owned } as const;
}

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const { owned } = await guardTenant(tenantId, params.id);
        if (!owned) return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
        const inquiry = await tx.leaseInquiry.findUnique({ where: { id: params.id } });
        if (!inquiry) return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
        return NextResponse.json(inquiry);
      } catch (e) {
        console.error('GET inquiry error:', e);
        return NextResponse.json({ error: 'Failed to fetch inquiry' }, { status: 500 });
      }
  });
}


// PATCH: safe partial update — only updates whitelisted fields
export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(request);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const { owned } = await guardTenant(tenantId, params.id);
    if (!owned) return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });

    const body = await request.json();

    const allowed: Record<string, unknown> = {};
    if (body.status      !== undefined) allowed.status      = body.status;
    if (body.notes       !== undefined) allowed.notes       = body.notes;
    if (body.assignedTo  !== undefined) allowed.assignedTo  = body.assignedTo;
    if (body.branchId    !== undefined) allowed.branchId    = body.branchId;
    if (body.customerName !== undefined) allowed.customerName = body.customerName;
    if (body.customerEmail !== undefined) allowed.customerEmail = body.customerEmail;
    if (body.customerPhone !== undefined) allowed.customerPhone = body.customerPhone;
    if (body.companyName !== undefined) allowed.companyName = body.companyName;
    if (body.vehicleType  !== undefined) allowed.vehicleType  = body.vehicleType;
    if (body.vehicleCount !== undefined) allowed.vehicleCount = body.vehicleCount;
    if (body.leaseType    !== undefined) allowed.leaseType    = body.leaseType;
    if (body.durationMonths !== undefined) allowed.durationMonths = body.durationMonths;

    const inquiry = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseInquiry.update({
      where: { id: params.id },
      data: allowed,
    }),
    );
    return NextResponse.json(inquiry);
  } catch (e) {
    console.error('PATCH inquiry error:', e);
    return NextResponse.json(
      { error: e?.message ?? 'Failed to update inquiry' },
      { status: 500 }
    );
  }
}

// PUT: kept for backward compat, delegates to PATCH logic
export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const authz = requireAuthorizedTenant(request);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  return PATCH(request, props);
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const { owned } = await guardTenant(tenantId, params.id);
    if (!owned) return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });

    await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseInquiry.update({
      where: { id: params.id },
      data: { deletedAt: new Date() },
    }),
    );
    return NextResponse.json({ success: true });
    } catch (e) {
    console.error('DELETE inquiry error:', e);
    return NextResponse.json({ error: 'Failed to delete inquiry' }, { status: 500 });
  }
}
