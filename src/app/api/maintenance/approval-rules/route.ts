export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { parseApprovalRuleInput } from '@/lib/maintenance/approval-rules';
import { canManageApprovalRules, isMissingTable, toRuleRow } from '@/lib/maintenance/approval-rules-db';

// GET  /api/maintenance/approval-rules   the tenant's rules (any member)
// POST /api/maintenance/approval-rules   add a rule (tenant admins)

export async function GET(request: NextRequest) {
    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
    const { tenantId } = authz;

    return withTenantRls(prisma, tenantId, async (tx) => {
        try {
            const rows = await tx.maintenanceApprovalRule.findMany({
                where: { tenantId, deletedAt: null },
                orderBy: [{ minCost: 'asc' }, { name: 'asc' }],
            });
            return NextResponse.json({ rules: rows.map(toRuleRow), canManage: canManageApprovalRules(authz.role) });
        } catch (e) {
            if (isMissingTable(e)) {
                return NextResponse.json({ error: 'Approval rules are not set up yet: the database update for them has not been run.' }, { status: 503 });
            }
            console.error('Failed to load approval rules:', e);
            return NextResponse.json({ error: 'Could not load approval rules' }, { status: 500 });
        }
    });
}

async function handlePOST(request: NextRequest) {
    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
    const { tenantId } = authz;
    if (!canManageApprovalRules(authz.role)) {
        return NextResponse.json({ error: 'Only tenant administrators can change approval rules' }, { status: 403 });
    }

    const input = parseApprovalRuleInput(stripTenantOwnershipFields(await request.json().catch(() => null)), false);
    if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
    const d = input.data;

    return withTenantRls(prisma, tenantId, async (tx) => {
        try {
            const rule = await tx.maintenanceApprovalRule.create({
                data: {
                    tenantId,
                    name: d.name!,
                    minCost: d.minCost ?? 0,
                    maxCost: d.maxCost ?? null,
                    requiredRoles: d.requiredRoles ?? [],
                    autoApprove: d.autoApprove ?? false,
                    isActive: d.isActive ?? true,
                    createdBy: authz.userId,
                },
            });
            return NextResponse.json(toRuleRow(rule), { status: 201 });
        } catch (e) {
            console.error('Failed to create approval rule:', e);
            return NextResponse.json({ error: 'Could not save the rule' }, { status: 500 });
        }
    });
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
