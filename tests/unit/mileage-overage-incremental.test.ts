/**
 * Mileage overage is billed once per kilometre.
 *
 * The MONTHLY check compared the distance since delivery with ONE month's
 * cap: a lessee within the cap every month was billed (months - 1) x cap of
 * "overage" by month N, and again every month after. The RETURN check then
 * billed the whole term again on top of what the monthly checks had billed.
 *
 * Now: cumulative distance against the cumulative allowance to date, less
 * the overage already assessed (WAIVED included).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/leasing/serial-lock', () => ({ lockSerialSeries: async () => {} }));

import { computeAndInvoiceMileageOverage, type MileageOverageContract } from '@/lib/leasing/mileage-overage';

const DAY = 86400000;
const start = new Date('2026-01-01T00:00:00Z');
const contract: MileageOverageContract = {
  id: 'c1', contractNumber: 'LC-1', lesseeId: 'l1',
  startDate: start, endDate: new Date(start.getTime() + 365 * DAY),
  mileageCap: 2000, mileageOverageRate: 0.5, currency: 'AED',
};

function makeTx(prior: Array<{ overageKm: number; periodTo: Date }>) {
  const created: Array<Record<string, unknown>> = [];
  const tx = {
    leaseMileageReading: { findFirst: async () => ({ mileage: 10_000, readingDate: start }) },
    leaseMileageOverage: {
      findMany: async () => [...prior].sort((a, b) => b.periodTo.getTime() - a.periodTo.getTime()),
      create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: 'o1', ...data }; },
      update: async ({ data }: { data: Record<string, unknown> }) => ({ id: 'o1', ...data }),
    },
    leaseInvoice: {
      count: async () => 0,
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: 'inv1', ...data }),
    },
    leaseInvoiceLine: { create: async ({ data }: { data: Record<string, unknown> }) => data },
  };
  return { tx: tx as never, created };
}

const monthly = (months: number, odometer: number) => ({
  tenantId: 't1', contract, readingType: 'MONTHLY' as const,
  mileage: odometer, readingDate: new Date(start.getTime() + months * 30.44 * DAY),
});

describe('computeAndInvoiceMileageOverage', () => {
  it('bills nothing for a lessee within the cap every month (month 3, 5,900 km)', async () => {
    const { tx } = makeTx([]);
    const r = await computeAndInvoiceMileageOverage(tx, monthly(3, 15_900));
    expect(r.reason).toBe('WITHIN_CAP');
  });

  it('bills only the excess over the cumulative allowance', async () => {
    const { tx, created } = makeTx([]);
    const r = await computeAndInvoiceMileageOverage(tx, monthly(3, 16_500)); // 6,500 vs 6,000
    expect(r.reason).toBe('INVOICED');
    expect(created[0]).toMatchObject({ allowedKm: 6000, actualKm: 6500, overageKm: 500 });
  });

  it('does not bill the same kilometres again next month', async () => {
    const lastPeriod = monthly(3, 0).readingDate;
    const { tx, created } = makeTx([{ overageKm: 500, periodTo: lastPeriod }]);
    // Month 4: 8,300 km driven vs 8,000 allowed → 300 over, 500 already billed.
    const r = await computeAndInvoiceMileageOverage(tx, monthly(4, 18_300));
    expect(r.reason).toBe('WITHIN_CAP');
    expect(created).toHaveLength(0);
  });

  it('bills only the new increment, from the end of the last billed period', async () => {
    const lastPeriod = monthly(3, 0).readingDate;
    const { tx, created } = makeTx([{ overageKm: 500, periodTo: lastPeriod }]);
    // Month 4: 9,000 km vs 8,000 allowed → 1,000 over, 500 billed → 500 more.
    await computeAndInvoiceMileageOverage(tx, monthly(4, 19_000));
    expect(created[0]).toMatchObject({ overageKm: 500, periodFrom: lastPeriod });
  });

  it('nets monthly overage already billed out of the return assessment', async () => {
    const { tx, created } = makeTx([{ overageKm: 1_000, periodTo: new Date(start.getTime() + 200 * DAY) }]);
    // Term: 12 months x 2,000 = 24,000 allowed; 25,500 driven → 1,500 over, 1,000 billed → 500.
    await computeAndInvoiceMileageOverage(tx, {
      tenantId: 't1', contract, readingType: 'RETURN', mileage: 35_500, readingDate: contract.endDate,
    });
    expect(created[0]).toMatchObject({ allowedKm: 24_000, actualKm: 25_500, overageKm: 500 });
  });

  it('does not re-raise a waived overage', async () => {
    const { tx, created } = makeTx([{ overageKm: 500, periodTo: monthly(3, 0).readingDate }]); // e.g. WAIVED
    const r = await computeAndInvoiceMileageOverage(tx, monthly(3, 16_500));
    expect(r.reason).toBe('WITHIN_CAP');
    expect(created).toHaveLength(0);
  });
});
