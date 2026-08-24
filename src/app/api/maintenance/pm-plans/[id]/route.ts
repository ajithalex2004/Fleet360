import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET(
    _request: Request,
    { params }: { params: { id: string } },
) {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

    try {
        const plan = await prisma.maintenancePlan.findUnique({
            where: { id: params.id },
            include: { triggers: true },
        });
        if (!plan) {
            return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
        }
        return NextResponse.json(JSON.parse(JSON.stringify(plan)));
    } catch (error) {
        console.error('Failed to fetch PM plan:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: String(error) },
            { status: 500 },
        );
    }
}

export async function PUT(
    request: Request,
    { params }: { params: { id: string } },
) {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

    try {
        const body = await request.json();

        // Replace triggers: delete existing, re-create from body
        const plan = await prisma.maintenancePlan.update({
            where: { id: params.id },
            data: {
                name:             body.name,
                description:      body.description,
                maintenanceType:  body.maintenanceType,
                applicability:    body.applicability,
                gracePeriodDays:  body.gracePeriodDays,
                earlyWindowDays:  body.earlyWindowDays,
                earlyWindowKm:    body.earlyWindowKm,
                isActive:         body.isActive,
                notifyDaysBefore: body.notifyDaysBefore,
                ...(body.triggers !== undefined ? {
                    triggers: {
                        deleteMany: {},
                        create: body.triggers.map((t: {
                            triggerType: string;
                            intervalValue: number;
                            intervalUnit: string;
                        }) => ({
                            triggerType:   t.triggerType,
                            intervalValue: t.intervalValue,
                            intervalUnit:  t.intervalUnit,
                        })),
                    },
                } : {}),
            },
            include: { triggers: true },
        });

        return NextResponse.json(JSON.parse(JSON.stringify(plan)));
    } catch (error) {
        console.error('Failed to update PM plan:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: String(error) },
            { status: 500 },
        );
    }
}

export async function DELETE(
    _request: Request,
    { params }: { params: { id: string } },
) {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

    try {
        await prisma.maintenancePlan.update({
            where: { id: params.id },
            data:  { deletedAt: new Date() },
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete PM plan:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: String(error) },
            { status: 500 },
        );
    }
}
