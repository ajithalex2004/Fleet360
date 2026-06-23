import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDangerApproval } from '@/lib/admin-policy';
import { assertStatusTransition, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { requireLeaseContractInTenant } from '@/lib/leasing-governance';

function isDangerousLeaseContractPatch(beforeStatus?: string | null, nextStatus?: string | null) {
  return Boolean(nextStatus && nextStatus !== beforeStatus && ['SUSPENDED', 'TERMINATED', 'CLOSED'].includes(nextStatus));
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = requireOperationalContext(req, 'leasing');
    if (ctx instanceof NextResponse) return ctx;
    const boundary = await requireLeaseContractInTenant(params.id, ctx);
    if (boundary) return boundary;
    const contract = await prisma.leaseContract2.findUnique({
      where: { id: params.id },
      include: { vehicles: true, payments2: true, receipts: true },
    });
    if (!contract) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(contract);
  } catch (error) {
    console.error('Error fetching contract:', error);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = requireOperationalContext(req, 'leasing', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const boundary = await requireLeaseContractInTenant(params.id, ctx);
    if (boundary) return boundary;
    const body = await req.json();
    const before = await prisma.leaseContract2.findUnique({ where: { id: params.id } });
    const transition = assertStatusTransition('leaseContract', before?.status, body.status);
    if (transition) return transition;
    if (isDangerousLeaseContractPatch(before?.status, body.status)) {
      const approval = await requireDangerApproval(req, {
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        role: ctx.role,
        isSuperAdmin: ctx.isSuperAdmin,
        isTenantAdmin: ctx.role === 'TENANT_ADMIN',
      }, 'leasing.contract.status_change', {
        tenantId: ctx.tenantId,
        targetType: 'LeaseContract',
        targetId: params.id,
        summary: `Change lease contract ${before?.contractNumber ?? params.id} status from ${before?.status ?? 'unknown'} to ${body.status}`,
        payload: { before, after: { ...before, ...body } },
        requiredApprovals: 2,
      });
      if (approval) return approval;
    }
    const contract = await prisma.leaseContract2.update({
      where: { id: params.id },
      data: { ...body, updatedAt: new Date() },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'LeaseContract',
      entityId: params.id,
      action: body.status !== undefined && body.status !== before?.status ? 'STATUS_CHANGE' : 'UPDATE',
      before,
      after: contract,
      summary: `Updated lease contract ${contract.contractNumber ?? params.id} via canonical contract API`,
    });
    return NextResponse.json(contract);
  } catch (error) {
    console.error('Error updating contract:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = requireOperationalContext(req, 'leasing', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const boundary = await requireLeaseContractInTenant(params.id, ctx);
    if (boundary) return boundary;
    const before = await prisma.leaseContract2.findUnique({ where: { id: params.id } });
    const approval = await requireDangerApproval(req, {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      role: ctx.role,
      isSuperAdmin: ctx.isSuperAdmin,
      isTenantAdmin: ctx.role === 'TENANT_ADMIN',
    }, 'leasing.contract.terminate', {
      tenantId: ctx.tenantId,
      targetType: 'LeaseContract',
      targetId: params.id,
      summary: `Terminate lease contract ${before?.contractNumber ?? params.id}`,
      payload: { before, after: { deletedAt: new Date().toISOString(), status: 'TERMINATED' } },
      requiredApprovals: 2,
    });
    if (approval) return approval;
    const contract = await prisma.leaseContract2.update({
      where: { id: params.id },
      data: { deletedAt: new Date(), status: 'TERMINATED', updatedAt: new Date() },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'LeaseContract',
      entityId: params.id,
      action: 'DELETE',
      before,
      after: contract,
      summary: `Terminated lease contract ${contract.contractNumber ?? params.id} via canonical contract API`,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting contract:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
