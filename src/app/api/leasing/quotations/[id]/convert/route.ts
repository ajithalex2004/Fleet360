export const dynamic = 'force-dynamic';

/**
 * POST /api/leasing/quotations/[id]/convert
 *
 * Converts an approved LeaseQuotation into an active LeaseContract2 with a
 * payment schedule and contract vehicles. Tenant scoping: the quotation
 * must belong to the caller's tenant; every newly-created row (contract,
 * contract vehicles, payments) is stamped with the same tenantId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(bodyRaw);
      const { agreementType, openingBranchId, closingBranchId, startDate, lesseeId } = body;

      const quotation = await tx.leaseQuotation.findFirst({
        where: { id: params.id, tenantId, deletedAt: null },
        include: { vehicles: true, lineItems: true },
      });
      if (!quotation) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });

      const ALLOWED_CONVERT_STATUSES = [
        'CUSTOMER_APPROVED',
        'PENDING_CREDIT_APPROVAL',
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

      // Expiry check
      if (quotation.validUntil && new Date(quotation.validUntil) < new Date()) {
        return NextResponse.json({ error: 'Quotation has expired' }, { status: 400 });
      }

      // Customer consistency
      if (lesseeId && quotation.lesseeId && lesseeId !== quotation.lesseeId) {
        return NextResponse.json({ error: 'Specified lessee does not match quotation customer' }, { status: 400 });
      }

      // Duplicate conversion guard
      const existingContract = await tx.leaseContract2.findFirst({
        where: { quotationId: quotation.id, tenantId, deletedAt: null },
        select: { id: true, contractNumber: true },
      });
      if (existingContract) {
        return NextResponse.json(
          { error: `Quotation has already been converted to contract ${existingContract.contractNumber || existingContract.id}` },
          { status: 409 }
        );
      }

      const start = startDate ? new Date(startDate) : new Date();
      const durationMonths = quotation.durationMonths ?? 24;
      const end = new Date(start);
      end.setMonth(end.getMonth() + durationMonths);

      const contractNumber = `CNT-${Date.now().toString().slice(-6)}`;
      const monthlyRate = Number(quotation.totalMonthlyRate ?? 0);
      const totalContractValue = monthlyRate * durationMonths;

      const contract = await tx.leaseContract2.create({
        data: {
          contractNumber,
          agreementType: agreementType ?? 'INDIVIDUAL',
          status: 'DRAFT',
          lesseeId: lesseeId ?? quotation.lesseeId ?? '',
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
          tenantId,
        },
      });

      // Create contract vehicles from quotation vehicles. LeaseContractVehicle
      // has a required tenantId column (Layer 2.5 migration) — this was
      // previously omitted here (a stale comment claimed no such column
      // exists) and would have thrown "Argument tenant is missing" on every
      // conversion. Never caught because quotation creation was itself
      // broken (see the quotations POST route fix) until now, so nothing
      // ever reached a convertible status in production.
      if (quotation.vehicles.length > 0) {
        await tx.leaseContractVehicle.createMany({
          data: quotation.vehicles.map(qv => ({
            contractId: contract.id,
            vehicleId: qv.vehicleId ?? null,
            vehicleType: qv.vehicleType,
            make: qv.make ?? '',
            model: qv.model ?? '',
            year: qv.year ?? new Date().getFullYear(),
            monthlyRate: Number(qv.monthlyRate ?? monthlyRate),
            status: 'ACTIVE',
            tenantId,
          })),
        });
      }

      // Generate payment schedule.
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
          tenantId,
        });
      }
      if (payments.length > 0) {
        await tx.leasePayment2.createMany({ data: payments });
      }

      await tx.leaseQuotation.update({
        where: { id: params.id },
        data: { status: 'DELIVERED', updatedAt: new Date() },
      });

      return NextResponse.json({ contract, paymentsCreated: payments.length }, { status: 201 });
    } catch (e: any) {
      console.error('POST /api/leasing/quotations/[id]/convert error:', e?.message);
      return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: e?.status || 500 });
    }
  });
}
