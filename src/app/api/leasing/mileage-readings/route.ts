export const dynamic = 'force-dynamic';

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
 *
 * Multi-tenant: every operation is scoped by x-tenant-id from the
 * middleware. Layer 2.5 fix that closes TENANT-001 for the mileage
 * surface. tenantId propagates through the readings, overages, and
 * auto-generated invoice so they all stay inside the tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { lockSerialSeries } from '@/lib/leasing/serial-lock';

const DEFAULT_OVERAGE_RATE_AED_PER_KM = 0.50;

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const { searchParams } = new URL(req.url);
        const contractId = searchParams.get('contractId');
        const readings = await tx.leaseMileageReading.findMany({
          where: { tenantId, ...(contractId ? { contractId } : {}) },
          include: { contract: { select: { contractNumber: true, mileageCap: true } } },
          orderBy: { readingDate: 'desc' },
        });
        return NextResponse.json(readings);
      } catch (e) {
        captureException(e, { context: 'leasing.mileage-readings.GET' });
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);

    // Cross-tenant guard: the contract the reading is being posted
    // against must belong to this tenant. Otherwise we'd create a
    // reading that points at a contract owned by another tenant.
    const contract = await prisma.leaseContract2.findFirst({
      where: { id: body.contractId, tenantId },
    });
    if (!contract) {
      return NextResponse.json({ error: 'Contract not found in this tenant' }, { status: 404 });
    }

    const reading = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseMileageReading.create({
      data: { ...body, tenantId },
    }),
    );

    // Only RETURN and MONTHLY readings trigger overage calculation.
    if (!['RETURN', 'MONTHLY'].includes(body.readingType)) {
      return NextResponse.json(reading, { status: 201 });
    }

    if (!contract.mileageCap) {
      return NextResponse.json(reading, { status: 201 });
    }

    // Find the delivery reading to compute usage since contract start.
    const delivery = await prisma.leaseMileageReading.findFirst({
      where: { tenantId, contractId: body.contractId, readingType: 'DELIVERY' },
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
    //
    // This used to be a bare `prisma.$transaction(...)` instead of
    // `withTenantRls`, which never sets the `app.tenant_id` GUC that every
    // tenant-scoped table's RLS policy (USING/WITH CHECK) checks. With
    // FORCE ROW LEVEL SECURITY on lease_mileage_overages/lease_invoices/
    // lease_invoice_lines, an unset app.tenant_id makes current_setting(...)
    // return NULL, which satisfies neither USING nor WITH CHECK for a
    // non-null tenant_id row — so every insert in this block would be
    // rejected by Postgres. withTenantRls sets that GUC before handing back
    // the same tx-shaped client, so the rest of the block is unchanged.
    const result = await withTenantRls(prisma, tenantId, async (tx) => {
      // G13: lock before count() so two concurrent overage invoices for the
      // same tenant can't compute the same INV-<n> (shared 'invoice' series
      // with the other three invoice-number generators).
      await lockSerialSeries(tx, tenantId, 'invoice');
      const overage = await tx.leaseMileageOverage.create({
        data: {
          tenantId,
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

      // Auto-invoice the overage — scoped to this tenant.
      const count = await tx.leaseInvoice.count({ where: { tenantId } });
      const invoiceNo = `INV-${String(count + 1).padStart(6, '0')}`;
      const subTotal = overageAmount;
      const vatPct = 5;
      const vatAmount = subTotal * (vatPct / 100);
      const totalAmount = subTotal + vatAmount;
      const issueDate = new Date();
      const dueDate = new Date(issueDate.getTime() + 30 * 86400000); // 30-day terms

      const invoice = await tx.leaseInvoice.create({
        data: {
          tenantId,
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
                tenantId,
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

      return { overage: linkedOverage, invoice, totalAmount };
    });

    // Fire-and-forget audit
    void logAudit({
      tenantId,
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
        invoice: { id: result.invoice.id, invoiceNo: result.invoice.invoiceNo, totalAmount: result.totalAmount },
      },
      { status: 201 },
    );
  } catch (e) {
    captureException(e, { context: 'leasing.mileage-readings.POST' });
    console.error('[mileage-readings] error:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
