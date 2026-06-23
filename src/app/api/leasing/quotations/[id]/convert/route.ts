import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  attachTenantToEntity,
  ensureOperationalTenantColumn,
  recordOperationalChange,
  requireOperationalContext,
  requireOperationalPermission,
} from '@/lib/cross-module-governance';
import { creditGateResponse, evaluateLeasingCreditGate } from '@/lib/leasing-credit-policy';
import { nextLeaseContractNumber } from '@/lib/leasing-numbering';
import { markLeasingRuntimeActionExecuted, requireLeasingRuntimeApproval } from '@/lib/leasing-runtime-approvals';
import {
  assertFleetVehicleAssignable,
  buildLeaseVehicleDataFromFleet,
  loadFleetVehicleForLease,
  markFleetVehicleLeaseStatus,
  statusForLeaseAssignment,
} from '@/lib/leasing-vehicle-lifecycle';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'leasing', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const permission = await requireOperationalPermission(ctx, [
      { module: 'leasing', action: 'approve', resource: 'contracts' },
      { module: 'leasing', action: 'create', resource: 'contracts' },
    ], { message: 'You do not have access to activate Leasing contracts' });
    if (permission) return permission;
    await ensureOperationalTenantColumn('lease_contracts_v2');
    const { id } = await params;

    const body = await req.json();
    const { agreementType, openingBranchId, closingBranchId, startDate, lesseeId } = body;

    const quotation = await prisma.leaseQuotation.findFirst({
      where: { id, deletedAt: null },
      include: { vehicles: true, lineItems: true },
    });
    if (!quotation) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });

    const ALLOWED_CONVERT_STATUSES = [
      'CREDIT_APPROVED', 
      'PO_PREPARATION', 
      'PO_PREPARED', 
      'DELIVERY_IN_PROGRESS',
      'DELIVERED'
    ];

    if (!ALLOWED_CONVERT_STATUSES.includes(quotation.status ?? '')) {
      return NextResponse.json(
        { error: `Quotation must be in one of the following statuses to convert: ${ALLOWED_CONVERT_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    const existingContract = await prisma.leaseContract2.findFirst({
      where: {
        quotationId: quotation.id,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existingContract) {
      await attachTenantToEntity('lease_contracts_v2', existingContract.id, ctx.tenantId);
      return NextResponse.json(
        {
          error: 'Quotation already converted to contract',
          contractId: existingContract.id,
          contractNumber: existingContract.contractNumber,
        },
        { status: 409 },
      );
    }

    const start = startDate ? new Date(startDate) : new Date();
    const durationMonths = quotation.durationMonths ?? 24;
    const end = new Date(start);
    end.setMonth(end.getMonth() + durationMonths);

    const monthlyRate = Number(quotation.totalMonthlyRate ?? 0);
    const totalContractValue = monthlyRate * durationMonths;
    const resolvedLesseeId = lesseeId ?? quotation.lesseeId ?? '';
    const lessee = resolvedLesseeId
      ? await prisma.lessee.findUnique({
          where: { id: resolvedLesseeId },
          select: { name: true },
        })
      : null;
    const contractNumber = await nextLeaseContractNumber({
      leaseType: quotation.leaseType,
      lesseeName: lessee?.name ?? null,
      date: start,
    });

    const gate = await evaluateLeasingCreditGate({
      lesseeId: resolvedLesseeId,
      proposedExposure: Number(quotation.totalContractValue ?? 0) || totalContractValue,
      currency: quotation.currency,
    });
    const blocked = creditGateResponse(gate);
    if (blocked) return blocked;

    const runtimeApproval = await requireLeasingRuntimeApproval(req, ctx, {
      serviceTypeKey: 'LEASING_CONTRACT_ACTIVATION',
      entityType: 'QUOTATION',
      entityId: quotation.id,
      actionKey: 'contract_activation',
      referenceNumber: quotation.quotationNumber ?? quotation.id,
      amount: Number(quotation.totalContractValue ?? 0) || totalContractValue,
      currency: quotation.currency ?? 'AED',
      summary: `Activate contract from quotation ${quotation.quotationNumber ?? quotation.id}`,
      payload: {
        before: { quotationStatus: quotation.status, quotationId: quotation.id },
        after: {
          agreementType: agreementType ?? 'INDIVIDUAL',
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          totalContractValue,
          lesseeId: resolvedLesseeId,
        },
      },
      quotationId: quotation.id,
    });
    if (!runtimeApproval.ok) return runtimeApproval.response;

    // Create the contract
    const contract = await prisma.leaseContract2.create({
      data: {
        contractNumber,
        agreementType: agreementType ?? 'INDIVIDUAL',
        status: 'ACTIVE',
        lesseeId: resolvedLesseeId,
        quotationId: quotation.id,
        openingBranchId: openingBranchId ?? null,
        closingBranchId: closingBranchId ?? null,
        startDate: start,
        endDate: end,
        monthlyRate,
        totalContractValue,
        securityDeposit: Number(quotation.securityDeposit ?? 0),
        currency: quotation.currency ?? 'AED',
        leaseType: quotation.leaseType,
        insuranceIncluded: quotation.insuranceIncluded ?? false,
        maintenanceIncluded: quotation.maintenanceIncluded ?? false,
        driverIncluded: quotation.driverIncluded ?? false,
      },
    });
    await attachTenantToEntity('lease_contracts_v2', contract.id, ctx.tenantId);

    // Create contract vehicles from quotation vehicles
    for (const qv of quotation.vehicles) {
      if (qv.vehicleId) {
        const fleetVehicle = await loadFleetVehicleForLease(qv.vehicleId, ctx.tenantId);
        const assignmentError = assertFleetVehicleAssignable(fleetVehicle);
        if (assignmentError || !fleetVehicle) {
          return NextResponse.json({ error: assignmentError ?? 'Quotation vehicle is not assignable' }, { status: 409 });
        }
        await prisma.leaseContractVehicle.create({
          data: buildLeaseVehicleDataFromFleet(fleetVehicle, contract.id, Number(qv.monthlyRate ?? monthlyRate)),
        });
        await markFleetVehicleLeaseStatus(qv.vehicleId, statusForLeaseAssignment(contract.status));
        continue;
      }
      await prisma.leaseContractVehicle.create({
        data: {
          contractId: contract.id,
          vehicleId: qv.vehicleId ?? null,
          vehicleType: qv.vehicleType,
          make: qv.make ?? '',
          model: qv.model ?? '',
          year: qv.year ?? new Date().getFullYear(),
          monthlyRate: Number(qv.monthlyRate ?? monthlyRate),
          status: 'ACTIVE',
        },
      });
    }

    // Generate payment schedule
    const payments = [];
    for (let i = 0; i < durationMonths; i++) {
      const dueDate = new Date(start);
      dueDate.setMonth(dueDate.getMonth() + i);
      const vatAmount = monthlyRate * 0.05;
      payments.push({
        contractId: contract.id,
        dueDate,
        amount: monthlyRate,
        vatAmount,
        totalAmount: monthlyRate + vatAmount,
        status: 'PENDING',
        periodMonth: dueDate.getMonth() + 1,
        periodYear: dueDate.getFullYear(),
        currency: quotation.currency ?? 'AED',
      });
    }
    await prisma.leasePayment2.createMany({ data: payments });

    // Update quotation status
    await prisma.leaseQuotation.update({
      where: { id },
      data: { status: 'DELIVERED', updatedAt: new Date() },
    });

    await recordOperationalChange({
      req,
      ctx,
      entityType: 'LeaseContract',
      entityId: contract.id,
      action: 'CREATE',
      after: contract,
      summary: `Converted quotation ${quotation.quotationNumber ?? quotation.id} into contract ${contract.contractNumber ?? contract.id}`,
      sourceEntityType: 'LeaseQuotation',
      sourceEntityId: quotation.id,
      relatedEntityType: 'LeaseQuotation',
      relatedEntityId: quotation.id,
      riskSeverity: 'medium',
    });
    await markLeasingRuntimeActionExecuted(runtimeApproval.actionId);

    return NextResponse.json({ contract, paymentsCreated: payments.length });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
