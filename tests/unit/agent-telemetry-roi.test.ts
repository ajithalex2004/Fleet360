import { describe, it, expect } from 'vitest';
import {
  calculateTokenCost,
  calculateRoutingCost,
  computeRoi,
  USD_TO_AED_RATE,
  CAPABILITY_PRICING,
  ROUTING_PROVIDER_PRICING,
} from '../../src/lib/agents/telemetry';

describe('Phase 1: Agent Telemetry, Cost Valuation & ROI Engine', () => {
  describe('1. Model Capability Aliases & Token Cost Valuation', () => {
    it('calculates zero external AI cost for deterministic rules and local solvers', () => {
      const detCost = calculateTokenCost('DETERMINISTIC_RULES', 5000, 2000);
      expect(detCost.costUsd).toBe(0);
      expect(detCost.costAed).toBe(0);

      const localCost = calculateTokenCost('LOCAL_STATISTICAL', 10000, 5000);
      expect(localCost.costUsd).toBe(0);
      expect(localCost.costAed).toBe(0);
    });

    it('accurately computes token cost for ECONOMY_TEXT alias (gpt-4o-mini / gemini-flash)', () => {
      // 100,000 input tokens ($0.15/1M) + 20,000 output tokens ($0.60/1M) + 50,000 cached tokens ($0.075/1M)
      // Input: (100000/1000000)*0.15 = 0.015
      // Output: (20000/1000000)*0.60 = 0.012
      // Cached: (50000/1000000)*0.075 = 0.00375
      // Total USD = 0.03075 -> AED = 0.03075 * 3.6725 = 0.1129
      const result = calculateTokenCost('ECONOMY_TEXT', 100_000, 20_000, 50_000);

      expect(result.costUsd).toBe(0.03075);
      expect(result.costAed).toBe(Number((0.03075 * USD_TO_AED_RATE).toFixed(4)));
    });

    it('computes higher cost for ADVANCED_REASONING compared to ECONOMY_TEXT', () => {
      const economy = calculateTokenCost('ECONOMY_TEXT', 50_000, 10_000);
      const advanced = calculateTokenCost('ADVANCED_REASONING', 50_000, 10_000);

      expect(advanced.costUsd).toBeGreaterThan(economy.costUsd * 10);
      expect(advanced.costAed).toBeGreaterThan(economy.costAed * 10);
    });
  });

  describe('2. Routing Matrix Cost & Cache Savings Accounting', () => {
    it('calculates live Google Distance Matrix query cost', () => {
      // 100 elements (10x10 matrix) at $0.005/element = $0.50 USD
      const cost = calculateRoutingCost('google', 100, false);
      expect(cost.costUsd).toBe(0.5);
      expect(cost.costAed).toBe(Number((0.5 * USD_TO_AED_RATE).toFixed(4)));
      expect(cost.costAvoidedUsd).toBe(0);
      expect(cost.costAvoidedAed).toBe(0);
    });

    it('records zero cost and tracks avoided expenditure on cache hits', () => {
      // 100 elements served from cache -> $0 cost, $0.50 USD avoided
      const cost = calculateRoutingCost('google', 100, true);
      expect(cost.costUsd).toBe(0);
      expect(cost.costAed).toBe(0);
      expect(cost.costAvoidedUsd).toBe(0.5);
      expect(cost.costAvoidedAed).toBe(Number((0.5 * USD_TO_AED_RATE).toFixed(4)));
    });

    it('calculates zero cost for local Haversine / OSRM queries', () => {
      const cost = calculateRoutingCost('haversine', 500, false);
      expect(cost.costUsd).toBe(0);
      expect(cost.costAed).toBe(0);
    });
  });

  describe('3. Financial ROI Multiplier & Business Value Metrics', () => {
    it('computes astronomical ROI for zero-cost deterministic route optimization', () => {
      // 0 AED external cost, AED 15,000 monthly fleet savings
      const roi = computeRoi(0, 15_000);
      expect(roi.netValueAed).toBe(15_000);
      expect(roi.roiMultiplier).toBe(999.99);
    });

    it('computes exact ROI multiplier for AI-assisted workflows', () => {
      // AED 2.50 AI cost, AED 7,500 monthly vehicle savings (1 bus saved)
      const roi = computeRoi(2.5, 7_500);
      expect(roi.netValueAed).toBe(7497.5);
      expect(roi.roiMultiplier).toBe(3000); // 7500 / 2.5 = 3000x ROI
    });

    it('handles negative / neutral outcomes safely', () => {
      const roi = computeRoi(10.0, 0);
      expect(roi.netValueAed).toBe(-10.0);
      expect(roi.roiMultiplier).toBe(0.0);
    });
  });
});
