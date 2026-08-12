/**
 * /api/leasing/approval-steps — list/create/update approval steps.
 *
 * Tenant scoping: requires x-tenant-id. Reads filter by tenant; creates
 * stamp the new step with the same tenantId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const entityId = searchParams.get('entityId');
    const entityType = searchParams.get('entityType');

    const steps = await prisma.leaseApprovalStep.findMany({
      where: {
        tenantId,
        ...(entityId ? { entityId } : {}),
        ...(entityType ? { entityType } : {}),
      },
      orderBy: [{ entityId: 'asc' }, { stepOrder: 'asc' }],
    });
    return NextResponse.json(steps);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const step = await prisma.leaseApprovalStep.create({
      data: { ...body, tenantId },
    });
    return NextResponse.json(step, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const { id, action, approverName, comments, ...data } = body;

    const existing = await prisma.leaseApprovalStep.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = { ...data };
    if (action === 'APPROVE') {
      updateData.status = 'APPROVED';
      updateData.actionAt = new Date();
      if (approverName) updateData.approverName = approverName;
      if (comments) updateData.comments = comments;
    } else if (action === 'REJECT') {
      updateData.status = 'REJECTED';
      updateData.actionAt = new Date();
      if (approverName) updateData.approverName = approverName;
      if (comments) updateData.comments = comments;
    }

    const step = await prisma.leaseApprovalStep.update({
      where: { id },
      data: updateData,
    });
    return NextResponse.json(step);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
