import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { WorkOrderStatus } from '@prisma/client';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function POST(request: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const body = await request.json();

            const newWorkOrder = await tx.workOrder.create({
                data: {
                    ...body,
                    status: WorkOrderStatus.NOT_STARTED,
                },
            });

            return NextResponse.json(newWorkOrder);
        } catch (e) {
            return NextResponse.json({ error: 'Failed to create work order' }, { status: 500 });
        }
  });
}

