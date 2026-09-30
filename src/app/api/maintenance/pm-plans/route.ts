export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { parsePmPlanInput } from '@/lib/maintenance/pm-plan';
export async function GET(request: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const { searchParams } = new URL(request.url);
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
            const input = parsePmPlanInput(stripTenantOwnershipFields(await request.json().catch(() => null)), false);
            if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
            const d = input.data;

            const plan = await tx.maintenancePlan.create({
                data: {
                    tenantId,
                    name:             d.name!,
                    description:      d.description ?? null,
                    maintenanceType:  d.maintenanceType ?? 'PREVENTIVE',
                    applicability:    { allVehicles: true },
                    gracePeriodDays:  d.gracePeriodDays  ?? 0,
                    earlyWindowDays:  d.earlyWindowDays  ?? 7,
                    earlyWindowKm:    d.earlyWindowKm    ?? 500,
                    isActive:         d.isActive         ?? true,
                    notifyDaysBefore: d.notifyDaysBefore ?? 7,
                    triggers: { create: d.triggers ?? [] },
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

