/**
 * src/lib/exchange/tiered-sourcing-service.ts
 *
 * Tiered Sourcing & Intelligent Quotation Ranking Engine for Fleet360 Exchange.
 */

import { PartnerPerformanceTier } from '@prisma/client';

export const TIER_WEIGHT_MAP: Record<PartnerPerformanceTier, number> = {
  PLATINUM: 1.15,
  GOLD: 1.08,
  SILVER: 1.03,
  BRONZE: 1.0,
  STANDARD: 0.95,
};

export class TieredSourcingService {
  /**
   * Sort and rank partner quotations combining commercial price competitiveness with partner reliability tier
   */
  static rankQuotes(quotes: any[]) {
    if (!quotes || quotes.length === 0) return [];

    const minPrice = Math.min(...quotes.map((q) => Number(q.totalAmount)));

    return quotes
      .map((q) => {
        const tier = (q.partner?.scorecard?.tier as PartnerPerformanceTier) || PartnerPerformanceTier.STANDARD;
        const score = q.partner?.scorecard?.compositeScore || 75.0;
        const price = Number(q.totalAmount);

        // Price Score (0 - 100): Lower is better
        const priceScore = (minPrice / price) * 100;

        // Composite Recommendation Score: 50% Price + 50% Partner Performance Score
        const recommendationScore = Math.round((0.50 * priceScore + 0.50 * score) * 10) / 10;

        return {
          ...q,
          tier,
          score,
          recommendationScore,
          isRecommended: false,
        };
      })
      .sort((a, b) => b.recommendationScore - a.recommendationScore)
      .map((q, idx) => ({
        ...q,
        isRecommended: idx === 0,
      }));
  }
}
