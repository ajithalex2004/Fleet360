/**
 * Integration tests for the rate engine — hits a real Postgres via Prisma
 * and exercises the engine end-to-end on the rate contracts table.
 *
 * Day-2 deliverable: confirm that applyContractQuoteToInput() correctly
 * patches a shipment input with the contracted rate and audit metadata
 * before createShipmentOrder writes it.
 *
 * Prereqs: DATABASE_URL must be set (any tenant works — these tests use a
 * unique tenant_id per run to avoid interfering with seeded data).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { quoteShipment, applyContractQuoteToInput } from '@/lib/logistics/rate-engine';

const prisma = new PrismaClient();
const TENANT_ID = randomUUID();
const CUSTOMER_ID = randomUUID();
const OTHER_CUSTOMER_ID = randomUUID();

const seededContractIds: string[] = [];

async function seedContract(args: {
  contractNo: string;
  customerId?: string | null;
  laneOrigin?: string;
  laneDestination?: string;
  vehicleType?: string | null;
  baseRate: number;
  fuelSurchargePct?: number;
  minCharge?: number;
  status?: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}) {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_rate_contracts (
       id, tenant_id, customer_id, customer_name, contract_no,
       lane_origin, lane_destination, vehicle_type, service_level, currency,
       base_rate, min_charge, fuel_surcharge_pct, status,
       effective_from, effective_to
     ) VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,NULL,'AED',$8,$9,$10,$11,$12::date,$13::date)`,
    id, TENANT_ID, args.customerId ?? null, args.contractNo,
    args.laneOrigin ?? 'Dubai', args.laneDestination ?? 'Abu Dhabi',
    args.vehicleType ?? null,
    args.baseRate, args.minCharge ?? 0, args.fuelSurchargePct ?? 0,
    args.status ?? 'ACTIVE',
    args.effectiveFrom ?? null, args.effectiveTo ?? null,
  );
  seededContractIds.push(id);
  return id;
}

beforeAll(async () => {
  // The table is lazy-created — touching it once via the engine triggers
  // ensureLogisticsDomainTables(). We do that with a trivial quote.
  // Neon DB cold-start can take 10-30s, so give the hook plenty of room.
  await quoteShipment({ tenantId: TENANT_ID, origin: 'X', destination: 'Y' });
}, 60_000);

afterAll(async () => {
  if (seededContractIds.length) {
    // id is TEXT not UUID on this table — cast the array element type to text.
    await prisma.$executeRawUnsafe(
      `DELETE FROM logistics_rate_contracts WHERE id = ANY($1::text[])`,
      seededContractIds,
    );
  }
  await prisma.$disconnect();
});

// ── quoteShipment against a real DB ────────────────────────────────────────

describe('quoteShipment (live DB)', () => {
  it('returns no-lane-match when no contract exists for the lane', async () => {
    const r = await quoteShipment({
      tenantId: TENANT_ID, origin: 'Atlantis', destination: 'Lemuria',
    });
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('no-lane-match');
  });

  it('matches a generic contract on the lane and returns the computed total', async () => {
    await seedContract({ contractNo: 'IT-GENERIC-' + Date.now(), baseRate: 1200, fuelSurchargePct: 10 });

    const r = await quoteShipment({
      tenantId: TENANT_ID,
      origin: 'Dubai', destination: 'Abu Dhabi',
      shipmentDate: '2026-06-22',
    });
    expect(r.matched).toBe(true);
    expect(r.baseRate).toBe(1200);
    expect(r.fuelSurchargeAmount).toBe(120);
    expect(r.total).toBe(1320);
    expect(r.currency).toBe('AED');
  });

  it('prefers a customer-specific contract over a generic one', async () => {
    await seedContract({ contractNo: 'IT-CUST-' + Date.now(), customerId: CUSTOMER_ID, baseRate: 900 });

    const r = await quoteShipment({
      tenantId: TENANT_ID, customerId: CUSTOMER_ID,
      origin: 'Dubai', destination: 'Abu Dhabi',
      shipmentDate: '2026-06-22',
    });
    expect(r.matched).toBe(true);
    expect(r.customerId).toBe(CUSTOMER_ID);
    expect(r.total).toBe(900);
  });

  it('does not match a contract locked to a different customer', async () => {
    // Note: the generic contract above is still there and would normally match.
    // Probe with an unknown lane to isolate just the customer-locked one.
    await seedContract({
      contractNo: 'IT-OTHER-' + Date.now(),
      customerId: OTHER_CUSTOMER_ID,
      laneOrigin: 'Sharjah', laneDestination: 'Ras Al Khaimah',
      baseRate: 500,
    });

    const r = await quoteShipment({
      tenantId: TENANT_ID, customerId: CUSTOMER_ID,
      origin: 'Sharjah', destination: 'Ras Al Khaimah',
      shipmentDate: '2026-06-22',
    });
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('no-active-contract');
  });

  it('rejects a contract whose effective window does not include the shipment date', async () => {
    await seedContract({
      contractNo: 'IT-EXPIRED-' + Date.now(),
      laneOrigin: 'Fujairah', laneDestination: 'Al Ain',
      baseRate: 700,
      effectiveFrom: '2020-01-01', effectiveTo: '2020-12-31',
    });

    const r = await quoteShipment({
      tenantId: TENANT_ID,
      origin: 'Fujairah', destination: 'Al Ain',
      shipmentDate: '2026-06-22',
    });
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('no-active-contract');
  });
});

// ── applyContractQuoteToInput ──────────────────────────────────────────────

describe('applyContractQuoteToInput (live DB)', () => {
  it('skips when customerRateAmount is already set', async () => {
    const { input, quote } = await applyContractQuoteToInput({
      tenantId: TENANT_ID,
      originName: 'Dubai', destinationName: 'Abu Dhabi',
      customerRateAmount: 999,
    });
    expect(quote).toBeNull();
    expect(input.customerRateAmount).toBe(999);
  });

  it('skips when bookingMode is SPOT', async () => {
    const { input, quote } = await applyContractQuoteToInput({
      tenantId: TENANT_ID,
      originName: 'Dubai', destinationName: 'Abu Dhabi',
      bookingMode: 'SPOT',
      customerRateAmount: null,
    });
    expect(quote).toBeNull();
    expect(input.customerRateAmount).toBeNull();
  });

  it('populates customerRateAmount + audit metadata when a contract matches', async () => {
    const { input, quote } = await applyContractQuoteToInput({
      tenantId: TENANT_ID,
      originName: 'Dubai', destinationName: 'Abu Dhabi',
      cargoOwnerCustomerId: CUSTOMER_ID,
      customerRateAmount: null,
      pickupWindowFrom: '2026-06-22T08:00:00Z',
    });
    expect(quote?.matched).toBe(true);
    expect(input.customerRateAmount).toBe(900); // customer-specific contract wins
    const meta = input.metadata as { rateQuote?: { matched: boolean; contractNo: string; total: number } };
    expect(meta.rateQuote?.matched).toBe(true);
    expect(meta.rateQuote?.total).toBe(900);
    expect(meta.rateQuote?.contractNo).toMatch(/^IT-CUST-/);
  });

  it('records a quote-miss audit note when no contract matches, leaving customerRateAmount null', async () => {
    const { input, quote } = await applyContractQuoteToInput({
      tenantId: TENANT_ID,
      originName: 'Nowhereville', destinationName: 'Voidtown',
      customerRateAmount: null,
    });
    expect(quote?.matched).toBe(false);
    expect(quote?.reason).toBe('no-lane-match');
    expect(input.customerRateAmount).toBeNull();
    const meta = input.metadata as { rateQuote?: { matched: boolean; reason: string } };
    expect(meta.rateQuote?.matched).toBe(false);
    expect(meta.rateQuote?.reason).toBe('no-lane-match');
  });

  it('persists quotedContractId on a match so dispatch can filter by contract (Day 4)', async () => {
    const { input } = await applyContractQuoteToInput({
      tenantId: TENANT_ID,
      cargoOwnerCustomerId: CUSTOMER_ID,
      originName: 'Dubai', destinationName: 'Abu Dhabi',
      customerRateAmount: null,
    });
    expect(input.quotedContractId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('computes margin on the input when carrier cost is supplied (Day 4)', async () => {
    const { input } = await applyContractQuoteToInput({
      tenantId: TENANT_ID,
      cargoOwnerCustomerId: CUSTOMER_ID,
      originName: 'Dubai', destinationName: 'Abu Dhabi',
      customerRateAmount: null,
      carrierCostAmount: 600,  // customer rate is 900 for this customer's contract
    });
    expect(input.customerRateAmount).toBe(900);
    expect(input.marginAmount).toBe(300);
  });
});
