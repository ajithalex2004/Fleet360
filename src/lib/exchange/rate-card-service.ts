/**
 * src/lib/exchange/rate-card-service.ts
 *
 * Contracted Rate Card Auto-Pricing & Immutable Versioned Commercial Engine
 * for Fleet360 Operations & Exchange (Phase 1 P0).
 *
 * Capabilities:
 * - Zone-based pricing matrices (e.g., Dubai -> JAFZA, Abu Dhabi -> Mussafah by vehicle category)
 * - Versioned validity windows (effectiveFrom / effectiveTo)
 * - Ancillary charge rules (waitingFeePerHour, freeWaitingMinutes, overtimeRatePerHour,
 *   cancellationFeePct, tollTreatment, fuelSurchargePct, reeferSurcharge, crossBorderFee)
 * - Cryptographic SHA-256 RateCardSnapshot frozen inside OutsourceAward.commercialSnapshot
 */

import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { PartnerServiceDomain } from '@prisma/client';

export type PricingUnit = 'PER_TRIP' | 'PER_HOUR' | 'PER_KM' | 'PER_TONNE' | 'PER_DAY';
export type TollTreatment = 'INCLUDED' | 'ACTUAL' | 'CAPPED';

export interface RateCardAncillaryCharges {
  waitingFeePerHour: number;
  freeWaitingMinutes: number;
  overtimeRatePerHour?: number;
  cancellationFeePct?: number;
  tollTreatment: TollTreatment;
  tollCapAmount?: number;
  fuelSurchargePct?: number;
  reeferSurcharge?: number;
  crossBorderFee?: number;
}

export interface RateCardVersion {
  rateCardId: string;
  version: number;
  effectiveFrom: string; // ISO date
  effectiveTo?: string | null;
  pricingUnit: PricingUnit;
  baseRate: number;
  minimumCharge: number;
  currency: string;
  originZone?: string | null;
  destinationZone?: string | null;
  vehicleType?: string;
  ancillaryCharges: RateCardAncillaryCharges;
}

export interface RateCardSnapshot extends RateCardVersion {
  snapshotTakenAt: string;
  snapshotHash: string;
}

export const DEFAULT_ANCILLARY_CHARGES: RateCardAncillaryCharges = {
  waitingFeePerHour: 100,
  freeWaitingMinutes: 30,
  overtimeRatePerHour: 120,
  cancellationFeePct: 25,
  tollTreatment: 'ACTUAL',
  fuelSurchargePct: 0,
  reeferSurcharge: 0,
  crossBorderFee: 0,
};

export interface RateCardLookupInput {
  tenantId: string;
  partnerId: string;
  domain?: PartnerServiceDomain;
  originLocation?: string;
  destinationLocation?: string;
  vehicleType?: string;
  requiredCapacity?: number;
  serviceDate?: Date | string;
}

export interface RateCardLookupResult {
  found: boolean;
  rateCardId?: string;
  version?: number;
  title?: string;
  baseAmount: number;
  vatAmount: number;
  totalAmount: number;
  currency: string;
  unitType: string;
  originZone?: string | null;
  destinationZone?: string | null;
  vehicleType?: string;
  ancillaryCharges?: RateCardAncillaryCharges;
  rateCardSnapshot?: RateCardSnapshot;
}

