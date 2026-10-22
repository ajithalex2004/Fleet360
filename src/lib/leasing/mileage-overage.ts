import type { TxClient } from '@/lib/rls';
import { lockSerialSeries } from '@/lib/leasing/serial-lock';

const DEFAULT_OVERAGE_RATE_AED_PER_KM = 0.5;
const MONTH_MS = 30.44 * 86400000;

export type MileageOverageContract = {
  id: string;
  contractNumber: string | null;
  lesseeId: string;
  startDate: Date;
  endDate: Date;
  mileageCap: number | null;
  mileageOverageRate: unknown; // Prisma Decimal | null
  currency: string | null;
};

/**
 * Extracted from the original inline block in
 * src/app/api/leasing/mileage-readings/route.ts (behavior-preserving —
 * both that route and the return workflow's Phase 2 call this, so the
 * RETURN-triggered overage path isn't duplicated).
 *
 * Caller supplies `tx` from its own withTenantRls block — this function
 * does not open its own transaction. Only RETURN and MONTHLY reading types
 * trigger a calculation; missing mileageCap or a missing DELIVERY reading
 * on file both result in a no-op { overage: null, invoice: null } rather
 * than an error, so the caller decides what "not yet evaluable" means for
 * its own workflow (the return workflow surfaces this as
 * mileageAssessment: 'REVIEW_REQUIRED', this function itself stays silent
 * about that distinction).
 */
export async function computeAndInvoiceMileageOverage(
  tx: TxClient,
  args: {
    tenantId: string;
    contract: MileageOverageContract;
    readingType: 'RETURN' | 'MONTHLY';
    mileage: number;
    readingDate: Date;
    vehicleId?: string | null;
  },
): Promise<{
  overage: Record<string, unknown> | null;
  invoice: Record<string, unknown> | null;
  totalAmount?: number;
  deliveryMileage: number | null;
  reason: 'NO_MILEAGE_CAP' | 'NO_DELIVERY_READING' | 'WITHIN_CAP' | 'INVOICED';
}> {
  const { tenantId, contract, readingType, mileage, readingDate, vehicleId } = args;

  if (!contract.mileageCap) {
    return { overage: null, invoice: null, deliveryMileage: null, reason: 'NO_MILEAGE_CAP' };
  }

  const delivery = await tx.leaseMileageReading.findFirst({
    where: { tenantId, contractId: contract.id, readingType: 'DELIVERY' },
    orderBy: { readingDate: 'asc' },
  });
  if (!delivery) {
    return { overage: null, invoice: null, deliveryMileage: null, reason: 'NO_DELIVERY_READING' };
  }

  // Cumulative distance against the cumulative allowance to date, less the
  // overage already assessed. A MONTHLY check used to compare the distance
  // since delivery with ONE month's cap, so a lessee within the cap every
  // month was billed (months - 1) x cap of "overage" in month N, and again
  // the month after; the RETURN check then billed the whole term on top.
  // Every earlier overage record counts as assessed, WAIVED included: a
  // waiver is a decision, not a debt to re-raise.
  const monthsCovered = readingType === 'RETURN'
    ? Math.ceil((contract.endDate.getTime() - contract.startDate.getTime()) / MONTH_MS)
    : Math.max(1, Math.round((readingDate.getTime() - contract.startDate.getTime()) / MONTH_MS));

  const allowedKm = contract.mileageCap * monthsCovered;
  const actualKm = mileage - delivery.mileage;

  // Serialise assessments of this contract (the key the other contract
  // operations use; a caller already holding it in this transaction gets it
  // again at once). Two concurrent readings both read the same prior
  // assessments and both billed the same kilometres.
  await tx.$executeRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    `lease-contract:${tenantId}:${contract.id}`,
  );
  const prior = await tx.leaseMileageOverage.findMany({
    where: { tenantId, contractId: contract.id },
    select: { overageKm: true, periodTo: true },
    orderBy: { periodTo: 'desc' },
  });
  const assessedKm = prior.reduce((sum, o) => sum + Number(o.overageKm ?? 0), 0);

  if (actualKm - allowedKm <= assessedKm) {
    return { overage: null, invoice: null, deliveryMileage: delivery.mileage, reason: 'WITHIN_CAP' };
  }

  const overageKm = actualKm - allowedKm - assessedKm;
  const ratePerKm = contract.mileageOverageRate ? Number(contract.mileageOverageRate) : DEFAULT_OVERAGE_RATE_AED_PER_KM;
  const overageAmount = overageKm * ratePerKm;
  const currency = contract.currency ?? 'AED';

  // G13: lock before count() so two concurrent overage invoices for the
  // same tenant can't compute the same INV-<n> (shared 'invoice' series
  // with the other invoice-number generators).
  await lockSerialSeries(tx, tenantId, 'invoice');

  const overage = await tx.leaseMileageOverage.create({
    data: {
      tenantId,
      contractId: contract.id,
      vehicleId: vehicleId ?? null,
      // From the end of the last assessed period: this record is the increment.
      periodFrom: prior[0]?.periodTo ?? contract.startDate,
      periodTo: new Date(readingDate),
      allowedKm,
      actualKm,
      overageKm,
      ratePerKm,
      overageAmount,
      currency,
      status: 'PENDING',
    },
  });

  const count = await tx.leaseInvoice.count({ where: { tenantId } });
  const invoiceNo = `INV-${String(count + 1).padStart(6, '0')}`;
  const subTotal = overageAmount;
  const vatPct = 5;
  const vatAmount = subTotal * (vatPct / 100);
  const totalAmount = subTotal + vatAmount;
  const issueDate = new Date();
  const dueDate = new Date(issueDate.getTime() + 30 * 86400000);

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
            vehicleRef: vehicleId ?? null,
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

  const linkedOverage = await tx.leaseMileageOverage.update({
    where: { id: overage.id },
    data: { invoiced: true, invoiceRef: invoice.invoiceNo, status: 'INVOICED' },
  });

  return { overage: linkedOverage, invoice, totalAmount, deliveryMileage: delivery.mileage, reason: 'INVOICED' };
}
