/**
 * Rental agreement close and invoicing.
 *
 * - POST /api/rental/bookings/[id]/complete leaves the agreement COMPLETED;
 *   close and generate-invoice refused it (ACTIVE / CLOSED only).
 * - Both read pickup_date / dropoff_date, which rental_agreements does not
 *   have (start_date / end_date): the rental was priced from "now" and no
 *   late fee was ever charged. The pickup odometer is recorded as
 *   mileage_out, so the excess-km fee never applied either.
 * - subtotal already includes the rate engine's negative DISCOUNT line, and
 *   the discount was subtracted again — given twice, and in close VAT was
 *   charged on the doubly discounted amount.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const DAY = 86400000;
const START = new Date('2026-10-01T10:00:00Z');
const END = new Date(START.getTime() + 2 * DAY);
const RETURNED = new Date(END.getTime() + 3 * 3600_000); // 3 h late

const st = vi.hoisted(() => ({
  agreement: {} as Record<string, unknown>,
  inserts: [] as Array<{ sql: string; args: unknown[] }>,
  rateRequests: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/prisma', () => ({ prisma: { pricingRule: { findMany: async () => [] } } }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) => fn({
    $queryRawUnsafe: async (sql: string) => {
      if (sql.includes('FROM rental_agreements ra')) return [st.agreement];
      if (sql.includes('COUNT(*)')) return [{ count: 0n }];
      return [];
    },
    $executeRawUnsafe: async (sql: string, ...args: unknown[]) => { st.inserts.push({ sql, args }); return 1; },
  }),
}));
vi.mock('@/events/event-bus', () => ({ getEventBus: () => ({ publish: async () => {} }) }));
vi.mock('@/lib/rental-rate-engine', () => ({
  calculateRate: (_rules: unknown, req: Record<string, unknown>) => {
    st.rateRequests.push(req);
    return {
      breakdown: [
        { type: 'BASE', label: 'Base', qty: 2, unitPrice: 500, unitLabel: 'day', amount: 1000 },
        { type: 'DISCOUNT', label: 'Promo -10%', qty: 1, unitPrice: -100, unitLabel: 'flat', amount: -100 },
      ],
      discountAmount: 100, totalDays: 2, includedKmPerDay: 100, excessKmRate: 1,
      lateFeePerHour: 20, gracePeriodMin: 30, lateFeeCap: 0,
    };
  },
}));

import { NextRequest } from 'next/server';
import { POST as closeAgreement } from '@/app/api/rental/agreements/[id]/close/route';
import { POST as generateInvoice } from '@/app/api/rental/agreements/[id]/generate-invoice/route';

const headers = { 'x-tenant-id': 'tenant-a', 'x-user-id': 'u1', 'x-user-role': 'TENANT_ADMIN', 'content-type': 'application/json' };
const params = { params: Promise.resolve({ id: 'agr-1' }) };
const invoiceArgs = () => st.inserts.find((q) => q.sql.includes('INSERT INTO rental_invoices '))!.args;

beforeEach(() => {
  st.inserts.length = 0;
  st.rateRequests.length = 0;
  st.agreement = {
    id: 'agr-1', agreement_no: 'RA-1', customer_id: 'cust-1', vehicle_id: null, status: 'COMPLETED',
    start_date: START.toISOString(), end_date: END.toISOString(),
    mileage_out: 10_000, pickup_odometer: null, pickup_fuel_level: null, currency: 'AED',
  };
});

describe('POST /api/rental/agreements/[id]/close', () => {
  it('closes a COMPLETED agreement with late and excess-km fees and one discount', async () => {
    const res = await closeAgreement(new NextRequest('http://localhost/api/rental/agreements/agr-1/close', {
      method: 'POST', headers,
      body: JSON.stringify({ actualReturnDate: RETURNED.toISOString(), returnOdometer: 10_600 }),
    }), params);
    expect(res.status).toBe(200);
    expect(st.rateRequests[0].pickupDate).toEqual(START);

    const a = invoiceArgs();
    const [subtotal, disc, taxable, , tax, total] = a.slice(11, 17) as number[];
    // 1,000 base - 100 discount + late fee (3 h - 30 min grace → 3 h x 20 = 60)
    // + excess km (600 driven - 200 included = 400 x 1).
    expect(subtotal).toBe(1000 - 100 + 60 + 400);
    expect(disc).toBe(100);
    expect(taxable).toBe(1000 + 60 + 400 - 100);
    expect(tax).toBe(Math.round(taxable * 5) / 100);
    expect(total).toBe(subtotal + tax);
  });

  it('still refuses a cancelled agreement', async () => {
    st.agreement.status = 'CANCELLED';
    const res = await closeAgreement(new NextRequest('http://localhost/api/rental/agreements/agr-1/close', {
      method: 'POST', headers, body: JSON.stringify({ actualReturnDate: RETURNED.toISOString() }),
    }), params);
    expect(res.status).toBe(422);
  });
});

describe('POST /api/rental/agreements/[id]/generate-invoice', () => {
  it('invoices a COMPLETED agreement from its start date, with the discount once', async () => {
    const res = await generateInvoice(new NextRequest('http://localhost/api/rental/agreements/agr-1/generate-invoice', {
      method: 'POST', headers, body: JSON.stringify({}),
    }), params);
    expect(res.status).toBeLessThan(300);
    expect(st.rateRequests[0].pickupDate).toEqual(START);

    const [subtotal, disc, taxable, , tax, total] = invoiceArgs().slice(12, 18) as number[];
    expect(subtotal).toBe(900);
    expect(disc).toBe(100);
    expect(taxable).toBe(900);
    expect(tax).toBe(45);
    expect(total).toBe(945);
  });
});
