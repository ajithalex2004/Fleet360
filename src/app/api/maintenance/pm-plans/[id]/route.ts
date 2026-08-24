import { NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(
    _request: Request,
    { params }: { params: { id: string } },
) {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const plan = await tx.maintenancePlan.findUnique({
                where: { id: params.id },
                include: { triggers: true },
            });
            if (!plan) {
                return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
            }
            return NextResponse.json(JSON.parse(JSON.stringify(plan)));
        } catch (e) {
            console.error('Failed to fetch PM plan:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
        }
  });
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

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const body = await request.json();

            // Replace triggers: delete existing, re-create from body
            const plan = await tx.maintenancePlan.update({
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
        } catch (e) {
            console.error('Failed to update PM plan:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
        }
  });
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

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            await tx.maintenancePlan.update({
                where: { id: params.id },
                data:  { deletedAt: new Date() },
            });
            return NextResponse.json({ success: true });
            } catch (e) {
            console.error('Failed to delete PM plan:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
        }
  });
}

