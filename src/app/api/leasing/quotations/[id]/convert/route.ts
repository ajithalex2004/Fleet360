import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { agreementType, openingBranchId, closingBranchId, startDate, lesseeId } = body;

    const quotation = await prisma.leaseQuotation.findFirst({
      where: { id: params.id, deletedAt: null },
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

    const start = startDate ? new Date(startDate) : new Date();
    const durationMonths = quotation.durationMonths ?? 24;
    const end = new Date(start);
    end.setMonth(end.getMonth() + durationMonths);

    const contractNumber = `CNT-${Date.now().toString().slice(-6)}`;
    const monthlyRate = Number(quotation.totalMonthlyRate ?? 0);
    const totalContractValue = monthlyRate * durationMonths;

    // Create the contract
    const contract = await prisma.leaseContract2.create({
      data: {
        contractNumber,
        agreementType: agreementType ?? 'INDIVIDUAL',
        status: 'ACTIVE',
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
      },
    });

    // Create contract vehicles from quotation vehicles
    for (const qv of quotation.vehicles) {
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
      where: { id: params.id },
      data: { status: 'DELIVERED', updatedAt: new Date() },
    });

    return NextResponse.json({ contract, paymentsCreated: payments.length });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
