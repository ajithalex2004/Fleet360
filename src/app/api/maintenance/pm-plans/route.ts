import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId') ?? '';
        const activeOnly = searchParams.get('activeOnly') !== 'false';

        const plans = await prisma.maintenancePlan.findMany({
            where: {
                deletedAt: null,
                ...(tenantId       ? { tenantId }   : {}),
                ...(activeOnly     ? { isActive: true } : {}),
            },
            include: { triggers: true },
            orderBy: { createdAt: 'desc' },
        });

        return NextResponse.json(JSON.parse(JSON.stringify(plans)));
    } catch (error) {
        console.error('Failed to fetch PM plans:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: String(error) },
            { status: 500 },
        );
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();

        const plan = await prisma.maintenancePlan.create({
            data: {
                tenantId:         body.tenantId         ?? '',
                name:             body.name,
                description:      body.description,
                maintenanceType:  body.maintenanceType  ?? 'PREVENTIVE',
                applicability:    body.applicability    ?? { allVehicles: true },
                gracePeriodDays:  body.gracePeriodDays  ?? 0,
                earlyWindowDays:  body.earlyWindowDays  ?? 7,
                earlyWindowKm:    body.earlyWindowKm    ?? 500,
                isActive:         body.isActive         ?? true,
                notifyDaysBefore: body.notifyDaysBefore ?? 7,
                triggers: {
                    create: (body.triggers ?? []).map((t: {
                        triggerType: string;
                        intervalValue: number;
                        intervalUnit: string;
                    }) => ({
                        triggerType:   t.triggerType,
                        intervalValue: t.intervalValue,
                        intervalUnit:  t.intervalUnit,
                    })),
                },
            },
            include: { triggers: true },
        });

        return NextResponse.json(JSON.parse(JSON.stringify(plan)), { status: 201 });
    } catch (error) {
        console.error('Failed to create PM plan:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: String(error) },
            { status: 500 },
        );
    }
}
