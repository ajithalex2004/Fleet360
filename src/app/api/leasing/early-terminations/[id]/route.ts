export const dynamic = 'force-dynamic';

/**
 * /api/leasing/early-terminations/[id] — single termination detail + PATCH.
 *
 * Tenant scoping: requires x-tenant-id. Refuses to touch terminations from
 * another tenant.
 *
 * Approval (PATCH { action }): DRAFT → submit → PENDING_APPROVAL → approve →
 * APPROVED → execute → EXECUTED (the contract becomes TERMINATED); reject
 * cancels a pending request with the reason in its notes. With an Early
 * Termination workflow (Admin > Workflows), submit starts it and approve /
 * reject go to its waiting level. { status } is accepted for the same moves.
 * A field update can't change the status or approval, and only a draft can
 * be edited.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { approvalGate, approvalInProgress, withApprovalStart } from '@/lib/workflow/approvals';
import { sessionUser } from '@/lib/session-user';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const item = await tx.leaseEarlyTermination.findFirst({
        where: { id: params.id, tenantId },
        include: { contract: true },
      });
      return item
        ? NextResponse.json(item)
        : NextResponse.json({ error: 'Not found' }, { status: 404 });
  });
}

// The status a { status } update asks for, as an action.
const STATUS_ACTIONS: Record<string, string> = {
  PENDING_APPROVAL: 'submit', APPROVED: 'approve', CANCELLED: 'reject', EXECUTED: 'execute',
};

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const body = stripTenantOwnershipFields(await req.json().catch(() => ({})));
  const action = typeof body.action === 'string' ? body.action
    : body.status != null ? STATUS_ACTIONS[String(body.status).toUpperCase()] ?? 'unknown-status' : undefined;

  if (action === 'approve' || action === 'reject') {
    const gated = await approvalGate({
      headers: req.headers, tenantId, referenceType: 'leasing_early_termination', referenceId: params.id,
      action: action === 'reject' ? 'REJECT' : 'APPROVE', comments: String(body.reason ?? ''),
    });
    if (gated) return gated;
  } else if (action === 'execute') {
    const busy = await approvalInProgress(tenantId, 'leasing_early_termination', params.id);
    if (busy) return busy;
  }
  const me = action && action !== 'submit' ? await sessionUser(req.headers).catch(() => null) : null;

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const existing = await tx.leaseEarlyTermination.findFirst({ where: { id: params.id, tenantId } });
      if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const status = (existing.status ?? 'DRAFT').toUpperCase();
      const move = async (from: string, data: Record<string, unknown>) => {
        // Only from the expected status, so two people can't both move it.
        const { count } = await tx.leaseEarlyTermination.updateMany({
          where: { id: params.id, tenantId, status: from },
          data: { ...data, updatedAt: new Date() },
        });
        if (!count) return null;
        return tx.leaseEarlyTermination.findFirst({ where: { id: params.id, tenantId } });
      };
      const changed = () => NextResponse.json({ error: 'The termination changed; reload and try again' }, { status: 409 });

      if (action === 'submit') {
        if (status !== 'DRAFT') return NextResponse.json({ error: 'Only DRAFT terminations can be submitted' }, { status: 400 });
        const item = await move(existing.status ?? 'DRAFT', { status: 'PENDING_APPROVAL' });
        return item ? NextResponse.json(item) : changed();
      }
      if (action === 'approve') {
        if (status !== 'PENDING_APPROVAL') return NextResponse.json({ error: 'Only terminations pending approval can be approved' }, { status: 400 });
        const item = await move('PENDING_APPROVAL', { status: 'APPROVED', approvedBy: me?.email ?? 'Leasing Manager', approvedAt: new Date() });
        return item ? NextResponse.json(item) : changed();
      }
      if (action === 'reject') {
        if (status !== 'PENDING_APPROVAL') return NextResponse.json({ error: 'Only terminations pending approval can be rejected' }, { status: 400 });
        const note = `Rejected by ${me?.email ?? 'Leasing Manager'}: ${String(body.reason ?? '').trim() || 'No reason given'}`;
        const item = await move('PENDING_APPROVAL', { status: 'CANCELLED', notes: existing.notes ? `${existing.notes}\n${note}` : note });
        return item ? NextResponse.json(item) : changed();
      }
      if (action === 'execute') {
        if (status !== 'APPROVED') return NextResponse.json({ error: 'Only approved terminations can be executed' }, { status: 400 });
        const item = await move('APPROVED', { status: 'EXECUTED' });
        if (!item) return changed();
        await tx.leaseContract2.updateMany({
          where: { id: item.contractId, tenantId },
          data: { status: 'TERMINATED', updatedAt: new Date() },
        });
        return NextResponse.json(item);
      }
      if (action) return NextResponse.json({ error: `Unknown action or status: ${body.action ?? body.status}` }, { status: 400 });

      // Field update: only a draft, and never the status or approval.
      if (status !== 'DRAFT') {
        return NextResponse.json({ error: 'Only DRAFT terminations can be edited' }, { status: 409 });
      }
      const { contract: _c, status: _s, approvedBy: _b, approvedAt: _a, id: _i, terminationNo: _n, contractId: _k, ...data } = body;
      void _c; void _s; void _b; void _a; void _i; void _n; void _k;
      const item = await tx.leaseEarlyTermination.update({
        where: { id: params.id },
        data: { ...data, updatedAt: new Date() },
      });
      return NextResponse.json(item);
    } catch (e) {
      console.error('PATCH /api/leasing/early-terminations/[id] error:', e instanceof Error ? e.message : e);
      return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
  });
  return action === 'submit'
    ? withApprovalStart(response, { headers: req.headers, tenantId, referenceType: 'leasing_early_termination', referenceId: params.id })
    : response;
}
