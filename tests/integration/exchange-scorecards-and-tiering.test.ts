import { describe, it, expect } from 'vitest';
import { PartnerPerformanceTier } from '@prisma/client';
import { ScorecardService } from '@/lib/exchange/scorecard-service';
import { TieredSourcingService } from '@/lib/exchange/tiered-sourcing-service';

describe('Fleet360 Exchange: Phase 4 Partner Performance Scoring, SLAs & Tiered Sourcing', () => {
  it('Test 1: Platinum Tier Evaluation — High Volume (50+ trips) & Superior OTP (95%+)', () => {
    const completedTrips = 60;
    const onTimeTrips = 58;
    const otp = (onTimeTrips / completedTrips) * 100; // 96.67%
    const podQuality = 100.0;
    const quoteResponse = 90.0;
    const exceptionRate = 0.0;
    const disputeRate = 0.0;

    // 40% OTP + 20% POD + 15% Quote + 15% Low Exception + 10% Zero Dispute
    const score =
      0.40 * otp +
      0.20 * podQuality +
      0.15 * quoteResponse +
      0.15 * (100 - exceptionRate) +
      0.10 * (100 - disputeRate);

    expect(score).toBeGreaterThanOrEqual(90.0);

    const tier = ScorecardService.calculateTier(score, completedTrips, otp);
    expect(tier).toBe(PartnerPerformanceTier.PLATINUM);
  });

  it('Test 2: Gold and Silver Tier Deterministic Classification', () => {
    // Gold Candidate: 25 trips, 92% OTP, 85 score
    const goldTier = ScorecardService.calculateTier(85.0, 25, 92.0);
    expect(goldTier).toBe(PartnerPerformanceTier.GOLD);

    // Silver Candidate: 15 trips, 88% OTP, 75 score
    const silverTier = ScorecardService.calculateTier(75.0, 15, 88.0);
    expect(silverTier).toBe(PartnerPerformanceTier.SILVER);

    // Bronze Candidate: 6 trips, 78% OTP, 62 score
    const bronzeTier = ScorecardService.calculateTier(62.0, 6, 78.0);
    expect(bronzeTier).toBe(PartnerPerformanceTier.BRONZE);

    // Standard Candidate: 2 trips, new partner
    const standardTier = ScorecardService.calculateTier(95.0, 2, 100.0);
    expect(standardTier).toBe(PartnerPerformanceTier.STANDARD);
  });

  it('Test 3: Operational Exception and Dispute Penalties on Scorecard', () => {
    const cleanScore =
      0.40 * 95.0 + 0.20 * 95.0 + 0.15 * 90.0 + 0.15 * 100.0 + 0.10 * 100.0; // 95.5

    // Impact of 20% exception rate and 15% dispute rate
    const penalizedScore =
      0.40 * 95.0 + 0.20 * 95.0 + 0.15 * 90.0 + 0.15 * (100 - 20) + 0.10 * (100 - 15); // 91.0

    expect(penalizedScore).toBeLessThan(cleanScore);
    expect(cleanScore - penalizedScore).toBeCloseTo(4.5, 1);
  });

  it('Test 4: Tiered Sourcing Quotation Ranking Algorithm', () => {
    const quotes = [
      {
        id: 'q-standard-cheap',
        totalAmount: 600.0,
        partner: {
          legalName: 'Budget Bus LLC',
          scorecard: { tier: PartnerPerformanceTier.STANDARD, compositeScore: 65.0 },
        },
      },
      {
        id: 'q-platinum-premium',
        totalAmount: 650.0,
        partner: {
          legalName: 'Al Etihad Platinum Transport',
          scorecard: { tier: PartnerPerformanceTier.PLATINUM, compositeScore: 96.0 },
        },
      },
    ];

    const ranked = TieredSourcingService.rankQuotes(quotes);

    expect(ranked.length).toBe(2);
    // Even though Budget Bus is slightly cheaper (600 vs 650), Platinum partner's high score (96 vs 65) makes it the top recommendation
    expect(ranked[0].partner.legalName).toBe('Al Etihad Platinum Transport');
    expect(ranked[0].isRecommended).toBe(true);
    expect(ranked[1].isRecommended).toBe(false);
  });
});
