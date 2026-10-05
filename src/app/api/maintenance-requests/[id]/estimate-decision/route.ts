export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { checkApprover, statusKey, PENDING_ESTIMATION_APPROVAL } from '@/lib/maintenance/approval-rules';
import { callerRoleCodes, loadApprovalRules } from '@/lib/maintenance/approval-rules-db';
import {
    loadPendingEstimate, recordEstimateApproval, recordEstimateRejection, type EstimationApprovedPayload,
} from '@/lib/maintenance/estimate-decision';
import { publishEstimationApproved } from '@/lib/maintenance/publish-event';
import { runAsTenant } from '@/lib/rls-scope';
import { approvalGate } from '@/lib/workflow/approvals';

/**
 * POST /api/maintenance-requests/[id]/estimate-decision
 *   { action: 'approve', quotationId, comments? }
 *   { action: 'reject', reason }
 *
 * When the company's estimate approval workflow (Admin > Workflows) is
 * deciding the request, this is a decision on its current level, by one of
 * that level's approvers (src/lib/workflow/approvals.ts); the request
 * changes when the last level approves or one rejects. The quotation is the
 * one the workflow was started for.
 *
 * Otherwise, under the approval rules:
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
    const reason = text(body?.reason);
    if (action === 'reject' && !reason) return NextResponse.json({ error: 'Give a reason for rejecting the estimates' }, { status: 400 });

    const gated = await approvalGate({
        headers: request.headers, tenantId, referenceType: 'maintenance_estimate', referenceId: id,
        action: action === 'approve' ? 'APPROVE' : 'REJECT',
        comments: action === 'approve' ? text(body?.comments) : reason,
        checkContext: (ctx) => action === 'approve' && body?.quotationId && body.quotationId !== ctx.quotationId
            ? 'This estimate is going through approval for a different quotation. Reject it and submit again to approve another quotation.'
            : null,
    });
    if (gated) return gated;

    const pending: { approved: EstimationApprovedPayload | null } = { approved: null };
    const response = await withTenantRls(prisma, tenantId, async (tx) => {
        try {
            const { mr, quotations } = await loadPendingEstimate(tx, tenantId, id);
            if (!mr) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
            if (statusKey(mr.status) !== statusKey(PENDING_ESTIMATION_APPROVAL)) {
                return NextResponse.json({ error: `This request is ${mr.status ?? 'not pending'}, not pending estimate approval` }, { status: 409 });
            }
            const actor = authz.userId ?? 'system';

            if (action === 'reject') {
                await recordEstimateRejection(tx, { tenantId, requestId: id, actor, reason });
                return NextResponse.json({ ok: true, status: 'Under Estimation' });
            }

            const chosen = quotations.find(q => q.id === body?.quotationId);
            if (!chosen) return NextResponse.json({ error: 'Choose one of this request\'s quotations' }, { status: 400 });
            if (!Number.isFinite(chosen.amount)) return NextResponse.json({ error: 'The chosen quotation has no amount' }, { status: 400 });

            const [rules, roles] = await Promise.all([
                loadApprovalRules(tx, tenantId),
                callerRoleCodes(tx, tenantId, authz.userId, authz.role),
            ]);
            const check = checkApprover(rules, chosen.amount, roles);
            if (!check.ok) return NextResponse.json({ error: check.error, rule: check.rule.name }, { status: 403 });

            pending.approved = await recordEstimateApproval(tx, {
                tenantId, requestId: id, vehicleId: mr.vehicleId, quotation: chosen, actor, comments: text(body?.comments),
                basis: { rule: check.rule ? { id: check.rule.id, name: check.rule.name } : null, roles },
            });
            return NextResponse.json({ ok: true, status: 'Estimation Approved', amount: chosen.amount, rule: check.rule?.name ?? null });
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
