export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

export interface QuotationRequest {
  serviceType: string;
  vehicleCategory?: string;
  distanceKm?: number;
  durationMins?: number;
  salikTollsAed?: number;
  leaseDurationMonths?: number;
  paxCount?: number;
}

export interface QuotationResponse {
  baseFareAed: number;
  distanceChargeAed: number;
  salikTollsAed: number;
  subtotalAed: number;
  vatRatePercent: number;
  vatAmountAed: number;
  totalFareAed: number;
  currency: string;
  budgetThresholdAed: number;
  requiresEscalation: boolean;
  escalationReason?: string;
  rateCardBreakdown: {
    baseRate: number;
    perKmRate: number;
    appliedDistanceKm: number;
  };
}

export const SERVICE_BASE_RATES: Record<string, { base: number; perKm: number; threshold: number }> = {
  // Executive Chauffeur
  'EXECUTIVE_Luxury Sedan': { base: 180, perKm: 4.5, threshold: 800 },
  'EXECUTIVE_Business Sedan': { base: 120, perKm: 3.5, threshold: 600 },
  'EXECUTIVE_Luxury SUV': { base: 250, perKm: 5.5, threshold: 1000 },
  'EXECUTIVE_Executive Van (MPV)': { base: 220, perKm: 5.0, threshold: 900 },
  'EXECUTIVE_Stretch Limousine': { base: 450, perKm: 8.0, threshold: 1500 },
  'EXECUTIVE_DEFAULT': { base: 150, perKm: 4.0, threshold: 750 },

  // Rent-a-Car
  'RENTAL_Economy': { base: 90, perKm: 0.8, threshold: 500 },
  'RENTAL_Compact': { base: 110, perKm: 0.9, threshold: 550 },
  'RENTAL_Mid-Size': { base: 140, perKm: 1.0, threshold: 650 },
  'RENTAL_Full-Size': { base: 180, perKm: 1.2, threshold: 800 },
  'RENTAL_SUV': { base: 220, perKm: 1.3, threshold: 900 },
  'RENTAL_4x4': { base: 280, perKm: 1.6, threshold: 1200 },
  'RENTAL_DEFAULT': { base: 120, perKm: 1.0, threshold: 600 },

  // Logistics & Freight
  'LOGISTICS_1-Ton Courier Van': { base: 150, perKm: 3.0, threshold: 800 },
  'LOGISTICS_3-Ton Box Truck': { base: 250, perKm: 4.5, threshold: 1200 },
  'LOGISTICS_3-Ton Reefer (Cold-Chain)': { base: 350, perKm: 5.5, threshold: 1500 },
  'LOGISTICS_7-Ton Curtain Sider': { base: 500, perKm: 7.0, threshold: 2000 },
  'LOGISTICS_40ft Flatbed Trailer': { base: 850, perKm: 9.5, threshold: 3000 },
  'LOGISTICS_DEFAULT': { base: 250, perKm: 4.5, threshold: 1200 },

  // Staff Transport
  'STAFF_TRANSPORT_14-Seat Minibus': { base: 200, perKm: 3.5, threshold: 1000 },
  'STAFF_TRANSPORT_30-Seat Coaster': { base: 350, perKm: 5.0, threshold: 1500 },
  'STAFF_TRANSPORT_50-Seat Luxury Coach': { base: 600, perKm: 7.5, threshold: 2500 },
  'STAFF_TRANSPORT_DEFAULT': { base: 300, perKm: 4.5, threshold: 1200 },

  // School Bus
  'SCHOOL_BUS_DEFAULT': { base: 450, perKm: 0.0, threshold: 800 },

  // Leasing
  'LEASING_DEFAULT': { base: 2200, perKm: 0.0, threshold: 5000 },
};

export function calculateInstantQuotation(params: QuotationRequest): QuotationResponse {
  const service = (params.serviceType || 'RENTAL').toUpperCase();
  const category = params.vehicleCategory || '';
  const dist = Math.max(0, params.distanceKm || 0);
  const tolls = Math.max(0, params.salikTollsAed || 0);

  const lookupKey = `${service}_${category}`;
  const rateConfig =
    SERVICE_BASE_RATES[lookupKey] ||
    SERVICE_BASE_RATES[`${service}_DEFAULT`] ||
    { base: 100, perKm: 2.0, threshold: 1000 };

  const baseFare = rateConfig.base;
  const distanceCharge = Math.round(dist * rateConfig.perKm * 100) / 100;
  const subtotal = Math.round((baseFare + distanceCharge + tolls) * 100) / 100;
  const vatRate = 5.0; // UAE FTA standard VAT
  const vatAmount = Math.round(subtotal * 0.05 * 100) / 100;
  const totalFare = Math.round((subtotal + vatAmount) * 100) / 100;

  const threshold = rateConfig.threshold;
  const requiresEscalation = totalFare > threshold;
  const escalationReason = requiresEscalation
    ? `Total fare (AED ${totalFare}) exceeds standard departmental pre-approval policy cap (AED ${threshold}).`
    : undefined;

  return {
    baseFareAed: baseFare,
    distanceChargeAed: distanceCharge,
    salikTollsAed: tolls,
    subtotalAed: subtotal,
    vatRatePercent: vatRate,
    vatAmountAed: vatAmount,
    totalFareAed: totalFare,
    currency: 'AED',
    budgetThresholdAed: threshold,
    requiresEscalation,
    escalationReason,
    rateCardBreakdown: {
      baseRate: baseFare,
      perKmRate: rateConfig.perKm,
      appliedDistanceKm: dist,
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const body: QuotationRequest = await req.json();
    const quotation = calculateInstantQuotation(body);
    return NextResponse.json(quotation);
  } catch (err) {
    console.error('[api/booking-portal/quotation POST]', err);
    return NextResponse.json({ error: 'Failed to calculate quotation' }, { status: 400 });
  }
}
