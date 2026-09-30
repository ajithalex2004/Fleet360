export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { checkAlertConfigPair, parseAlertConfigInput } from '@/lib/alerts/alert-config';

// These used their own PrismaClient, wrote the request body straight into
// the row (any column, tenant_id included) and hard-deleted. They now use
// the shared client, accept only the rule's own fields, and soft-delete,
// matching the list, which already hides deleted rules.

async function handlePATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const input = parseAlertConfigInput(stripTenantOwnershipFields(await request.json().catch(() => null)), true);
            if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
            const d = input.data;

            // RLS scopes the lookup: another tenant's rule is simply not found.
            const existing = await tx.alertConfig.findFirst({ where: { id: params.id, deletedAt: null } });
            if (!existing) return NextResponse.json({ error: 'Alert rule not found' }, { status: 404 });

            const pairError = checkAlertConfigPair({ ...existing, ...d });
            if (pairError) return NextResponse.json({ error: pairError }, { status: 400 });

            const { frequencyValue, thresholdValue, ...rest } = d;
            const updatedConfig = await tx.alertConfig.update({
                where: { id: params.id },
                data: {
                    ...rest,
                    ...(frequencyValue !== undefined ? { frequencyValue: BigInt(frequencyValue) } : {}),
                    ...(thresholdValue !== undefined ? { thresholdValue: BigInt(thresholdValue) } : {}),
                },
            });
            return NextResponse.json(JSON.parse(JSON.stringify(updatedConfig)));
        } catch (e) {
            console.error('Failed to update alert config:', e);
            return NextResponse.json({ error: 'Failed to update alert config' }, { status: 500 });
        }
  });
}


async function handleDELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const existing = await tx.alertConfig.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true } });
            if (!existing) return NextResponse.json({ error: 'Alert rule not found' }, { status: 404 });
            await tx.alertConfig.update({
                where: { id: params.id },
                data: { deletedAt: new Date() },
            });
            return NextResponse.json({ success: true });
            } catch (e) {
            console.error('Failed to delete alert config:', e);
            return NextResponse.json({ error: 'Failed to delete alert config' }, { status: 500 });
        }
  });
}


// Privileged writes are always audited (src/lib/audited-action.ts).
export const PATCH = withAuditedAction(handlePATCH);
export const DELETE = withAuditedAction(handleDELETE);
