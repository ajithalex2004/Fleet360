/**
 * src/lib/exchange/scorecard-service.ts
 *
 * Partner Performance Scoring & KPI Evaluation Engine for Fleet360 Exchange.
 * Deterministic multi-factor scoring (0 - 100) and Tiered Classification.
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { PartnerPerformanceTier } from '@prisma/client';

export interface ScorecardEvaluationResult {
  partnerId: string;
  tier: PartnerPerformanceTier;
  compositeScore: number;
  onTimePerformance: number;
  quoteResponseRate: number;
  exceptionRate: number;
  disputeRate: number;
  podQualityRate: number;
  totalAwardedTrips: number;
  completedTrips: number;
  onTimeTrips: number;
  lateTrips: number;
  exceptionsCount: number;
  disputesCount: number;
}

export class ScorecardService {
  /**
   * Deterministic Tier calculation based on composite score, volume, and OTP
   */
  static calculateTier(score: number, completedTrips: number, otp: number): PartnerPerformanceTier {
    if (score >= 90 && otp >= 95 && completedTrips >= 50) return PartnerPerformanceTier.PLATINUM;
    if (score >= 80 && otp >= 90 && completedTrips >= 20) return PartnerPerformanceTier.GOLD;
    if (score >= 70 && otp >= 85 && completedTrips >= 10) return PartnerPerformanceTier.SILVER;
    if (score >= 60 && otp >= 75 && completedTrips >= 5) return PartnerPerformanceTier.BRONZE;
    return PartnerPerformanceTier.STANDARD;
  }

  /**
   * Evaluate and persist performance scorecard for a transport partner
   */
  static async evaluatePartnerScorecard(partnerId: string, tenantId?: string): Promise<ScorecardEvaluationResult> {
    const partner = await prisma.transportPartner.findUnique({
      where: { id: partnerId },
      include: {
        awards: {
          include: {
            assignment: {
              include: { pod: true, events: true },
            },
          },
        },
        exceptions: true,
        disputes: true,
        quotes: true,
        invitedRequests: true,
      },
    });

    if (!partner) throw new Error('Partner not found');

    const totalAwardedTrips = partner.awards.length;
    const completedAwards = partner.awards.filter(
      (a) => a.status === 'COMPLETED' || a.assignment?.completedAt != null
    );
    const completedTrips = completedAwards.length;

    // 1. On-Time Performance (OTP)
    let onTimeTrips = 0;
    let lateTrips = 0;

    for (const award of completedAwards) {
      const reachedAt = award.assignment?.reachedAt;
      const scheduledTime = award.request?.pickupTime;

      if (reachedAt && scheduledTime) {
        const [hour, min] = scheduledTime.split(':').map(Number);
        const sched = new Date(award.request.serviceDate);
        sched.setHours(hour || 6, min || 0, 0, 0);

        const delay = (new Date(reachedAt).getTime() - sched.getTime()) / (1000 * 60);
        if (delay <= 15) onTimeTrips++; // Grace period 15 mins
        else lateTrips++;
      } else {
        onTimeTrips++;
      }
    }

    const onTimePerformance = completedTrips > 0 ? (onTimeTrips / completedTrips) * 100 : 100.0;

    // 2. Proof of Delivery (POD) Quality Rate
    const validPods = completedAwards.filter((a) => a.assignment?.pod?.signatureUrl || a.assignment?.pod?.signedByName).length;
    const podQualityRate = completedTrips > 0 ? (validPods / completedTrips) * 100 : 100.0;

    // 3. Quote Responsiveness Rate
    const quotesInvited = partner.invitedRequests.length;
    const quotesSubmitted = partner.quotes.length;
    const quoteResponseRate = quotesInvited > 0 ? Math.min(100, (quotesSubmitted / quotesInvited) * 100) : 100.0;

    // 4. Exception Rate & Dispute Rate
    const exceptionsCount = partner.exceptions.length;
    const exceptionRate = completedTrips > 0 ? Math.min(100, (exceptionsCount / completedTrips) * 100) : 0.0;

    const disputesCount = partner.disputes.length;
    const disputeRate = totalAwardedTrips > 0 ? Math.min(100, (disputesCount / totalAwardedTrips) * 100) : 0.0;

    // 5. Multi-Factor Weighted Composite Score (0 - 100)
    // 40% OTP + 20% POD Quality + 15% Quote Response + 15% Reliability (100 - Exception Rate) + 10% Commercial (100 - Dispute Rate)
    const compositeScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          (0.40 * onTimePerformance +
            0.20 * podQualityRate +
            0.15 * quoteResponseRate +
            0.15 * (100 - exceptionRate) +
            0.10 * (100 - disputeRate)) *
            10
        ) / 10
      )
    );

    // 6. Assign Tier
    const tier = ScorecardService.calculateTier(compositeScore, completedTrips, onTimePerformance);

    // 7. Upsert Scorecard
    await prisma.partnerScorecard.upsert({
      where: { partnerId },
      update: {
        tier,
        compositeScore,
        onTimePerformance,
        quoteResponseRate,
        exceptionRate,
        disputeRate,
        podQualityRate,
        totalAwardedTrips,
        completedTrips,
        onTimeTrips,
        lateTrips,
        exceptionsCount,
        disputesCount,
        quotesSubmitted,
        quotesInvited,
        evaluatedAt: new Date(),
      },
      create: {
        partnerId,
        tenantId,
        tier,
        compositeScore,
        onTimePerformance,
        quoteResponseRate,
        exceptionRate,
        disputeRate,
        podQualityRate,
        totalAwardedTrips,
        completedTrips,
        onTimeTrips,
        lateTrips,
        exceptionsCount,
        disputesCount,
        quotesSubmitted,
        quotesInvited,
        evaluatedAt: new Date(),
      },
    });

    return {
      partnerId,
      tier,
      compositeScore,
      onTimePerformance,
      quoteResponseRate,
      exceptionRate,
      disputeRate,
      podQualityRate,
      totalAwardedTrips,
      completedTrips,
      onTimeTrips,
      lateTrips,
      exceptionsCount,
      disputesCount,
    };
  }

  /**
   * Fetch current partner scorecard
   */
  static async getPartnerScorecard(partnerId: string) {
    let scorecard = await prisma.partnerScorecard.findUnique({
      where: { partnerId },
      include: {
        partner: {
          select: { legalName: true, partnerCode: true, tradeName: true, operationalStatus: true },
        },
      },
    });

    if (!scorecard) {
      await ScorecardService.evaluatePartnerScorecard(partnerId);
      scorecard = await prisma.partnerScorecard.findUnique({
        where: { partnerId },
        include: {
          partner: {
            select: { legalName: true, partnerCode: true, tradeName: true, operationalStatus: true },
          },
        },
      });
    }

    return scorecard;
  }
}
