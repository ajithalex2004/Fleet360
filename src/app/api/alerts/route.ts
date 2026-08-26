import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const alerts = await tx.alert.findMany({
                where: { tenantId, deletedAt: null },
                orderBy: { dateCreated: 'desc' }
            });
            return NextResponse.json(JSON.parse(JSON.stringify(alerts)));
        } catch (e) {
            console.error('Failed to fetch alerts:', e);
            return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 });
        }
  });
}


export async function POST(request: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const body = await request.json();

            let relatedEntityId: string | null = null;
            if (body.vehicleId) relatedEntityId = body.vehicleId;
            else if (body.driverId) relatedEntityId = body.driverId;
            else if (body.relatedEntityId) relatedEntityId = body.relatedEntityId;

            const alert = await tx.alert.create({
                data: {
                    // TODO: read tenantId from request headers via getTenantContext()
                    tenantId: '',
                    type: body.type,
                    title: body.title,
                    description: body.description,
                    severity: body.severity,
                    status: body.status || 'PENDING',
                    assignedTo: body.assignedTo,
                    relatedEntityId,
                    dateCreated: new Date(),
                }
            });

            return NextResponse.json(JSON.parse(JSON.stringify(alert)), { status: 201 });
            } catch (e) {
            console.error('Failed to create alert:', e);
            return NextResponse.json({ error: 'Failed to create alert', details: String(e) }, { status: 500 });
        }
  });
}

