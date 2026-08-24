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
        const configs = await prisma.alertConfig.findMany({
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' }
        });
        return NextResponse.json(JSON.parse(JSON.stringify(configs)));
    } catch (error) {
        console.error('Failed to fetch alert configs:', error);
        return NextResponse.json({ error: 'Failed to fetch alert configs', details: String(error) }, { status: 500 });
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

        const config = await prisma.alertConfig.create({
            data: {
                // TODO: read tenantId from request headers via getTenantContext()
                tenantId: '',
                alertFor: body.alertFor || body.alert_for,
                alertType: body.alertType || body.alert_type,
                frequency: body.frequency,
                frequencyValue: body.frequencyValue != null ? BigInt(body.frequencyValue) : null,
                dueAlertThreshold: body.dueAlertThreshold || body.due_alert_threshold,
                thresholdValue: body.thresholdValue != null ? BigInt(body.thresholdValue) : null,
                notificationEnabled: body.notificationEnabled ?? body.notification_enabled ?? false,
                whatsappEnabled: body.whatsappEnabled ?? body.whatsapp_enabled ?? false,
                assignedIds: body.assignedIds || body.assigned_ids || [],
            }
        });

        return NextResponse.json(JSON.parse(JSON.stringify(config)), { status: 201 });
    } catch (error) {
        console.error('Failed to create alert config:', error);
        return NextResponse.json({ error: 'Failed to create alert config', details: String(error) }, { status: 500 });
    }
}
