import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET() {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

    try {
        const alerts = await prisma.alert.findMany({
            where: { deletedAt: null },
            orderBy: { dateCreated: 'desc' }
        });
        return NextResponse.json(JSON.parse(JSON.stringify(alerts)));
    } catch (error) {
        console.error('Failed to fetch alerts:', error);
        return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

    try {
        const body = await request.json();

        let relatedEntityId: string | null = null;
        if (body.vehicleId) relatedEntityId = body.vehicleId;
        else if (body.driverId) relatedEntityId = body.driverId;
        else if (body.relatedEntityId) relatedEntityId = body.relatedEntityId;

        const alert = await prisma.alert.create({
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
    } catch (error) {
        console.error('Failed to create alert:', error);
        return NextResponse.json({ error: 'Failed to create alert', details: String(error) }, { status: 500 });
    }
}
