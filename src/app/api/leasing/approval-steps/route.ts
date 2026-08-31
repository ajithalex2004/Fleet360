export const dynamic = 'force-dynamic';

/**
 * /api/leasing/approval-steps — list/create/update approval steps.
 *
 * Tenant scoping: requires x-tenant-id. Reads filter by tenant; creates
 * stamp the new step with the same tenantId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const { searchParams } = new URL(req.url);
        const entityId = searchParams.get('entityId');
        const entityType = searchParams.get('entityType');

        const steps = await tx.leaseApprovalStep.findMany({
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
        return NextResponse.json({ error: 'Internal server e' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);
    const step = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseApprovalStep.create({
      data: { ...body, tenantId },
    }),
    );
    return NextResponse.json(step, { status: 201 });
    } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server e' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);
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

    const step = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseApprovalStep.update({
      where: { id },
      data: updateData,
    }),
    );
    return NextResponse.json(step);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server e' }, { status: 500 });
  }
}
