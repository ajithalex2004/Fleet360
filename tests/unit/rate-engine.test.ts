import { describe, expect, it, vi, beforeEach } from 'vitest';

// matchLaneRateContracts is the DB-hitting boundary. We mock it so the engine
// itself can be exercised without a database. Pure helpers are tested directly.
vi.mock('@/lib/logistics/domain', () => ({
  matchLaneRateContracts: vi.fn(),
}));

import { matchLaneRateContracts } from '@/lib/logistics/domain';
import {
  scoreContract,
  isContractActiveOn,
  computePrice,
  quoteShipment,
} from '@/lib/logistics/rate-engine';

const mockMatch = matchLaneRateContracts as unknown as ReturnType<typeof vi.fn>;

const baseContract = {
  id: 'c1', tenantId: 't1', contractNo: 'RC-1',
  customerId: null as string | null, customerName: null,
  carrierId: null as string | null, carrierName: null,
  laneOrigin: 'Dubai', laneDestination: 'Abu Dhabi',
  vehicleType: null as string | null, serviceLevel: null as string | null,
  currency: 'AED', baseRate: 1000,
  minCharge: 0 as number | null, fuelSurchargePct: 0 as number | null,
  accessorialRules: {} as unknown,
  effectiveFrom: null as string | null, effectiveTo: null as string | null,
  status: 'ACTIVE',
  metadata: {}, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => mockMatch.mockReset());

// ── computePrice — pure ────────────────────────────────────────────────────

describe('computePrice', () => {
  it('returns just the base when fuel and min are zero', () => {
    expect(computePrice({ baseRate: 500, fuelSurchargePct: 0, minCharge: 0 })).toEqual({
      baseRate: 500, fuelSurchargePct: 0, fuelSurchargeAmount: 0,
      minCharge: 0, minChargeApplied: false, subtotal: 500, total: 500,
    });
  });

  it('applies a percentage fuel surcharge', () => {
    const q = computePrice({ baseRate: 1000, fuelSurchargePct: 12.5, minCharge: 0 });
    expect(q.fuelSurchargeAmount).toBe(125);
    expect(q.subtotal).toBe(1125);
    expect(q.total).toBe(1125);
    expect(q.minChargeApplied).toBe(false);
  });

  it('floors at min charge when subtotal would be below it', () => {
    const q = computePrice({ baseRate: 100, fuelSurchargePct: 10, minCharge: 250 });
    expect(q.subtotal).toBe(110);
    expect(q.total).toBe(250);
    expect(q.minChargeApplied).toBe(true);
  });

  it('clamps negative inputs to zero so a bad contract never produces a negative bill', () => {
    expect(computePrice({ baseRate: -100, fuelSurchargePct: -5, minCharge: -10 }).total).toBe(0);
  });
});

// ── isContractActiveOn — pure ──────────────────────────────────────────────

describe('isContractActiveOn', () => {
  it('returns false when the contract is not ACTIVE', () => {
    expect(isContractActiveOn(
      { effectiveFrom: null, effectiveTo: null, status: 'EXPIRED' }, '2026-06-22',
    )).toBe(false);
  });

  it('returns true when there are no date bounds and status is ACTIVE', () => {
    expect(isContractActiveOn(
      { effectiveFrom: null, effectiveTo: null, status: 'ACTIVE' }, '2026-06-22',
    )).toBe(true);
  });

  it('rejects shipments before effective_from', () => {
    expect(isContractActiveOn(
      { effectiveFrom: '2026-07-01', effectiveTo: null, status: 'ACTIVE' }, '2026-06-22',
    )).toBe(false);
  });

  it('rejects shipments after effective_to', () => {
    expect(isContractActiveOn(
      { effectiveFrom: null, effectiveTo: '2026-05-01', status: 'ACTIVE' }, '2026-06-22',
    )).toBe(false);
  });

  it('accepts a shipment on the boundary day', () => {
    expect(isContractActiveOn(
      { effectiveFrom: '2026-06-22', effectiveTo: '2026-06-22', status: 'ACTIVE' }, '2026-06-22',
    )).toBe(true);
  });
});

// ── scoreContract — pure ───────────────────────────────────────────────────

describe('scoreContract', () => {
  it('ranks customer-specific above generic', () => {
    const specific = scoreContract({
      contract: { customerId: 'C1', carrierId: null, vehicleType: null, serviceLevel: null },
      request:  { customerId: 'C1' },
    });
    const generic = scoreContract({
      contract: { customerId: null, carrierId: null, vehicleType: null, serviceLevel: null },
      request:  { customerId: 'C1' },
    });
    expect(specific.score).toBeGreaterThan(generic.score);
  });

  it('rewards exact vehicle match over any-vehicle', () => {
    const exact = scoreContract({
      contract: { customerId: null, carrierId: null, vehicleType: 'REEFER', serviceLevel: null },
      request:  { vehicleType: 'reefer' },
    });
    const any = scoreContract({
      contract: { customerId: null, carrierId: null, vehicleType: null, serviceLevel: null },
      request:  { vehicleType: 'REEFER' },
    });
    expect(exact.score).toBeGreaterThan(any.score);
    expect(exact.why).toContain('exact-vehicle');
  });

  it('a customer + carrier + exact-vehicle contract beats every other shape', () => {
    const full = scoreContract({
      contract: { customerId: 'C1', carrierId: 'X1', vehicleType: 'FLATBED', serviceLevel: 'EXPRESS' },
      request:  { customerId: 'C1', carrierId: 'X1', vehicleType: 'FLATBED', serviceLevel: 'EXPRESS' },
    });
    const customerOnly = scoreContract({
      contract: { customerId: 'C1', carrierId: null, vehicleType: null, serviceLevel: null },
      request:  { customerId: 'C1', carrierId: 'X1', vehicleType: 'FLATBED', serviceLevel: 'EXPRESS' },
    });
    expect(full.score).toBeGreaterThan(customerOnly.score);
  });
});

