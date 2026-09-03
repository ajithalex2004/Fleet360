/**
 * Shared "accept a renewal -> produce the follow-on contract" logic (G7).
 *
 * Extracted so both the staff-facing PATCH /api/leasing/renewals/[id]
 * route and the lessee-facing POST /api/leasing-portal/renewals/[id]/sign
 * route go through one implementation rather than two copies that could
 * drift.
 */

import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export interface AcceptRenewalResult {
  renewal: Awaited<ReturnType<typeof prisma.leaseRenewal.update>>;
  contract: Awaited<ReturnType<typeof prisma.leaseContract2.create>> | null;
  paymentsCreated: number;
  alreadyLinked: boolean;
}

/**
 * Marks a renewal ACCEPTED and, if it doesn't already have a
 * newContractId, creates the follow-on contract: same lessee/vehicles,
 * new term/rate from the renewal's proposed values, plus a payment
 * schedule. The original contract is marked EXTENDED. Idempotent — a
 * renewal that already has newContractId just gets its extra fields
 * (e.g. customerResponseAt) updated, no second contract.
 */
export async function acceptRenewal(args: {
  tenantId: string;
  renewalId: string;
  extraFields?: Record<string, unknown>;
}): Promise<AcceptRenewalResult | null> {
  const { tenantId, renewalId } = args;
  const extraFields = args.extraFields ?? {};

  const existing = await prisma.leaseRenewal.findFirst({
    where: { id: renewalId, tenantId },
  });
  if (!existing) return null;

  const baseData = {
    ...extraFields,
    status: 'ACCEPTED',
    customerResponseAt: existing.customerResponseAt ?? new Date(),
    updatedAt: new Date(),
  };

  if (existing.newContractId) {
    const renewal = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseRenewal.update({ where: { id: renewalId }, data: baseData }),
    );
    return { renewal, contract: null, paymentsCreated: 0, alreadyLinked: true };
  }

  const originalContractRow = await prisma.leaseContract2.findFirst({
    where: { id: existing.originalContractId, tenantId },
    include: { vehicles: true },
  });
  if (!originalContractRow) return null;

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

    await tx.leaseContract2.update({
      where: { id: originalContractRow.id },
      data: { status: 'EXTENDED' },
    });

    const renewal = await tx.leaseRenewal.update({
      where: { id: renewalId },
      data: { ...baseData, newContractId: newContract.id },
    });

    return { renewal, contract: newContract, paymentsCreated: payments.length };
  });

  return { ...result, alreadyLinked: false };
}
