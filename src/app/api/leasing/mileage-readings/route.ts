/**
 * Mileage readings — capture readings and auto-generate overage charges + invoices.
 *
 * Phase 1c (mileage overage engine):
 *   When a RETURN or MONTHLY reading is posted, compare actual km against the
 *   contract's allowed km (mileageCap × months). Any excess generates:
 *     1. A LeaseMileageOverage row capturing the calculation
 *     2. A LeaseInvoice (lineType=OVERAGE) so the customer gets billed
 *     3. The overage row is marked invoiced + linked to the invoice
 *
 * Rate sourced from LeaseContract2.mileageOverageRate; falls back to the
 * platform default (0.50 AED/km) if the contract doesn't override.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

const DEFAULT_OVERAGE_RATE_AED_PER_KM = 0.50;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const contractId = searchParams.get('contractId');
    const readings = await prisma.leaseMileageReading.findMany({
      where: contractId ? { contractId } : {},
      include: { contract: { select: { contractNumber: true, mileageCap: true } } },
      orderBy: { readingDate: 'desc' },
    });
    return NextResponse.json(readings);
  } catch (e) {
    captureException(e, { context: 'leasing.mileage-readings.GET' });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const reading = await prisma.leaseMileageReading.create({ data: body });

    // Only RETURN and MONTHLY readings trigger overage calculation.
    if (!['RETURN', 'MONTHLY'].includes(body.readingType)) {
      return NextResponse.json(reading, { status: 201 });
    }

    const contract = await prisma.leaseContract2.findUnique({
      where: { id: body.contractId },
    });
    if (!contract?.mileageCap) {
      return NextResponse.json(reading, { status: 201 });
    }

    // Find the delivery reading to compute usage since contract start.
    const delivery = await prisma.leaseMileageReading.findFirst({
      where: { contractId: body.contractId, readingType: 'DELIVERY' },
      orderBy: { readingDate: 'asc' },
    });
    if (!delivery) {
      return NextResponse.json(reading, { status: 201 });
    }

    // For RETURN: full contract period.
    // For MONTHLY: one month allowance.
    const monthsCovered =
      body.readingType === 'RETURN'
        ? Math.ceil(
            (new Date(contract.endDate).getTime() - new Date(contract.startDate).getTime()) /
              (30.44 * 86400000),
          )
        : 1;

    const allowedKm = contract.mileageCap * monthsCovered;
    const actualKm = body.mileage - delivery.mileage;

    if (actualKm <= allowedKm) {
      // Within cap — nothing to bill.
      return NextResponse.json(reading, { status: 201 });
    }

    const overageKm = actualKm - allowedKm;
    const ratePerKm = contract.mileageOverageRate
      ? Number(contract.mileageOverageRate)
      : DEFAULT_OVERAGE_RATE_AED_PER_KM;
    const overageAmount = overageKm * ratePerKm;
    const currency = contract.currency ?? 'AED';

    // Atomic: create overage + invoice + invoice line in one transaction.
    const result = await prisma.$transaction(async (tx) => {
      const overage = await tx.leaseMileageOverage.create({
        data: {
          contractId: body.contractId,
          vehicleId: body.vehicleId ?? null,
          periodFrom: contract.startDate,
          periodTo: new Date(body.readingDate),
          allowedKm,
          actualKm,
          overageKm,
          ratePerKm,
          overageAmount,
          currency,
          status: 'PENDING',
        },
      });

      // Auto-invoice the overage.
      const count = await tx.leaseInvoice.count();
      const invoiceNo = `INV-${String(count + 1).padStart(6, '0')}`;
      const subTotal = overageAmount;
      const vatPct = 5;
      const vatAmount = subTotal * (vatPct / 100);
      const totalAmount = subTotal + vatAmount;
      const issueDate = new Date();
      const dueDate = new Date(issueDate.getTime() + 30 * 86400000); // 30-day terms

      const invoice = await tx.leaseInvoice.create({
        data: {
          invoiceNo,
          lesseeId: contract.lesseeId,
          billingPeriod: `Mileage overage — ${overage.periodFrom.toISOString().slice(0, 10)} → ${overage.periodTo.toISOString().slice(0, 10)}`,
          issueDate,
          dueDate,
          subTotal,
          vatPct,
          vatAmount,
          totalAmount,
          currency,
          status: 'DRAFT',
          notes: `Auto-generated for mileage overage of ${overageKm} km @ ${ratePerKm} ${currency}/km on contract ${contract.contractNumber ?? contract.id}.`,
          lines: {
            create: [
              {
                contractId: contract.id,
                vehicleRef: body.vehicleId ?? null,
                description: `Mileage overage: ${overageKm} km × ${ratePerKm} ${currency}/km`,
                lineType: 'OVERAGE',
                quantity: overageKm,
                unitAmount: ratePerKm,
                totalAmount: overageAmount,
                currency,
              },
            ],
          },
        },
      });

      // Link the overage to its invoice and mark invoiced.
      const linkedOverage = await tx.leaseMileageOverage.update({
        where: { id: overage.id },
        data: { invoiced: true, invoiceRef: invoice.invoiceNo, status: 'INVOICED' },
      });

      return { overage: linkedOverage, invoice };
    });

    // Fire-and-forget audit
    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'LeaseMileageOverage',
      entityId: result.overage.id,
      action: 'CREATE',
      details: `Mileage overage on contract ${contract.contractNumber ?? contract.id}: ${overageKm} km × ${ratePerKm} ${currency}/km = ${overageAmount.toFixed(2)} ${currency}. Invoice ${result.invoice.invoiceNo} issued.`,
    });

    return NextResponse.json(
      {
        ...reading,
        overage: result.overage,
        invoice: { id: result.invoice.id, invoiceNo: result.invoice.invoiceNo, totalAmount },
      },
      { status: 201 },
    );
  } catch (e) {
    captureException(e, { context: 'leasing.mileage-readings.POST' });
    console.error('[mileage-readings] error:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
