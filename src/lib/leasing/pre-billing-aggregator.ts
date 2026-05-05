/**
 * Pre-billing aggregator — pulls real charges from the leasing data model
 * and rolls them up into the shape that LeasePreBillingStatement expects.
 *
 * Sources:
 *   - Base rent       — from LeaseContract2.monthlyRate
 *   - Fuel charges    — sum of LeaseFuelLog.totalCost (billedToLessee=true,
 *                       fuelDate in [periodFrom, periodTo])
 *   - Fine charges    — sum of LeaseTrafficFine.finalAmount or .fineAmount
 *                       (billedToLessee=true, violationDate in period,
 *                       billingStatus != INVOICED|PAID)
 *   - Overage charges — sum of LeaseMileageOverage.overageAmount
 *                       (status=PENDING, periodTo within range)
 *   - Other charges   — passed in by caller (manual adjustments)
 *   - Maintenance     — passed in by caller for v1.0 (Maintenance module
 *                       integration deferred to v1.1)
 *
 * VAT 5% applied on the subtotal. Always returns a structured preview
 * including line-item references so the UI / PDF can show the audit trail.
 */

import { prisma } from '@/lib/prisma';

export interface AggregateLineRef {
  source: 'fuel' | 'fine' | 'overage';
  id: string;
  date: string; // ISO
  amount: number;
  description: string;
}

export interface AggregateResult {
  contractId: string;
  contractNumber: string | null;
  lesseeId: string;
  periodFrom: Date;
  periodTo: Date;

  baseRent: number;
  fuelCharges: number;
  fineCharges: number;
  maintenanceCharges: number;
  overageCharges: number;
  otherCharges: number;

  subTotal: number;
  vatPct: number;
  vatAmount: number;
  totalAmount: number;

  currency: string;

  sources: AggregateLineRef[];
}

export interface AggregateInput {
  contractId: string;
  periodFrom: Date;
  periodTo: Date;
  /** Manual maintenance charges (Maintenance module integration is v1.1). */
  maintenanceCharges?: number;
  /** Manual other charges. */
  otherCharges?: number;
  vatPct?: number;
}

export async function aggregatePreBilling(input: AggregateInput): Promise<AggregateResult> {
  const contract = await prisma.leaseContract2.findUnique({
    where: { id: input.contractId },
  });
  if (!contract) throw new Error(`Contract ${input.contractId} not found`);

  const currency = contract.currency ?? 'AED';
  const baseRent = Number(contract.monthlyRate ?? 0);

  // Fuel logs in period, billable to lessee.
  const fuelLogs = await prisma.leaseFuelLog.findMany({
    where: {
      contractId: input.contractId,
      billedToLessee: true,
      fuelDate: { gte: input.periodFrom, lte: input.periodTo },
    },
    orderBy: { fuelDate: 'asc' },
  });

  const fuelSources: AggregateLineRef[] = fuelLogs.map(f => ({
    source: 'fuel' as const,
    id: f.id,
    date: f.fuelDate.toISOString(),
    amount: Number(f.totalCost ?? 0),
    description: `Fuel: ${Number(f.liters ?? 0).toFixed(1)} L${f.station ? ` @ ${f.station}` : ''}`,
  }));
  const fuelCharges = fuelSources.reduce((s, l) => s + l.amount, 0);

  // Traffic fines in period, billable, not yet invoiced or paid.
  const fines = await prisma.leaseTrafficFine.findMany({
    where: {
      contractId: input.contractId,
      billedToLessee: true,
      violationDate: { gte: input.periodFrom, lte: input.periodTo },
      billingStatus: { in: ['PENDING'] },
    },
    orderBy: { violationDate: 'asc' },
  });

  const fineSources: AggregateLineRef[] = fines.map(f => ({
    source: 'fine' as const,
    id: f.id,
    date: f.violationDate.toISOString(),
    amount: Number(f.finalAmount ?? f.fineAmount),
    description: `Fine: ${f.violationType}${f.authority ? ` (${f.authority})` : ''}${f.location ? ` — ${f.location}` : ''}`,
  }));
  const fineCharges = fineSources.reduce((s, l) => s + l.amount, 0);

  // Mileage overages, still pending.
  const overages = await prisma.leaseMileageOverage.findMany({
    where: {
      contractId: input.contractId,
      status: 'PENDING',
      periodTo: { gte: input.periodFrom, lte: input.periodTo },
    },
    orderBy: { periodTo: 'asc' },
  });

  const overageSources: AggregateLineRef[] = overages.map(o => ({
    source: 'overage' as const,
    id: o.id,
    date: o.periodTo.toISOString(),
    amount: Number(o.overageAmount),
    description: `Mileage overage: ${o.overageKm} km × ${Number(o.ratePerKm).toFixed(2)} ${currency}/km`,
  }));
  const overageCharges = overageSources.reduce((s, l) => s + l.amount, 0);

  const maintenanceCharges = input.maintenanceCharges ?? 0;
  const otherCharges = input.otherCharges ?? 0;

  const subTotal =
    baseRent + fuelCharges + fineCharges + maintenanceCharges + overageCharges + otherCharges;
  const vatPct = input.vatPct ?? 5;
  const vatAmount = (subTotal * vatPct) / 100;
  const totalAmount = subTotal + vatAmount;

  return {
    contractId: input.contractId,
    contractNumber: contract.contractNumber,
    lesseeId: contract.lesseeId,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    baseRent,
    fuelCharges,
    fineCharges,
    maintenanceCharges,
    overageCharges,
    otherCharges,
    subTotal,
    vatPct,
    vatAmount,
    totalAmount,
    currency,
    sources: [...fuelSources, ...fineSources, ...overageSources],
  };
}
