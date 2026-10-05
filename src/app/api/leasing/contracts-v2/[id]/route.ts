export const dynamic = 'force-dynamic';

/**
 * /api/leasing/contracts-v2/[id] — V2 contract detail route.
 *
 * Tenant scoping: every operation requires x-tenant-id and refuses to read
 * or mutate contracts from another tenant.
 *
 * Approval (PATCH { action }): DRAFT → submit → PENDING_APPROVAL → approve →
 * APPROVED → activate → ACTIVE; reject returns a pending contract to DRAFT
 * with the reason in its notes. With a Contract Approval workflow (Admin >
 * Workflows), submit starts it and approve / reject go to its waiting level.
 * A plain field update can't change the status or approval.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { getSignature } from '@/lib/leasing/esignature-store';
import { approvalGate, approvalRequired, withApprovalStart } from '@/lib/workflow/approvals';
import { sessionUser } from '@/lib/session-user';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const contract = await tx.leaseContract2.findFirst({
          where: { id: params.id, tenantId, deletedAt: null },
          include: {
            lessee: true,
            vehicles: true,
            payments2: { orderBy: { dueDate: 'asc' } },
            receipts: { orderBy: { createdAt: 'desc' } },
            exchanges: { orderBy: { exchangeDate: 'desc' } },
            alerts: { orderBy: { createdAt: 'desc' } },
            openingBranch: true,
            closingBranch: true,
            quotation: true,
          },
        });
        if (!contract) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        const signature = await getSignature(tenantId, 'CONTRACT', contract.id);
        return NextResponse.json({ ...contract, signature });
      } catch (e) {
        console.error(e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
      }
  });
}


const STATUS_TEXT = (s: string) => s.toLowerCase().replace(/_/g, ' ');

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const bodyRaw = await req.json().catch(() => ({}));
  const body = stripTenantOwnershipFields(bodyRaw);
  // { status: 'ACTIVE' } is the older way of activating.
  const action = typeof body.action === 'string' ? body.action
    : String(body.status ?? '').toUpperCase() === 'ACTIVE' ? 'activate' : undefined;
  if (action === 'approve' || action === 'reject') {
    const gated = await approvalGate({
      headers: req.headers, tenantId, referenceType: 'leasing_contract', referenceId: params.id,
      action: action === 'reject' ? 'REJECT' : 'APPROVE', comments: String(body.reason ?? ''),
    });
    if (gated) return gated;
  }
  // Who approved / returned / activated, for the contract's record.
  const me = action && action !== 'submit' ? await sessionUser(req.headers).catch(() => null) : null;
  // With a Contract Approval workflow, only an approved contract can be
  // activated; without one, a draft can be activated directly as before.
  const approvalNeeded = action === 'activate' ? await approvalRequired(tenantId, 'leasing_contract') : false;

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const existing = await tx.leaseContract2.findFirst({
        where: { id: params.id, tenantId, deletedAt: null },
      });
      if (!existing) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      const status = (existing.status ?? 'DRAFT').toUpperCase();
      const move = async (from: string, data: Record<string, unknown>) => {
        // Only from the expected status, so two people can't both move it.
        const { count } = await tx.leaseContract2.updateMany({
          where: { id: params.id, tenantId, deletedAt: null, status: from },
          data: { ...data, updatedAt: new Date() },
        });
        if (!count) return NextResponse.json({ error: 'The contract changed; reload and try again' }, { status: 409 });
        return NextResponse.json(await tx.leaseContract2.findFirst({ where: { id: params.id, tenantId } }));
      };

      if (action === 'submit') {
        if (status !== 'DRAFT') return NextResponse.json({ error: 'Only DRAFT contracts can be submitted' }, { status: 400 });
        return move(existing.status ?? 'DRAFT', { status: 'PENDING_APPROVAL' });
      }
      if (action === 'approve') {
        if (status !== 'PENDING_APPROVAL') return NextResponse.json({ error: 'Only contracts pending approval can be approved' }, { status: 400 });
        return move('PENDING_APPROVAL', { status: 'APPROVED', approvedBy: me?.email ?? 'Leasing Manager', approvedAt: new Date() });
      }
      if (action === 'reject') {
        if (status !== 'PENDING_APPROVAL') return NextResponse.json({ error: 'Only contracts pending approval can be returned' }, { status: 400 });
        const reason = String(body.reason ?? '').trim() || 'No reason given';
        const note = `Returned by ${me?.email ?? 'Leasing Manager'}: ${reason}`;
        return move('PENDING_APPROVAL', { status: 'DRAFT', notes: existing.notes ? `${existing.notes}\n${note}` : note });
      }
      if (action === 'activate') {
        if (status !== 'APPROVED' && !(status === 'DRAFT' && !approvalNeeded)) {
          return NextResponse.json({
            error: status === 'DRAFT'
              ? 'This contract needs approval first: submit it for approval'
              : `A ${STATUS_TEXT(status)} contract can't be activated`,
          }, { status: 400 });
        }
        // Operational activation rule: activating a contract requires >=1 allocated vehicle
        const vehicleCount = await tx.leaseContractVehicle.count({
          where: { contractId: params.id, tenantId, status: 'ACTIVE' },
        });
        if (vehicleCount === 0) {
          return NextResponse.json({ error: 'Cannot activate contract without allocated vehicles' }, { status: 400 });
        }
        return move(existing.status ?? 'DRAFT', {
          status: 'ACTIVE', ...(existing.approvedAt ? {} : { approvedAt: new Date(), approvedBy: me?.email ?? null }),
        });
      }
      if (action) return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });

      // Field update. Status and approval only change through the actions
      // above, and a contract waiting for approval stays as submitted.
      if (status === 'PENDING_APPROVAL') {
        return NextResponse.json({ error: 'This contract is waiting for approval; return it to draft to change it' }, { status: 409 });
      }
      const { status: _s, approvedBy: _b, approvedAt: _a, id: _i, action: _x, ...fields } = body;
      void _s; void _b; void _a; void _i; void _x;
      const contract = await tx.leaseContract2.update({
        where: { id: params.id },
        data: { ...fields, updatedAt: new Date() },
      });
      return NextResponse.json(contract);
    } catch (e: any) {
      console.error('PATCH /api/leasing/contracts-v2/[id] error:', e?.message);
      return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: e?.status || 500 });
    }
  });
  return action === 'submit'
    ? withApprovalStart(response, { headers: req.headers, tenantId, referenceType: 'leasing_contract', referenceId: params.id })
    : response;
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const existing = await tx.leaseContract2.findFirst({
        where: { id: params.id, tenantId },
        select: { id: true },
      });
      if (!existing) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      await tx.leaseContract2.update({
        where: { id: params.id },
        data: { deletedAt: new Date(), status: 'TERMINATED' },
      });
      return NextResponse.json({ success: true });
    } catch (e: any) {
      console.error('DELETE /api/leasing/contracts-v2/[id] error:', e?.message);
      return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: e?.status || 500 });
    }
  });
}