// ── quoteShipment — integration via mocked DB layer ────────────────────────

describe('quoteShipment', () => {
  const req = {
    tenantId: 't1', origin: 'Dubai', destination: 'Abu Dhabi',
    vehicleType: 'REEFER', customerId: 'C1', shipmentDate: '2026-06-22',
  };

  it('returns no-lane-match when no contracts exist', async () => {
    mockMatch.mockResolvedValueOnce([]);
    const r = await quoteShipment(req);
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('no-lane-match');
    expect(r.total).toBe(0);
  });

  it('returns no-active-contract when candidates exist but none in the date window', async () => {
    mockMatch.mockResolvedValueOnce([
      { ...baseContract, effectiveFrom: '2027-01-01' },
    ]);
    const r = await quoteShipment(req);
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('no-active-contract');
  });

  it('picks the customer-specific contract over a generic one on the same lane', async () => {
    mockMatch.mockResolvedValueOnce([
      { ...baseContract, id: 'generic',  contractNo: 'RC-GEN', customerId: null, baseRate: 1000 },
      { ...baseContract, id: 'specific', contractNo: 'RC-C1',  customerId: 'C1', baseRate: 850  },
    ]);
    const r = await quoteShipment(req);
    expect(r.matched).toBe(true);
    expect(r.contractId).toBe('specific');
    expect(r.total).toBe(850);
    expect(r.alternates[0].contractId).toBe('generic');
  });

  it('skips a contract locked to a different customer', async () => {
    mockMatch.mockResolvedValueOnce([
      { ...baseContract, customerId: 'OTHER_CUSTOMER' },
    ]);
    const r = await quoteShipment(req);
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('no-active-contract');
  });

  it('applies fuel surcharge and min charge on the winning contract', async () => {
    mockMatch.mockResolvedValueOnce([
      { ...baseContract, baseRate: 200, fuelSurchargePct: 10, minCharge: 500 },
    ]);
    const r = await quoteShipment(req);
    expect(r.matched).toBe(true);
    expect(r.fuelSurchargeAmount).toBe(20);
    expect(r.subtotal).toBe(220);
    expect(r.total).toBe(500);
    expect(r.minChargeApplied).toBe(true);
  });

  it('breaks ties by most recently created — newer rate wins', async () => {
    mockMatch.mockResolvedValueOnce([
      { ...baseContract, id: 'older', contractNo: 'RC-OLD', baseRate: 1000, createdAt: '2026-01-01T00:00:00Z' },
      { ...baseContract, id: 'newer', contractNo: 'RC-NEW', baseRate:  900, createdAt: '2026-06-01T00:00:00Z' },
    ]);
    const r = await quoteShipment({ ...req, customerId: null });
    expect(r.contractId).toBe('newer');
    expect(r.total).toBe(900);
  });
});

// ── Day 4: applyContractQuoteToInput populates quotedContractId + margin ────

import { applyContractQuoteToInput } from '@/lib/logistics/rate-engine';

describe('applyContractQuoteToInput (Day 4 — contract id & margin)', () => {
  it('writes quotedContractId on a successful match', async () => {
    mockMatch.mockResolvedValueOnce([
      { ...baseContract, id: 'win-1', contractNo: 'RC-WIN', baseRate: 1000 },
    ]);
    const { input } = await applyContractQuoteToInput({
      tenantId: 't1',
      originName: 'Dubai', destinationName: 'Abu Dhabi',
      customerRateAmount: null,
    });
    expect(input.quotedContractId).toBe('win-1');
    expect(input.customerRateAmount).toBe(1000);
  });

  it('computes margin = customer_rate - carrier_cost when both known', async () => {
    mockMatch.mockResolvedValueOnce([
      { ...baseContract, baseRate: 1500 },
    ]);
    const { input } = await applyContractQuoteToInput({
      tenantId: 't1',
      originName: 'Dubai', destinationName: 'Abu Dhabi',
      customerRateAmount: null,
      carrierCostAmount: 900,
    });
    expect(input.customerRateAmount).toBe(1500);
    expect(input.marginAmount).toBe(600);
  });

  it('does not compute margin when carrier cost is unknown', async () => {
    mockMatch.mockResolvedValueOnce([
      { ...baseContract, baseRate: 1500 },
    ]);
    const { input } = await applyContractQuoteToInput({
      tenantId: 't1',
      originName: 'Dubai', destinationName: 'Abu Dhabi',
      customerRateAmount: null,
    });
    expect(input.marginAmount).toBeUndefined();
  });

  it('handles negative margin (carrier cost > contracted rate) without clamping', async () => {
    mockMatch.mockResolvedValueOnce([
      { ...baseContract, baseRate: 800 },
    ]);
    const { input } = await applyContractQuoteToInput({
      tenantId: 't1',
      originName: 'Dubai', destinationName: 'Abu Dhabi',
      customerRateAmount: null,
      carrierCostAmount: 1000,  // overpaid carrier — operator needs to see the loss
    });
    expect(input.marginAmount).toBe(-200);
  });
});
