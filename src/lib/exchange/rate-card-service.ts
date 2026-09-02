/**
 * src/lib/exchange/rate-card-service.ts
 *
 * Contracted Rate Card Auto-Pricing Engine for Fleet360 Operations & Exchange.
 * Enables zone-based pricing matrices (e.g., Dubai -> JAFZA, Abu Dhabi -> Mussafah by vehicle category)
 * and automatic price calculation on contracted outsource requests.
 */

import { prisma } from '@/lib/prisma';
import { PartnerServiceDomain } from '@prisma/client';

export interface RateCardLookupInput {
  tenantId: string;
  partnerId: string;
  domain?: PartnerServiceDomain;
  originLocation?: string;
  destinationLocation?: string;
  vehicleType?: string;
  requiredCapacity?: number;
}

export interface RateCardLookupResult {
  found: boolean;
  rateCardId?: string;
  title?: string;
  baseAmount: number;
  vatAmount: number;
  totalAmount: number;
  currency: string;
  unitType: string;
  originZone?: string | null;
  destinationZone?: string | null;
  vehicleType?: string;
}

export class RateCardService {
  /**
   * Look up contracted rate for a given partner, route corridor, and vehicle category
   */
  static async lookupContractRate(input: RateCardLookupInput): Promise<RateCardLookupResult> {
    const domain = input.domain || PartnerServiceDomain.PASSENGER_TRANSPORT;
    const origin = (input.originLocation || '').toLowerCase().trim();
    const destination = (input.destinationLocation || '').toLowerCase().trim();

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

    // 1. Exact or Partial Zone Matching
    let matchedCard = rateCards.find((card) => {
      const cardOrigin = (card.originZone || '').toLowerCase().trim();
      const cardDest = (card.destinationZone || '').toLowerCase().trim();

      const originMatch = !cardOrigin || origin.includes(cardOrigin) || cardOrigin.includes(origin);
      const destMatch = !cardDest || destination.includes(cardDest) || cardDest.includes(destination);
      const vehicleMatch = !input.vehicleType || !card.vehicleType || card.vehicleType.toLowerCase().includes(input.vehicleType.toLowerCase());

      return originMatch && destMatch && vehicleMatch;
    });

    // 2. Fallback to general vehicle type rate card if specific zone is not matched
    if (!matchedCard) {
      matchedCard = rateCards.find((card) => {
        return !card.originZone && !card.destinationZone;
      }) || rateCards[0];
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

    return {
      found: true,
      rateCardId: matchedCard.id,
      title: matchedCard.title,
      baseAmount,
      vatAmount,
      totalAmount,
      currency: matchedCard.currency || 'AED',
      unitType: matchedCard.unitType || 'PER_TRIP',
      originZone: matchedCard.originZone,
      destinationZone: matchedCard.destinationZone,
      vehicleType: matchedCard.vehicleType,
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
