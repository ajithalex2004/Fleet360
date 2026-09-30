export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { parsePmPlanInput } from '@/lib/maintenance/pm-plan';
export async function GET(
    _request: NextRequest,
    props: { params: Promise<{ id: string }> },
) {
    const params = await props.params;

    const authz = requireAuthorizedTenant({ headers: _request.headers, nextUrl: _request.nextUrl });
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
            if (!plan || plan.deletedAt) {
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
    request: NextRequest,
    props: { params: Promise<{ id: string }> },
) {
    const params = await props.params;

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const input = parsePmPlanInput(stripTenantOwnershipFields(await request.json().catch(() => null)), true);
            if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
            const { triggers, ...fields } = input.data;

            // RLS scopes the lookup: another tenant's plan is simply not found.
            const existing = await tx.maintenancePlan.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true } });
            if (!existing) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

            // Triggers sent replace the plan's triggers; absent, they are kept.
            const plan = await tx.maintenancePlan.update({
                where: { id: params.id },
                data: {
                    ...fields,
                    ...(triggers !== undefined ? { triggers: { deleteMany: {}, create: triggers } } : {}),
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
    _request: NextRequest,
    props: { params: Promise<{ id: string }> },
) {
    const params = await props.params;

    const authz = requireAuthorizedTenant({ headers: _request.headers, nextUrl: _request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const existing = await tx.maintenancePlan.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true } });
            if (!existing) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
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

