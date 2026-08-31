export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(request: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const { searchParams } = new URL(request.url);
            const tenantId = searchParams.get('tenantId') ?? '';
            const activeOnly = searchParams.get('activeOnly') !== 'false';

            const plans = await tx.maintenancePlan.findMany({
                where: {
                    deletedAt: null,
                    ...(tenantId       ? { tenantId }   : {}),
                    ...(activeOnly     ? { isActive: true } : {}),
                },
                include: { triggers: true },
                orderBy: { createdAt: 'desc' },
            });

            return NextResponse.json(JSON.parse(JSON.stringify(plans)));
        } catch (e) {
            console.error('Failed to fetch PM plans:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
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

            const plan = await tx.maintenancePlan.create({
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
            } catch (e) {
            console.error('Failed to create PM plan:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
        }
  });
}

