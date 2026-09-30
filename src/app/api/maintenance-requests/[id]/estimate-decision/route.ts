export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import {
    checkApprover, statusKey, ESTIMATION_APPROVED, PENDING_ESTIMATION_APPROVAL, UNDER_ESTIMATION,
} from '@/lib/maintenance/approval-rules';
import { callerRoleCodes, loadApprovalRules } from '@/lib/maintenance/approval-rules-db';
import { publishEstimationApproved } from '@/lib/maintenance/publish-event';
import { runAsTenant } from '@/lib/rls-scope';

/**
 * POST /api/maintenance-requests/[id]/estimate-decision
 *   { action: 'approve', quotationId, comments? }
 *   { action: 'reject', reason }
 *
 * Approve: the chosen quotation must belong to the request; the approver
 * must satisfy the tenant's approval rule for its amount. The quotation is
 * marked APPROVED and the others REJECTED; the request moves to
 * Estimation Approved with the quotation's amount and garage, and the
 * approval (who, when, which quotation, which rule) is recorded.
 * Reject: every quotation is REJECTED and the request goes back to
 * Under Estimation with the reason in its status history.
 */
async function handlePOST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const { id } = await props.params;
    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
    const { tenantId } = authz;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = body?.action;
    if (action !== 'approve' && action !== 'reject') {
        return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
    }
    const text = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 2000) : '');

    const pending: { approved: Parameters<typeof publishEstimationApproved>[2] | null } = { approved: null };
    const response = await withTenantRls(prisma, tenantId, async (tx) => {
        try {
            const mr = await tx.maintenanceRequest.findFirst({
                where: { id, tenantId, deletedAt: null },
                select: { id: true, status: true, vehicleId: true },
            });
            if (!mr) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
            if (statusKey(mr.status) !== statusKey(PENDING_ESTIMATION_APPROVAL)) {
                return NextResponse.json({ error: `This request is ${mr.status ?? 'not pending'}, not pending estimate approval` }, { status: 409 });
            }
            const quotations = await tx.quotation.findMany({
                where: { tenantId, maintenanceRequestId: id, deletedAt: null },
                select: { id: true, grandTotal: true, totalCost: true, garageId: true },
            });
            const actor = authz.userId ?? 'system';
            const now = new Date();

            if (action === 'reject') {
                const reason = text(body?.reason);
                if (!reason) return NextResponse.json({ error: 'Give a reason for rejecting the estimates' }, { status: 400 });
                await tx.quotation.updateMany({ where: { tenantId, maintenanceRequestId: id, deletedAt: null }, data: { status: 'REJECTED' } });
                await tx.maintenanceRequest.updateMany({ where: { id, tenantId }, data: { status: UNDER_ESTIMATION } });
                await tx.statusHistory.create({
                    data: { tenantId, maintenanceRequestId: id, status: UNDER_ESTIMATION, date: now, note: `Estimates rejected: ${reason}`, actor },
                });
                return NextResponse.json({ ok: true, status: UNDER_ESTIMATION });
            }

            const chosen = quotations.find(q => q.id === body?.quotationId);
            if (!chosen) return NextResponse.json({ error: 'Choose one of this request\'s quotations' }, { status: 400 });
            const amount = Number(chosen.grandTotal ?? chosen.totalCost ?? NaN);
            if (!Number.isFinite(amount)) return NextResponse.json({ error: 'The chosen quotation has no amount' }, { status: 400 });

            const [rules, roles] = await Promise.all([
                loadApprovalRules(tx, tenantId),
                callerRoleCodes(tx, tenantId, authz.userId, authz.role),
            ]);
            const check = checkApprover(rules, amount, roles);
            if (!check.ok) return NextResponse.json({ error: check.error, rule: check.rule.name }, { status: 403 });

            const comments = text(body?.comments);
            await tx.quotation.updateMany({ where: { tenantId, maintenanceRequestId: id, deletedAt: null, id: { not: chosen.id } }, data: { status: 'REJECTED' } });
            await tx.quotation.updateMany({ where: { tenantId, id: chosen.id }, data: { status: 'APPROVED' } });
            await tx.maintenanceRequest.updateMany({
                where: { id, tenantId },
                data: {
                    status: ESTIMATION_APPROVED,
                    estimatedCost: amount,
                    ...(chosen.garageId ? { garageId: chosen.garageId } : {}),
                    estimateApproval: JSON.stringify({
                        quotationId: chosen.id, amount, approvedBy: actor, roles, approvedAt: now.toISOString(),
                        rule: check.rule ? { id: check.rule.id, name: check.rule.name } : null, comments: comments || null,
                    }),
                },
            });
            await tx.statusHistory.create({
                data: {
                    tenantId, maintenanceRequestId: id, status: ESTIMATION_APPROVED, date: now, actor,
                    note: `Estimate approved (AED ${amount.toLocaleString('en-AE')})${check.rule ? ` under rule "${check.rule.name}"` : ''}${comments ? `: ${comments}` : ''}`,
                },
            });
            const garage = chosen.garageId
                ? await tx.garage.findFirst({ where: { id: chosen.garageId }, select: { name: true } }).catch(() => null)
                : null;
            pending.approved = {
                requestId: id, vehicleId: mr.vehicleId ?? '', tenantId,
                garageId: chosen.garageId ?? null, garageName: garage?.name ?? null,
                estimatedCost: amount, currency: 'AED', approvedBy: actor, approvedAt: now.toISOString(),
            };
            return NextResponse.json({ ok: true, status: ESTIMATION_APPROVED, amount, rule: check.rule?.name ?? null });
        } catch (e) {
            console.error('Failed to record estimate decision:', e);
            return NextResponse.json({ error: 'Could not record the decision' }, { status: 500 });
        }
    });
    // Published after the transaction commits, as the tenant.
    const approved = pending.approved;
    if (approved) {
        void runAsTenant(tenantId, () => publishEstimationApproved(id, tenantId, approved))
            .catch(err => console.warn('[maintenance] estimation_approved publish failed:', err));
    }
    return response;
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