export class RateCardService {
  /**
   * Compute a deterministic SHA-256 hash over the immutable rate card version fields
   */
  static computeSnapshotHash(versionPayload: RateCardVersion): string {
    const canonical = JSON.stringify({
      rateCardId: versionPayload.rateCardId,
      version: versionPayload.version,
      effectiveFrom: versionPayload.effectiveFrom,
      effectiveTo: versionPayload.effectiveTo ?? null,
      pricingUnit: versionPayload.pricingUnit,
      baseRate: Number(versionPayload.baseRate),
      minimumCharge: Number(versionPayload.minimumCharge),
      currency: versionPayload.currency,
      originZone: versionPayload.originZone ?? null,
      destinationZone: versionPayload.destinationZone ?? null,
      vehicleType: versionPayload.vehicleType ?? null,
      ancillaryCharges: {
        waitingFeePerHour: Number(versionPayload.ancillaryCharges.waitingFeePerHour),
        freeWaitingMinutes: Number(versionPayload.ancillaryCharges.freeWaitingMinutes),
        overtimeRatePerHour: versionPayload.ancillaryCharges.overtimeRatePerHour ?? null,
        cancellationFeePct: versionPayload.ancillaryCharges.cancellationFeePct ?? null,
        tollTreatment: versionPayload.ancillaryCharges.tollTreatment,
        tollCapAmount: versionPayload.ancillaryCharges.tollCapAmount ?? null,
        fuelSurchargePct: versionPayload.ancillaryCharges.fuelSurchargePct ?? 0,
        reeferSurcharge: versionPayload.ancillaryCharges.reeferSurcharge ?? 0,
        crossBorderFee: versionPayload.ancillaryCharges.crossBorderFee ?? 0,
      },
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Verify that a stored RateCardSnapshot has not been tampered with after award
   */
  static verifySnapshotIntegrity(snapshot: RateCardSnapshot): boolean {
    if (!snapshot || !snapshot.snapshotHash) return false;
    const expectedHash = this.computeSnapshotHash(snapshot);
    return expectedHash === snapshot.snapshotHash;
  }

  /**
   * Calculate contracted Fuel Surcharge Indexation allowance from baseRate and fuelSurchargePct
   */
  static calculateFuelSurchargeAllowance(
    baseRate: number,
    fuelSurchargePct?: number
  ): {
    fuelSurchargePct: number;
    baseSurcharge: number;
    vatAmount: number;
    totalWithVat: number;
  } {
    const pct = Math.max(0, Number(fuelSurchargePct || 0));
    const baseSurcharge = Math.round(Number(baseRate || 0) * (pct / 100) * 100) / 100;
    const vatAmount = Math.round(baseSurcharge * 0.05 * 100) / 100;
    const totalWithVat = Math.round((baseSurcharge + vatAmount) * 100) / 100;
    return {
      fuelSurchargePct: pct,
      baseSurcharge,
      vatAmount,
      totalWithVat,
    };
  }

  /**
   * Construct an immutable, SHA-256 signed RateCardSnapshot for freezing into OutsourceAward.commercialSnapshot
   */
  static buildImmutableRateCardSnapshot(input: {
    rateCardId: string;
    version?: number;
    effectiveFrom?: Date | string;
    effectiveTo?: Date | string | null;
    pricingUnit?: PricingUnit | string;
    baseRate: number;
    minimumCharge?: number;
    currency?: string;
    originZone?: string | null;
    destinationZone?: string | null;
    vehicleType?: string;
    ancillaryCharges?: Partial<RateCardAncillaryCharges>;
    snapshotTakenAt?: Date | string;
  }): RateCardSnapshot {
    const ancillaryCharges: RateCardAncillaryCharges = {
      ...DEFAULT_ANCILLARY_CHARGES,
      ...(input.ancillaryCharges || {}),
    };
    const versionPayload: RateCardVersion = {
      rateCardId: input.rateCardId,
      version: input.version ?? 1,
      effectiveFrom: input.effectiveFrom
        ? new Date(input.effectiveFrom).toISOString()
        : new Date(0).toISOString(),
      effectiveTo: input.effectiveTo ? new Date(input.effectiveTo).toISOString() : null,
      pricingUnit: (input.pricingUnit as PricingUnit) || 'PER_TRIP',
      baseRate: Number(input.baseRate),
      minimumCharge: input.minimumCharge != null ? Number(input.minimumCharge) : Number(input.baseRate),
      currency: input.currency || 'AED',
      originZone: input.originZone ?? null,
      destinationZone: input.destinationZone ?? null,
      vehicleType: input.vehicleType,
      ancillaryCharges,
    };

    const snapshotHash = this.computeSnapshotHash(versionPayload);
    return {
      ...versionPayload,
      snapshotTakenAt: input.snapshotTakenAt
        ? new Date(input.snapshotTakenAt).toISOString()
        : new Date().toISOString(),
      snapshotHash,
    };
  }

  /**
   * Look up contracted rate for a given partner, route corridor, and vehicle category
   */
  static async lookupContractRate(input: RateCardLookupInput): Promise<RateCardLookupResult> {
    const domain = input.domain || PartnerServiceDomain.PASSENGER_TRANSPORT;
    const origin = (input.originLocation || '').toLowerCase().trim();
    const destination = (input.destinationLocation || '').toLowerCase().trim();
    const targetDate = input.serviceDate ? new Date(input.serviceDate) : new Date();

    // Find rate cards for this tenant and partner
    const rateCards = await prisma.partnerRateCard.findMany({
      where: {
        tenantId: input.tenantId,
        partnerId: input.partnerId,
        domain,
      },
    });

    if (rateCards.length === 0) {
      return {
        found: false,
        baseAmount: 0,
        vatAmount: 0,
        totalAmount: 0,
        currency: 'AED',
        unitType: 'PER_TRIP',
      };
    }

    // Filter by validity window when effectiveFrom / effectiveTo metadata is present
    const activeCards = rateCards.filter((card) => {
      const rec = card as Record<string, unknown>;
      if (rec.isActive === false) return false;
      if (rec.effectiveFrom && new Date(String(rec.effectiveFrom)) > targetDate) return false;
      if (rec.effectiveTo && new Date(String(rec.effectiveTo)) < targetDate) return false;
      return true;
    });

    const candidateCards = activeCards.length > 0 ? activeCards : rateCards;

    // 1. Exact or Partial Zone Matching
    let matchedCard = candidateCards.find((card) => {
      const cardOrigin = (card.originZone || '').toLowerCase().trim();
      const cardDest = (card.destinationZone || '').toLowerCase().trim();

      const originMatch = !cardOrigin || origin.includes(cardOrigin) || cardOrigin.includes(origin);
      const destMatch = !cardDest || destination.includes(cardDest) || cardDest.includes(destination);
      const vehicleMatch = !input.vehicleType || !card.vehicleType || card.vehicleType.toLowerCase().includes(input.vehicleType.toLowerCase());

      return originMatch && destMatch && vehicleMatch;
    });

    // 2. Fallback to general vehicle type rate card if specific zone is not matched
    if (!matchedCard) {
      matchedCard = candidateCards.find((card) => {
        return !card.originZone && !card.destinationZone;
      }) || candidateCards[0];
    }

    if (!matchedCard) {
      return {
        found: false,
        baseAmount: 0,
        vatAmount: 0,
        totalAmount: 0,
        currency: 'AED',
        unitType: 'PER_TRIP',
      };
    }

    const baseAmount = Number(matchedCard.rateAmount);
    const vatAmount = baseAmount * 0.05; // 5% UAE VAT
    const totalAmount = baseAmount + vatAmount;
    const cardExtra = matchedCard as Record<string, unknown>;
    const version = typeof cardExtra.version === 'number' ? cardExtra.version : 1;
    const ancillary = (cardExtra.ancillaryCharges as Partial<RateCardAncillaryCharges> | undefined) || {};

    const rateCardSnapshot = this.buildImmutableRateCardSnapshot({
      rateCardId: matchedCard.id,
      version,
      effectiveFrom: (cardExtra.effectiveFrom as Date | string | undefined) || matchedCard.createdAt,
      effectiveTo: (cardExtra.effectiveTo as Date | string | null | undefined) ?? null,
      pricingUnit: (matchedCard.unitType as PricingUnit) || 'PER_TRIP',
      baseRate: baseAmount,
      minimumCharge: typeof cardExtra.minimumCharge === 'number' ? cardExtra.minimumCharge : baseAmount,
      currency: matchedCard.currency || 'AED',
      originZone: matchedCard.originZone,
      destinationZone: matchedCard.destinationZone,
      vehicleType: matchedCard.vehicleType,
      ancillaryCharges: ancillary,
    });

    return {
      found: true,
      rateCardId: matchedCard.id,
      version,
      title: matchedCard.title,
      baseAmount,
      vatAmount,
      totalAmount,
      currency: matchedCard.currency || 'AED',
      unitType: matchedCard.unitType || 'PER_TRIP',
      originZone: matchedCard.originZone,
      destinationZone: matchedCard.destinationZone,
      vehicleType: matchedCard.vehicleType,
      ancillaryCharges: rateCardSnapshot.ancillaryCharges,
      rateCardSnapshot,
    };
  }

  /**
   * Create or update a contracted rate card
   */
  static async createRateCard(input: {
    tenantId: string;
    partnerId: string;
    title: string;
    domain?: PartnerServiceDomain;
    vehicleType: string;
    originZone?: string;
    destinationZone?: string;
    rateAmount: number;
    currency?: string;
    unitType?: string;
  }) {
    return prisma.partnerRateCard.create({
      data: {
        tenantId: input.tenantId,
        partnerId: input.partnerId,
        title: input.title,
        domain: input.domain || PartnerServiceDomain.PASSENGER_TRANSPORT,
        vehicleType: input.vehicleType,
        originZone: input.originZone,
        destinationZone: input.destinationZone,
        rateAmount: input.rateAmount,
        currency: input.currency || 'AED',
        unitType: input.unitType || 'PER_TRIP',
      },
    });
  }
}
