import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';
import { ensureAdminApprovalTables, getApprovalState } from '@/lib/admin-approvals';
import { recordAdminChange } from '@/lib/admin-change-history';
import { notifyAdminApprovalEvent } from '@/lib/admin-approval-notifications';
import { executeAdminApprovalAction, shouldAutoExecuteAdminApproval } from '@/lib/admin-approval-executor';

interface RouteParams { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAdminPermission(req, 'create', 'audit');
    if (auth instanceof NextResponse) return auth;

    const { id } = await params;
    await ensureAdminApprovalTables();
    const state = await getApprovalState(id);
    if (!state) return NextResponse.json({ error: 'Approval request not found' }, { status: 404 });
    if (state.tenant_id) {
      const scoped = resolveTenantBoundary(auth.ctx, state.tenant_id);
      if (scoped instanceof NextResponse) return scoped;
    }
    if (state.requested_by === auth.ctx.userId) {
      return NextResponse.json({
        error: 'Requester cannot approve their own request',
        code: 'SELF_APPROVAL_BLOCKED',
        message: 'This request was created by your current account, so a different approver is required.',
      }, { status: 403 });
    }
    if (state.status !== 'PENDING') {
      return NextResponse.json({
        error: `Request is already ${state.status}`,
        code: 'REQUEST_CLOSED',
        message: `This approval request is already ${String(state.status).toLowerCase()}.`,
      }, { status: 409 });
    }

    const body = await req.json().catch(() => ({}));
    const decision = String(body.decision ?? '').toUpperCase();
    if (decision !== 'APPROVE' && decision !== 'REJECT') {
      return NextResponse.json({
        error: 'decision must be APPROVE or REJECT',
        code: 'INVALID_DECISION',
      }, { status: 400 });
    }

    const existingVote = await prisma.$queryRawUnsafe<Array<{ decision: string | null }>>(
      `SELECT decision
         FROM admin_approval_votes
        WHERE approval_request_id = $1::uuid
          AND actor_user_id = $2
        LIMIT 1`,
      id,
      auth.ctx.userId,
    ).catch(() => []);
    const previousDecision = existingVote[0]?.decision ?? null;

    await prisma.$executeRawUnsafe(
      `INSERT INTO admin_approval_votes
         (approval_request_id, actor_user_id, actor_role, decision, note)
       VALUES ($1::uuid,$2,$3,$4,$5)
       ON CONFLICT (approval_request_id, actor_user_id)
       DO UPDATE SET decision = EXCLUDED.decision, note = EXCLUDED.note, created_at = NOW()`,
      id,
      auth.ctx.userId,
      auth.ctx.role,
      decision,
      body.note ? String(body.note) : null,
    );

    const next = await getApprovalState(id);
    if (!next) return NextResponse.json({ error: 'Approval request not found' }, { status: 404 });

    let status = next.status;
    if (decision === 'REJECT' || Number(next.rejections ?? 0) > 0) status = 'REJECTED';
    if (decision === 'APPROVE' && Number(next.approvals ?? 0) >= Number(next.required_approvals ?? 2)) status = 'APPROVED';

    if (status !== next.status) {
      await prisma.$executeRawUnsafe(
        `UPDATE admin_approval_requests
            SET status = $1, decided_at = CASE WHEN $1 IN ('APPROVED','REJECTED') THEN NOW() ELSE decided_at END,
                updated_at = NOW()
          WHERE id = $2::uuid`,
        status,
        id,
      );
    }

    const finalState = status === next.status
      ? next
      : {
          ...next,
          status,
        };
    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId: next.tenant_id ?? auth.ctx.tenantId,
      entityType: 'AdminApprovalRequest',
      entityId: id,
      action: decision,
      before: {
        status: state.status,
        approvals: Number(state.approvals ?? 0),
        rejections: Number(state.rejections ?? 0),
        actorDecision: previousDecision,
      },
      after: {
        status,
        approvals: Number(finalState?.approvals ?? next.approvals ?? 0),
        rejections: Number(finalState?.rejections ?? next.rejections ?? 0),
        requiredApprovals: Number(finalState?.required_approvals ?? next.required_approvals ?? 2),
        actorDecision: decision,
      },
      summary: `${decision === 'APPROVE' ? 'Approved' : 'Rejected'} admin approval request ${id}.`,
    });
    if (status === 'APPROVED' || status === 'REJECTED') {
      await notifyAdminApprovalEvent({
        approvalId: id,
        tenantId: next.tenant_id ?? auth.ctx.tenantId,
        requesterId: auth.ctx.userId,
        action: next.action,
        summary: `${status.toLowerCase()} admin approval request ${id}.`,
        event: status === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        policy: finalState.approval_policy_json ?? next.approval_policy_json ?? null,
      });
    }

    const approvals = Number(finalState.approvals ?? next.approvals ?? 0);
    const rejections = Number(finalState.rejections ?? next.rejections ?? 0);
    const requiredApprovals = Number(finalState.required_approvals ?? next.required_approvals ?? 2);
    const remainingApprovals = Math.max(requiredApprovals - approvals, 0);
    const unchangedVote = previousDecision === decision;
    const message = status === 'APPROVED'
      ? 'Approval quorum reached. The request is now approved.'
      : status === 'REJECTED'
        ? 'The request has been rejected.'
        : unchangedVote
          ? `Your ${decision.toLowerCase()} vote is already recorded. ${remainingApprovals} more approval${remainingApprovals === 1 ? '' : 's'} required.`
          : `Vote recorded. ${remainingApprovals} more approval${remainingApprovals === 1 ? '' : 's'} required.`;

    let executionPayload: Record<string, unknown> | null = null;
    if (status === 'APPROVED' && shouldAutoExecuteAdminApproval(next.action)) {
      const executed = await executeAdminApprovalAction(req, auth.ctx, id);
      if (executed?.ok) {
        const body = await executed.json().catch(() => null);
        executionPayload = body && typeof body === 'object' ? body as Record<string, unknown> : { ok: true };
      }
    }

    return NextResponse.json({
      ok: true,
      status,
      approvals,
      rejections,
      requiredApprovals,
      remainingApprovals,
      previousDecision,
      actorDecision: decision,
      unchangedVote,
      message,
      execution: executionPayload,
    });
  } catch (error) {
    console.error('[admin/approvals/vote] POST error:', error);
    return NextResponse.json({
      error: 'Vote failed',
      code: 'VOTE_ROUTE_ERROR',
      message: error instanceof Error ? error.message : 'Unexpected vote error',
    }, { status: 500 });
  }
}
