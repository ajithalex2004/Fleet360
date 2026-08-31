export const dynamic = 'force-dynamic';

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
            const configs = await tx.alertConfig.findMany({
                where: { tenantId, deletedAt: null },
                orderBy: { createdAt: 'desc' }
            });
            return NextResponse.json(JSON.parse(JSON.stringify(configs)));
        } catch (e) {
            console.error('Failed to fetch alert configs:', e);
            return NextResponse.json({ error: 'Failed to fetch alert configs', details: String(e) }, { status: 500 });
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

            const config = await tx.alertConfig.create({
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
            } catch (e) {
            console.error('Failed to create alert config:', e);
            return NextResponse.json({ error: 'Failed to create alert config', details: String(e) }, { status: 500 });
        }
  });
}

