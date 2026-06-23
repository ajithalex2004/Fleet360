import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createAdminApprovalRequest } from '@/lib/admin-approvals';
import { buildLesseeDisplayName } from '@/lib/leasing-lessee-display';
import { nextLeaseContractNumber } from '@/lib/leasing-numbering';
import {
  assertFleetVehicleAssignable,
  assertOpeningBranchMatch,
  buildLeaseVehicleDataFromFleet,
  fleetVehicleDisplay,
  loadFleetVehicleForLease,
  mapLeaseVehicleForClient,
  markFleetVehicleLeaseStatus,
  statusForLeaseAssignment,
} from '@/lib/leasing-vehicle-lifecycle';
import {
  attachTenantToEntity,
  ensureOperationalTenantColumn,
  recordOperationalChange,
  requireOperationalContext,
  tenantScopedIds,
} from '@/lib/cross-module-governance';

type LeaseContractVehicleView = {
  id: string;
  vehicleId?: string | null;
  vehicleType?: string | null;
  type?: string | null;
  make?: string | null;
  model?: string | null;
  licensePlate?: string | null;
  plateNumber?: string | null;
  driverName?: string | null;
  driver?: string | null;
  monthlyRate?: number | string | null;
  status?: string | null;
};

type LeaseContractListItem = {
  id: string;
  contractNumber?: string | null;
  agreementType?: string | null;
  lesseeId?: string | null;
  leaseType?: string | null;
  vehicleCount?: number | null;
  durationMonths?: number | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  monthlyRate?: number | string | null;
  totalContractValue?: number | string | null;
  insuranceIncluded?: boolean | null;
  maintenanceIncluded?: boolean | null;
  driverIncluded?: boolean | null;
  status?: string | null;
  openingBranchId?: string | null;
  vehicles?: LeaseContractVehicleView[];
  quotation?: {
    lesseeId?: string | null;
    lesseeName?: string | null;
    lessee?: { name?: string | null } | null;
    inquiry?: { customerName?: string | null; companyName?: string | null } | null;
  } | null;
};

type LeaseContractMutationResult = LeaseContractListItem & {
  id: string;
};

const leaseContractRepo = (prisma as unknown as {
  leaseContract2: {
    findMany(args: unknown): Promise<LeaseContractListItem[]>;
    create(args: unknown): Promise<LeaseContractMutationResult>;
  };
}).leaseContract2;

function presentContractStatus(status?: string | null) {
  switch ((status ?? '').toUpperCase()) {
    case 'ACTIVE':
      return 'Active';
    case 'DRAFT':
      return 'Draft';
    case 'PENDING_APPROVAL':
    case 'PENDING':
      return 'Pending Approval';
    case 'EXPIRED':
      return 'Expired';
    case 'TERMINATED':
    case 'CANCELLED':
      return 'Terminated';
    case 'CLOSED':
      return 'Closed';
    default:
      return status || 'Draft';
  }
}

