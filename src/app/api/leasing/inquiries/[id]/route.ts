import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const inquiry = await prisma.leaseInquiry.findUnique({
      where: { id: params.id },
    });
    if (!inquiry) return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
    return NextResponse.json(inquiry);
  } catch (error) {
    console.error('GET inquiry error:', error);
    return NextResponse.json({ error: 'Failed to fetch inquiry' }, { status: 500 });
  }
}

// PATCH: safe partial update  -  only updates whitelisted fields
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();

    // Only allow safe fields to be updated
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
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
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
