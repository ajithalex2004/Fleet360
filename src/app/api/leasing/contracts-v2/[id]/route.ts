import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDangerApproval } from '@/lib/admin-policy';
import {
  assertStatusTransition,
  ensureOperationalTenantColumn,
  recordOperationalChange,
  requireOperationalContext,
  requireOperationalPermission,
} from '@/lib/cross-module-governance';
import { creditGateResponse, evaluateLeasingCreditGate } from '@/lib/leasing-credit-policy';
import { markLeasingRuntimeActionExecuted, requireLeasingRuntimeApproval } from '@/lib/leasing-runtime-approvals';
import {
  releaseLeaseContractVehicles,
  setContractVehiclesAssignedStatus,
} from '@/lib/leasing-vehicle-lifecycle';

type Params = { params: Promise<{ id: string }> };

async function leaseContractBelongsToTenant(id: string, tenantId: string) {
  await ensureOperationalTenantColumn('lease_contracts_v2');
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text AS id FROM lease_contracts_v2 WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
    id,
    tenantId,
  );
  return rows.length > 0;
}

function isDangerousLeaseContractPatch(beforeStatus?: string | null, nextStatus?: string | null) {
  return Boolean(nextStatus && nextStatus !== beforeStatus && ['SUSPENDED', 'TERMINATED', 'CLOSED'].includes(nextStatus));
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function closeNotes(existing: string | null | undefined, body: Record<string, unknown>) {
  const notes = [
    body.returnCondition ? `Return condition: ${String(body.returnCondition)}` : '',
    body.returnMileage ? `Return mileage: ${String(body.returnMileage)}` : '',
    body.depositSettlementAmount ? `Deposit settlement: ${String(body.depositSettlementAmount)} ${String(body.currency ?? 'AED')}` : '',
    body.finalReceiptAmount ? `Final receipt amount: ${String(body.finalReceiptAmount)} ${String(body.currency ?? 'AED')}` : '',
  ].filter(Boolean);
  if (notes.length === 0) return existing ?? null;
  return [existing, `[Close workflow ${new Date().toISOString()}] ${notes.join(' | ')}`].filter(Boolean).join('\n');
}

function sanitizeContractPatch(body: Record<string, unknown>, nextStatus?: string | null) {
  const excluded = new Set([
    'action',
    'returnCondition',
    'returnMileage',
    'depositSettlementAmount',
    'depositSettlementType',
    'finalReceiptAmount',
    'finalReceiptPaymentMethod',
    'finalReceiptNotes',
  ]);
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (excluded.has(key)) continue;
    data[key] = value;
  }
  if (nextStatus) data.status = nextStatus;
  return data;
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'leasing');
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await leaseContractBelongsToTenant(id, ctx.tenantId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const contract = await prisma.leaseContract2.findFirst({
      where: { id, deletedAt: null },
      include: {
        lessee: true,
        vehicles: true,
        payments2: { orderBy: { dueDate: 'asc' } },
        receipts: { orderBy: { createdAt: 'desc' } },
        exchanges: { orderBy: { exchangeDate: 'desc' } },
        alerts: { where: { // @ts-expect-error unresolved legacy relation typing
      resolvedAt: false }, orderBy: { createdAt: 'desc' } },
        openingBranch: true,
        closingBranch: true,
        quotation: true,
      },
    });
    if (!contract) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(contract);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'leasing', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const permission = await requireOperationalPermission(ctx, [
      { module: 'leasing', action: 'approve', resource: 'contracts' },
      { module: 'leasing', action: 'edit', resource: 'contracts' },
    ], { message: 'You do not have access to update Leasing contracts' });
    if (permission) return permission;
    const { id } = await params;
    if (!(await leaseContractBelongsToTenant(id, ctx.tenantId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await req.json() as Record<string, unknown>;
    const requestedStatus = body.action === 'close'
      ? 'CLOSED'
      : typeof body.status === 'string'
        ? body.status
        : undefined;
    const before = await prisma.leaseContract2.findUnique({
      where: { id },
      include: { vehicles: true },
    });
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const transition = assertStatusTransition('leaseContract', before?.status, requestedStatus);
    if (transition) return transition;
    const isCloseWorkflow = requestedStatus === 'CLOSED' && body.action === 'close';
    let runtimeActionId: string | null = null;
    if (requestedStatus === 'ACTIVE' && before?.status !== 'ACTIVE') {
      const gate = await evaluateLeasingCreditGate({
        lesseeId: before?.lesseeId,
        proposedExposure: Number(before?.totalContractValue ?? 0) || Number(before?.monthlyRate ?? 0),
        currency: before?.currency,
        excludeContractId: id,
      });
      const blocked = creditGateResponse(gate);
      if (blocked) return blocked;

      const runtimeApproval = await requireLeasingRuntimeApproval(req, ctx, {
        serviceTypeKey: 'LEASING_CONTRACT_ACTIVATION',
        entityType: 'CONTRACT',
        entityId: id,
        actionKey: 'contract_activation',
        referenceNumber: before?.contractNumber ?? id,
        amount: Number(before?.totalContractValue ?? 0) || Number(before?.monthlyRate ?? 0),
        currency: before?.currency ?? 'AED',
        summary: `Activate lease contract ${before?.contractNumber ?? id}`,
        payload: {
          before: { status: before?.status },
          after: { status: 'ACTIVE' },
          contractId: id,
          lesseeId: before?.lesseeId,
          quotationId: before?.quotationId,
        },
        contractId: id,
        quotationId: before?.quotationId ?? null,
      });
      if (!runtimeApproval.ok) return runtimeApproval.response;
      runtimeActionId = runtimeApproval.actionId;
    }
    if (isDangerousLeaseContractPatch(before?.status, requestedStatus) && !isCloseWorkflow) {
      const approval = await requireDangerApproval(req, {
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        role: ctx.role,
        isSuperAdmin: ctx.isSuperAdmin,
        isTenantAdmin: ctx.role === 'TENANT_ADMIN',
      }, 'leasing.contract.status_change', {
        tenantId: ctx.tenantId,
        targetType: 'LeaseContract',
        targetId: id,
        summary: `Change lease contract ${before?.contractNumber ?? id} status from ${before?.status ?? 'unknown'} to ${requestedStatus}`,
        payload: { before, after: { ...before, ...body, status: requestedStatus } },
        requiredApprovals: 2,
      });
      if (approval) return approval;
    }
    const updateData = sanitizeContractPatch(body, requestedStatus);
    if (isCloseWorkflow) {
      updateData.closingBranchId = body.closingBranchId ?? before.closingBranchId ?? null;
      updateData.notes = closeNotes(before.notes, body);
    }
    updateData.updatedAt = new Date();
    const contract = await prisma.leaseContract2.update({
      where: { id },
      data: updateData,
    });
    let releasedVehicleIds: string[] = [];
    if (requestedStatus === 'ACTIVE' && before.status !== 'ACTIVE') {
      await setContractVehiclesAssignedStatus(id, requestedStatus);
    }
    let finalReceipt = null;
    if (isCloseWorkflow) {
      releasedVehicleIds = await releaseLeaseContractVehicles(id, {
        branchId: String(updateData.closingBranchId ?? ''),
        mileage: numberOrNull(body.returnMileage),
      });
      const finalReceiptAmount = numberOrNull(body.finalReceiptAmount);
      if (finalReceiptAmount && finalReceiptAmount > 0) {
        finalReceipt = await prisma.leaseReceipt.create({
          data: {
            receiptNumber: `RCP-FIN-${Date.now().toString().slice(-8)}`,
            contractId: id,
            paymentType: 'SECURITY',
            amount: finalReceiptAmount,
            currency: contract.currency ?? 'AED',
            receivedDate: new Date(),
            paymentMethod: typeof body.finalReceiptPaymentMethod === 'string' ? body.finalReceiptPaymentMethod : 'BANK_TRANSFER',
            receivedBy: ctx.userId,
            branchId: typeof updateData.closingBranchId === 'string' ? updateData.closingBranchId : null,
            notes: typeof body.finalReceiptNotes === 'string' ? body.finalReceiptNotes : 'Final settlement receipt from agreement close workflow',
          },
        });
      }
    }
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'LeaseContract',
      entityId: id,
      action: requestedStatus !== undefined && requestedStatus !== before?.status ? 'STATUS_CHANGE' : 'UPDATE',
      before,
      after: { contract, releasedVehicleIds, finalReceipt },
      summary: `Updated lease contract ${contract.contractNumber ?? id}`,
    });
    await markLeasingRuntimeActionExecuted(runtimeActionId);
    return NextResponse.json(contract);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'leasing', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await leaseContractBelongsToTenant(id, ctx.tenantId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const before = await prisma.leaseContract2.findUnique({ where: { id } });
    const approval = await requireDangerApproval(req, {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      role: ctx.role,
      isSuperAdmin: ctx.isSuperAdmin,
      isTenantAdmin: ctx.role === 'TENANT_ADMIN',
    }, 'leasing.contract.terminate', {
      tenantId: ctx.tenantId,
      targetType: 'LeaseContract',
      targetId: id,
      summary: `Terminate lease contract ${before?.contractNumber ?? id}`,
      payload: { before, after: { deletedAt: new Date().toISOString(), status: 'TERMINATED' } },
      requiredApprovals: 2,
    });
    if (approval) return approval;
    const contract = await prisma.leaseContract2.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'TERMINATED' },
    });
    const releasedVehicleIds = await releaseLeaseContractVehicles(id, {
      branchId: before?.closingBranchId ?? before?.openingBranchId ?? null,
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'LeaseContract',
      entityId: id,
      action: 'DELETE',
      before,
      after: { contract, releasedVehicleIds },
      summary: `Terminated lease contract ${contract.contractNumber ?? id}`,
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
