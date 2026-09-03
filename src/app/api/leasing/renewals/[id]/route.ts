export const dynamic = 'force-dynamic';

/**
 * PATCH /api/leasing/renewals/[id]
 *
 * Tenant scoping: requires x-tenant-id. Refuses to touch renewals from
 * another tenant.
 *
 * Accepting a renewal (status -> ACCEPTED) used to only update the
 * renewal's own status/customerResponseAt — LeaseRenewal.newContractId
 * existed in the schema specifically to link a renewal to the contract it
 * produces, but nothing ever wrote to it. This now creates that contract:
 * same lessee, same vehicles, new term/rate from the renewal's proposed
 * values, plus a payment schedule — mirroring what
 * quotations/[id]/convert/route.ts does for the sales-funnel path. The
 * original contract is marked EXTENDED so it doesn't sit ACTIVE alongside
 * its replacement. Idempotent: if the renewal already has a newContractId
 * (e.g. a re-PATCH), this just updates the renewal fields without creating
 * a second contract.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const existing = await prisma.leaseRenewal.findFirst({
      where: { id: params.id, tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(bodyRaw);
    const { originalContract, ...data } = body;
    if (data.status === 'ACCEPTED' && !data.customerResponseAt) data.customerResponseAt = new Date();

    const shouldCreateContract = data.status === 'ACCEPTED' && !existing.newContractId;

    if (!shouldCreateContract) {
      const renewal = await withTenantRls(prisma, tenantId, async (tx) =>
        tx.leaseRenewal.update({
          where: { id: params.id },
          data: { ...data, updatedAt: new Date() },
        }),
      );
      return NextResponse.json(renewal);
    }

    const originalContractRow = await prisma.leaseContract2.findFirst({
      where: { id: existing.originalContractId, tenantId },
      include: { vehicles: true },
    });
    if (!originalContractRow) {
      return NextResponse.json({ error: 'Original contract not found' }, { status: 404 });
    }

    const start = existing.proposedStartDate;
    const end = existing.proposedEndDate;
    const durationMonths = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30)),
    );
    const monthlyRate = Number(existing.proposedMonthlyRate ?? originalContractRow.monthlyRate);
    const contractNumber = `CNT-${Date.now().toString().slice(-6)}`;

    const result = await withTenantRls(prisma, tenantId, async (tx) => {
      const newContract = await tx.leaseContract2.create({
        data: {
          contractNumber,
          agreementType:       originalContractRow.agreementType,
          lesseeId:            originalContractRow.lesseeId,
          leaseType:           originalContractRow.leaseType,
          startDate:           start,
          endDate:             end,
          monthlyRate,
          totalContractValue:  monthlyRate * durationMonths,
          mileageCap:          originalContractRow.mileageCap,
          mileageOverageRate:  originalContractRow.mileageOverageRate,
          securityDeposit:     originalContractRow.securityDeposit,
          currency:            originalContractRow.currency,
          insuranceIncluded:   originalContractRow.insuranceIncluded,
          maintenanceIncluded: originalContractRow.maintenanceIncluded,
          driverIncluded:      originalContractRow.driverIncluded,
          openingBranchId:     originalContractRow.openingBranchId,
          closingBranchId:     originalContractRow.closingBranchId,
          status:              'ACTIVE',
          tenantId,
        },
      });

      if (originalContractRow.vehicles.length > 0) {
        await tx.leaseContractVehicle.createMany({
          data: originalContractRow.vehicles.map(v => ({
            contractId:   newContract.id,
            vehicleId:    v.vehicleId,
            vehicleType:  v.vehicleType,
            make:         v.make,
            model:        v.model,
            year:         v.year,
            licensePlate: v.licensePlate,
            vin:          v.vin,
            driverId:     v.driverId,
            quantity:     v.quantity,
            monthlyRate:  v.monthlyRate,
            status:       'ACTIVE',
            tenantId,
          })),
        });
      }

      const payments = [];
      for (let i = 0; i < durationMonths; i++) {
        const dueDate = new Date(start);
        dueDate.setMonth(dueDate.getMonth() + i);
        const vatAmount = monthlyRate * 0.05;
        payments.push({
          contractId:  newContract.id,
          dueDate,
          amount:      monthlyRate,
          vatAmount,
          totalAmount: monthlyRate + vatAmount,
          status:      'PENDING',
          periodMonth: dueDate.getMonth() + 1,
          periodYear:  dueDate.getFullYear(),
          currency:    originalContractRow.currency ?? 'AED',
          tenantId,
        });
      }
      if (payments.length > 0) {
        await tx.leasePayment2.createMany({ data: payments });
      }

      // The lease continues under the new contract — mark the old one
      // superseded rather than leaving two ACTIVE contracts for the same
      // vehicles/lessee.
      await tx.leaseContract2.update({
        where: { id: originalContractRow.id },
        data: { status: 'EXTENDED' },
      });

      const renewal = await tx.leaseRenewal.update({
        where: { id: params.id },
        data: { ...data, newContractId: newContract.id, updatedAt: new Date() },
      });

      return { renewal, contract: newContract, paymentsCreated: payments.length };
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error('PATCH /api/leasing/renewals/[id] error:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
