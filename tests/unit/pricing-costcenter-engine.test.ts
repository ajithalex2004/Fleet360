import { describe, it, expect } from 'vitest';
import {
  calculateInstantQuotation,
  SERVICE_BASE_RATES,
} from '@/app/api/booking-portal/quotation/route';
import {
  CORPORATE_COST_CENTERS,
  CORPORATE_BILLING_METHODS,
} from '@/components/booking/InstantPricingCostCenter';

describe('Instant Dynamic Pricing & Corporate Cost Center Engine', () => {
  it('accurately computes itemized base fare, distance charge, Salik tolls, and 5% UAE VAT', () => {
    // Executive Luxury Sedan: Base AED 180, AED 4.50/km
    // Distance 20 km, Tolls AED 8.00 (2 gates)
    // Base: 180
    // Distance charge: 20 * 4.5 = 90
    // Tolls: 8
    // Subtotal: 180 + 90 + 8 = 278
    // 5% VAT: 278 * 0.05 = 13.90
    // Total: 278 + 13.90 = 291.90
    const quote = calculateInstantQuotation({
      serviceType: 'EXECUTIVE',
      vehicleCategory: 'Luxury Sedan',
      distanceKm: 20,
      salikTollsAed: 8,
    });

    expect(quote.baseFareAed).toBe(180);
    expect(quote.distanceChargeAed).toBe(90);
    expect(quote.salikTollsAed).toBe(8);
    expect(quote.subtotalAed).toBe(278);
    expect(quote.vatAmountAed).toBeCloseTo(13.9, 2);
    expect(quote.totalFareAed).toBeCloseTo(291.9, 2);
    expect(quote.currency).toBe('AED');
    expect(quote.requiresEscalation).toBe(false);
  });

  it('flags trips exceeding departmental policy budget caps for manager escalation', () => {
    // Long distance Luxury SUV trip exceeding AED 1,000 threshold
    const longTripQuote = calculateInstantQuotation({
      serviceType: 'EXECUTIVE',
      vehicleCategory: 'Luxury SUV',
      distanceKm: 180, // Dubai to Abu Dhabi round trip
      salikTollsAed: 24,
    });

    // Base: 250, Dist: 180 * 5.5 = 990, Tolls: 24 -> Subtotal = 1264, VAT = 63.20 -> Total = 1327.20
    expect(longTripQuote.totalFareAed).toBeGreaterThan(1000);
    expect(longTripQuote.requiresEscalation).toBe(true);
    expect(longTripQuote.escalationReason).toContain('exceeds standard departmental pre-approval policy cap');
  });

  it('provides verified corporate cost centers across all operational departments', () => {
    expect(CORPORATE_COST_CENTERS.length).toBeGreaterThanOrEqual(5);

    const execCc = CORPORATE_COST_CENTERS.find((c) => c.code === 'CC-EXEC-1001');
    expect(execCc).toBeDefined();
    expect(execCc?.budgetCap).toBe(1500);

    const opsCc = CORPORATE_COST_CENTERS.find((c) => c.code === 'CC-OPS-3003');
    expect(opsCc).toBeDefined();
  });

  it('supports standard enterprise billing methods including credit line and direct chargeback', () => {
    expect(CORPORATE_BILLING_METHODS.some((b) => b.id === 'CORPORATE_ACCOUNT')).toBe(true);
    expect(CORPORATE_BILLING_METHODS.some((b) => b.id === 'COST_CENTER_DIRECT')).toBe(true);
    expect(CORPORATE_BILLING_METHODS.some((b) => b.id === 'CORPORATE_CARD')).toBe(true);
  });
});
