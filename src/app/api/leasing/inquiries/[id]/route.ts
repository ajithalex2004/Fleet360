/**
 * /api/leasing/inquiries/[id] — single inquiry detail / PATCH / DELETE.
 *
 * Tenant scoping: requires x-tenant-id. Refuses to touch inquiries from
 * another tenant.
 */

import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

async function guardTenant(req: NextRequest, id: string) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return { tenantId: null, owned: false } as const;
  }
  const owned = await prisma.leaseInquiry.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  return { tenantId, owned: !!owned } as const;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { tenantId, owned } = await guardTenant(req, params.id);
    if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!owned) return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
    const inquiry = await prisma.leaseInquiry.findUnique({ where: { id: params.id } });
    if (!inquiry) return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
    return NextResponse.json(inquiry);
  } catch (error) {
    console.error('GET inquiry error:', error);
    return NextResponse.json({ error: 'Failed to fetch inquiry' }, { status: 500 });
  }
}

// PATCH: safe partial update — only updates whitelisted fields
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { tenantId, owned } = await guardTenant(request, params.id);
    if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
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

    const inquiry = await prisma.leaseInquiry.update({
      where: { id: params.id },
      data: allowed,
    });
    return NextResponse.json(inquiry);
  } catch (error: any) {
    console.error('PATCH inquiry error:', error);
    return NextResponse.json(
      { error: error?.message ?? 'Failed to update inquiry' },
      { status: 500 }
    );
  }
}

// PUT: kept for backward compat, delegates to PATCH logic
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return PATCH(request, { params });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { tenantId, owned } = await guardTenant(req, params.id);
    if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!owned) return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });

    await prisma.leaseInquiry.update({
      where: { id: params.id },
      data: { deletedAt: new Date() },
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE inquiry error:', error);
    return NextResponse.json({ error: 'Failed to delete inquiry' }, { status: 500 });
  }
}
