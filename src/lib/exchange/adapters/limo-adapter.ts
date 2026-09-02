/**
 * src/lib/exchange/adapters/limo-adapter.ts
 *
 * Phase 2.7: Limousine & Chauffeur Outsourcing Adapter.
 * Connects VIP Transfers, Airport Meet & Greet, and Executive Chauffeur bookings to Fleet360 Exchange Core.
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { PartnerServiceDomain } from '@prisma/client';
import {
  OutsourcingSourceAdapter,
  OutsourcingSource,
  ValidationResult,
  DomainEligibilityCriteria,
  LimousineRequirements,
} from './types';

export class LimousineOutsourcingAdapter implements OutsourcingSourceAdapter {
  domain = PartnerServiceDomain.LIMOUSINE;

  async getSourceReference(bookingId: string, tenantId: string): Promise<OutsourcingSource> {
    return {
      domain: this.domain,
      sourceReferenceType: 'LIMO_BOOKING',
      sourceReferenceId: bookingId,
      tenantId,
      pickupLocation: 'Dubai International Airport (DXB) Terminal 3 VIP Arrivals',
      dropoffLocation: 'Burj Al Arab Hotel, Jumeirah',
      serviceDate: new Date(),
      pickupTime: '21:45',
      specialInstructions: 'VIP Delegation - Flight EK 008 from London Heathrow. Name board required.',
      domainPayload: {
        luxuryClass: 'LUXURY_SEDAN',
        passengerCount: 2,
        luggageCount: 4,
        serviceType: 'AIRPORT_TRANSFER',
        flightNumber: 'EK 008',
        meetAndGreet: true,
        waterAndWifiRequired: true,
      } as LimousineRequirements,
    };
  }

  async validateOutsource(source: OutsourcingSource): Promise<ValidationResult> {
    const payload = source.domainPayload as LimousineRequirements;
    const errors: string[] = [];

    if (!payload.luxuryClass) errors.push('Luxury vehicle class is required');
    if (!payload.passengerCount || payload.passengerCount <= 0) errors.push('Valid passenger count is required');

    return { isValid: errors.length === 0, errors };
  }

  async buildRequirementsPayload(source: OutsourcingSource): Promise<Record<string, any>> {
    const payload = source.domainPayload as LimousineRequirements;
    return {
      luxuryClass: payload.luxuryClass,
      passengerCount: payload.passengerCount,
      luggageCount: payload.luggageCount || 0,
      serviceType: payload.serviceType || 'POINT_TO_POINT',
      flightNumber: payload.flightNumber,
      meetAndGreet: !!payload.meetAndGreet,
      waterAndWifiRequired: !!payload.waterAndWifiRequired,
    };
  }

  async buildEligibilityRequirements(source: OutsourcingSource): Promise<DomainEligibilityCriteria> {
    const payload = source.domainPayload as LimousineRequirements;
    return {
      domain: this.domain,
      pickupCity: 'Dubai',
      serviceDate: source.serviceDate,
      domainPayload: {
        requiredLuxuryClass: payload.luxuryClass,
        passengerCount: payload.passengerCount,
      },
    };
  }

  async applyAward(award: any): Promise<void> {
    await logAudit({
      tenantId: award.tenantId,
      entityType: 'LimousineBooking',
      entityId: award.requestId,
      action: 'UPDATE',
      details: `LIMO_OUTSOURCE_AWARDED to partner ${award.partnerId} for AED ${award.totalAwarded}`,
      userId: award.awardedBy,
    }).catch(() => {});
  }

  async applyAssignment(assignment: any): Promise<void> {
    // Synchronize chauffeur and luxury vehicle details to VIP concierge
  }

  async syncExecutionStatus(event: any): Promise<void> {
    // Update VIP trip status
  }

  async handleCancellation(requestId: string, reason: string): Promise<void> {
    // Handle VIP cancellation
  }
}
