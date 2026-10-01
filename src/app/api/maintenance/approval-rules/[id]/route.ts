export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { parseApprovalRuleInput } from '@/lib/maintenance/approval-rules';
import { canManageApprovalRules, toRuleRow } from '@/lib/maintenance/approval-rules-db';

// PATCH  /api/maintenance/approval-rules/[id]   change a rule (tenant admins)
// DELETE /api/maintenance/approval-rules/[id]   remove a rule (soft; tenant admins)

async function handlePATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const { id } = await props.params;
    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
    const { tenantId } = authz;
    if (!canManageApprovalRules(authz.role)) {
        return NextResponse.json({ error: 'Only tenant administrators can change approval rules' }, { status: 403 });
    }

    const input = parseApprovalRuleInput(stripTenantOwnershipFields(await request.json().catch(() => null)), true);
    if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

    return withTenantRls(prisma, tenantId, async (tx) => {
        try {
            const existing = await tx.maintenanceApprovalRule.findFirst({ where: { id, tenantId, deletedAt: null } });
            if (!existing) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

            // Re-check the merged band and the auto/roles combination.
            const merged = parseApprovalRuleInput({ ...toRuleRow(existing), ...input.data }, false);
            if (!merged.ok) return NextResponse.json({ error: merged.error }, { status: 400 });

            await tx.maintenanceApprovalRule.updateMany({ where: { id, tenantId }, data: input.data });
            const updated = await tx.maintenanceApprovalRule.findFirst({ where: { id, tenantId } });
            return NextResponse.json(toRuleRow(updated!));
        } catch (e) {
            console.error('Failed to update approval rule:', e);
            return NextResponse.json({ error: 'Could not save the rule' }, { status: 500 });
        }
    });
}

async function handleDELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const { id } = await props.params;
    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
    const { tenantId } = authz;
    if (!canManageApprovalRules(authz.role)) {
        return NextResponse.json({ error: 'Only tenant administrators can change approval rules' }, { status: 403 });
    }

    return withTenantRls(prisma, tenantId, async (tx) => {
        try {
            const res = await tx.maintenanceApprovalRule.updateMany({
                where: { id, tenantId, deletedAt: null },
                data: { deletedAt: new Date(), isActive: false },
            });
            if (res.count === 0) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
            return NextResponse.json({ success: true });
        } catch (e) {
            console.error('Failed to delete approval rule:', e);
            return NextResponse.json({ error: 'Could not delete the rule' }, { status: 500 });
        }
    });
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PATCH = withAuditedAction(handlePATCH);
export const DELETE = withAuditedAction(handleDELETE);
