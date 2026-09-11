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
import { computeAndInvoiceMileageOverage } from '@/lib/leasing/mileage-overage';

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

    // <input type="date"> sends a bare "YYYY-MM-DD" string, which Prisma's
    // strict DateTime parser rejects ("premature end of input") — same bug
    // class as the invoices/renewals routes.
    const readingDate = body.readingDate ? new Date(body.readingDate) : new Date();
    const reading = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseMileageReading.create({
      data: { ...body, readingDate, tenantId },
    }),
    );

    // Only RETURN and MONTHLY readings trigger overage calculation.
    if (!['RETURN', 'MONTHLY'].includes(body.readingType)) {
      return NextResponse.json(reading, { status: 201 });
    }

    // Atomic: create overage + invoice + invoice line in one transaction.
    //
    // withTenantRls (not a bare `prisma.$transaction`) sets the
    // `app.tenant_id` GUC every tenant-scoped table's RLS policy checks —
    // with FORCE ROW LEVEL SECURITY on lease_mileage_overages/
    // lease_invoices/lease_invoice_lines, an unset app.tenant_id would
    // reject every insert in this block.
    const result = await withTenantRls(prisma, tenantId, (tx) =>
      computeAndInvoiceMileageOverage(tx, {
        tenantId,
        contract,
        readingType: body.readingType as 'RETURN' | 'MONTHLY',
        mileage: body.mileage,
        readingDate: body.readingDate,
        vehicleId: body.vehicleId,
      }),
    );

    if (!result.overage || !result.invoice) {
      // No mileageCap, no DELIVERY reading on file, or within cap — nothing to bill.
      return NextResponse.json(reading, { status: 201 });
    }

    // Fire-and-forget audit
    void logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'LeaseMileageOverage',
      entityId: result.overage.id as string,
      action: 'CREATE',
      details: `Mileage overage on contract ${contract.contractNumber ?? contract.id}: ${result.overage.overageKm} km × ${result.overage.ratePerKm} ${result.overage.currency}/km = ${Number(result.overage.overageAmount).toFixed(2)} ${result.overage.currency}. Invoice ${result.invoice.invoiceNo} issued.`,
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
