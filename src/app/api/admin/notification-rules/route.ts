
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET() {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

    try {
        // NotificationRule/Template tables don't have a tenant_id column today,
        // but the wrap is here for consistency and to be future-proof if RLS is
        // ever added. Also ensures the read uses the canonical helper pattern.
        const rules = await withPlatformAdmin(prisma, (tx) =>
            tx.notificationRule.findMany({
                include: {
                    template: true,
                },
            })
        );
        return NextResponse.json(rules);
    } catch (error: any) {
        console.error('Error fetching rules:', error);
        return NextResponse.json({ error: `Failed to fetch rules: ${error.message}` }, { status: 500 });
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
        const rule = await withPlatformAdmin(prisma, (tx) =>
            tx.notificationRule.create({
                data: {
                    event: body.event,
                    channels: body.channels,
                    recipientTypes: body.recipientTypes,
                    specificRecipientIds: body.specificRecipientIds,
                    templateId: body.templateId,
                    isEnabled: body.isEnabled,
                },
                include: {
                    template: true,
                },
            })
        );
        return NextResponse.json(rule);
    } catch (error: any) {
        console.error('Error creating rule:', error);
        return NextResponse.json({ error: `Failed to create rule: ${error.message}` }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

    try {
        const body = await request.json();
        const rule = await withPlatformAdmin(prisma, (tx) =>
            tx.notificationRule.update({
                where: { id: body.id },
                data: {
                    event: body.event,
                    channels: body.channels,
                    recipientTypes: body.recipientTypes,
                    specificRecipientIds: body.specificRecipientIds,
                    templateId: body.templateId,
                    isEnabled: body.isEnabled,
                },
                include: {
                    template: true,
                },
            })
        );
        return NextResponse.json(rule);
    } catch (error: any) {
        console.error('Error updating rule:', error);
        return NextResponse.json({ error: `Failed to update rule: ${error.message}` }, { status: 500 });
    }
}