async function resolveOrCreateLesseeId(rawLesseeId: unknown, rawLessee: unknown) {
  const explicitId = String(rawLesseeId ?? '').trim();
  const typedLessee = String(rawLessee ?? '').trim();
  const lookup = explicitId || typedLessee;
  if (!lookup) return '';

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text AS id
       FROM lessees
      WHERE deleted_at IS NULL
        AND (id::text = $1 OR LOWER(name) = LOWER($1))
      ORDER BY created_at DESC NULLS LAST
      LIMIT 1`,
    lookup,
  );
  if (rows[0]?.id) return rows[0].id;
  if (explicitId && !typedLessee) return explicitId;

  const lessee = await prisma.lessee.create({
    data: {
      name: typedLessee,
      type: 'corporate',
    },
    select: { id: true },
  });
  return lessee.id;
}

export async function GET(request: NextRequest) {
  try {
    const ctx = requireOperationalContext(request, 'leasing', { requestedTenantId: request.nextUrl.searchParams.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;
    await ensureOperationalTenantColumn('lease_contracts_v2');
    const ids = await tenantScopedIds('lease_contracts_v2', ctx.tenantId, { activeOnly: true });
    if (ids.length === 0) return NextResponse.json([]);

    const contracts = await leaseContractRepo.findMany({
      where: { id: { in: ids }, deletedAt: null },
      include: { vehicles: true, quotation: { include: { lessee: true, inquiry: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const lesseeIds = [...new Set(contracts.map((c) => c.lesseeId).filter(Boolean) as string[])];
    const lessees = lesseeIds.length
      ? await prisma.lessee.findMany({ where: { id: { in: lesseeIds } }, select: { id: true, name: true } })
      : [];
    const lesseeNames = new Map(lessees.map((lessee) => [lessee.id, lessee.name]));

    return NextResponse.json(
      contracts.map((c) => ({
        id: c.id,
        contractNumber: c.contractNumber,
        agreementType: c.agreementType ?? 'INDIVIDUAL',
        lesseeId: c.lesseeId ?? null,
        lessee: lesseeNames.get(c.lesseeId ?? '') ?? buildLesseeDisplayName(c.quotation ?? { lesseeId: c.lesseeId }) ?? c.lesseeId ?? 'Unknown',
        leaseType: c.leaseType ?? 'LONG_TERM',
        vehicleCount: Array.isArray(c.vehicles) ? c.vehicles.length : (c.vehicleCount ?? 0),
        durationMonths: c.durationMonths ?? null,
        startDate: c.startDate ? new Date(c.startDate).toISOString().split('T')[0] : '',
        endDate: c.endDate ? new Date(c.endDate).toISOString().split('T')[0] : '',
        monthlyRate: c.monthlyRate ?? 0,
        totalValue: c.totalContractValue ?? 0,
        insurance: c.insuranceIncluded ?? false,
        maintenance: c.maintenanceIncluded ?? false,
        driver: c.driverIncluded ?? false,
        status: presentContractStatus(c.status),
        branch: c.openingBranchId ?? '',
        vehicles: (c.vehicles ?? []).map((v) => ({
          id: v.id,
          vehicleId: v.vehicleId ?? null,
          type: v.vehicleType ?? v.type ?? '',
          make: v.make ?? '',
          model: v.model ?? '',
          licensePlate: v.licensePlate ?? v.plateNumber ?? '',
          driver: v.driverName ?? v.driver ?? '',
          monthlyRate: v.monthlyRate ?? 0,
          status: v.status ?? 'Active',
        })),
      }))
    );
  } catch (e: unknown) {
    console.error('GET /api/leasing/contracts-v2 error:', e instanceof Error ? e.message : e);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(request: NextRequest) {
    try {
      const ctx = requireOperationalContext(request, 'leasing', { write: true });
      if (ctx instanceof NextResponse) return ctx;
      await ensureOperationalTenantColumn('lease_contracts_v2');
      const body = await request.json();
      const {
        agreementType, leaseType, durationMonths, startDate, endDate,
        monthlyRate, currency, securityDeposit, mileageCap,
        insuranceIncluded, maintenanceIncluded, driverIncluded, notes, quotationId,
      } = body;
      const lesseeId = await resolveOrCreateLesseeId(body.lesseeId, body.lessee);
      if (!lesseeId || !startDate || !endDate || monthlyRate === undefined) {
        return NextResponse.json({ error: 'lesseeId, startDate, endDate, and monthlyRate are required' }, { status: 400 });
      }

      const parsedMonthlyRate = parseFloat(monthlyRate);
      const parsedDuration = durationMonths ? parseInt(durationMonths) : null;
      const selectedVehicles = Array.isArray(body.vehicles) ? body.vehicles : [];
      const openingBranchId = body.openingBranchId ?? body.branch ?? selectedVehicles[0]?.branchId ?? null;
      const closingBranchId = body.closingBranchId ?? null;
      const lessee = await prisma.lessee.findUnique({
        where: { id: lesseeId },
        select: { name: true },
      });
      const contractNumber = await nextLeaseContractNumber({
        leaseType,
        lesseeName: lessee?.name ?? null,
      });

      const contract = await leaseContractRepo.create({
        data: {
          contractNumber,
          agreementType: agreementType ?? 'INDIVIDUAL',
          leaseType: leaseType ?? 'LONG_TERM',
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          monthlyRate: parsedMonthlyRate,
          totalContractValue: parsedDuration ? parsedMonthlyRate * parsedDuration : null,
          currency: currency ?? 'AED',
          securityDeposit: securityDeposit ? parseFloat(securityDeposit) : null,
          mileageCap: mileageCap ? parseInt(mileageCap) : null,
          openingBranchId,
          closingBranchId,
          insuranceIncluded: insuranceIncluded ?? false,
          maintenanceIncluded: maintenanceIncluded ?? false,
          driverIncluded: driverIncluded ?? false,
          notes: notes ?? null,
          status: 'DRAFT',
          lesseeId,
          ...(quotationId ? { quotationId } : {}),
        },
      });
      await attachTenantToEntity('lease_contracts_v2', contract.id, ctx.tenantId);
      const createdVehicles = [];
      const queuedApprovals = [];
      for (const selected of selectedVehicles) {
        const vehicleId = String(selected?.vehicleId ?? selected?.id ?? '').trim();
        if (!vehicleId || vehicleId.startsWith('new-')) continue;
        const fleetVehicle = await loadFleetVehicleForLease(vehicleId, ctx.tenantId);
        const assignmentError = assertFleetVehicleAssignable(fleetVehicle);
        if (assignmentError || !fleetVehicle) {
          throw new Error(assignmentError ?? 'Selected vehicle is not assignable');
        }
        const branchMismatch = assertOpeningBranchMatch(fleetVehicle, openingBranchId);
        if (branchMismatch) {
          if (!body.allowCrossBranchOverride) {
            throw new Error(`${branchMismatch} Enable other-branch override to queue approval for this assignment.`);
          }
          const approvalId = await createAdminApprovalRequest({
            req: request,
            ctx: {
              userId: ctx.userId,
              tenantId: ctx.tenantId,
              role: ctx.role,
              isSuperAdmin: ctx.isSuperAdmin,
              isTenantAdmin: ctx.role === 'TENANT_ADMIN',
            },
            action: 'leasing.vehicle_assignment.cross_branch',
            tenantId: ctx.tenantId,
            targetType: 'LeaseContract',
            targetId: contract.id,
            summary: `Assign ${fleetVehicleDisplay(fleetVehicle)} from another branch to ${contract.contractNumber ?? contract.id}`,
            payload: {
              before: { contract, vehicle: fleetVehicle },
              after: { contractId: contract.id, vehicleId, monthlyRate: selected.monthlyRate ?? parsedMonthlyRate },
              branchMismatch,
            },
            requiredApprovals: 1,
          });
          queuedApprovals.push({ id: approvalId, vehicleId, action: 'leasing.vehicle_assignment.cross_branch' });
          continue;
        }
        const duplicate = await prisma.leaseContractVehicle.findFirst({
          where: {
            vehicleId,
            status: 'ACTIVE',
            contract: {
              deletedAt: null,
              status: { notIn: ['CLOSED', 'TERMINATED', 'CANCELLED', 'EXPIRED'] },
            },
          },
          select: { id: true },
        });
        if (duplicate) throw new Error(`${fleetVehicleDisplay(fleetVehicle)} is already linked to another live lease agreement.`);
        const contractVehicle = await prisma.leaseContractVehicle.create({
          data: buildLeaseVehicleDataFromFleet(fleetVehicle, contract.id, selected.monthlyRate ?? parsedMonthlyRate),
        });
        await markFleetVehicleLeaseStatus(vehicleId, statusForLeaseAssignment(contract.status));
        createdVehicles.push(mapLeaseVehicleForClient(contractVehicle, fleetVehicle));
      }
      await recordOperationalChange({
        req: request,
        ctx,
        entityType: 'LeaseContract',
        entityId: contract.id,
        action: 'CREATE',
        after: { ...contract, vehicles: createdVehicles, queuedApprovals },
        summary: `Created lease contract ${contract.contractNumber ?? contract.id}`,
      });

      return NextResponse.json({ ...contract, vehicles: createdVehicles, approvalRequests: queuedApprovals }, { status: 201 });
    } catch (e: unknown) {
      console.error('POST /api/leasing/contracts-v2 error:', e instanceof Error ? e.message : e);
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to create contract' }, { status: 500 });
    }
}
