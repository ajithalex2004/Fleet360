/**
 * src/lib/exchange/disclosure-service.ts
 *
 * Phase 3.5: Staged Information Disclosure Engine for Fleet360 Marketplace.
 * Enforces data sanitization before award and operational reveal after award.
 */

import { PartnerServiceDomain } from '@prisma/client';

export type DisclosureStage = 'PRE_QUOTE' | 'POST_AWARD' | 'EXECUTION';

export class DisclosurePolicyService {
  /**
   * Sanitizes requirements into pre-award disclosure payload for marketplace discovery.
   * Conceals customer names, phone numbers, VIP identity, and confidential commercial data.
   */
  static buildSanitizedDisclosure(
    domain: PartnerServiceDomain,
    pickupLocation: string,
    dropoffLocation: string,
    serviceDate: Date,
    pickupTime: string,
    requirementsPayload: Record<string, any>
  ): Record<string, any> {
    // City / Area extraction
    const pickupZone = pickupLocation.split(',')[0] || pickupLocation;
    const dropoffZone = dropoffLocation.split(',')[0] || dropoffLocation;

    const baseDisclosure = {
      pickupZone,
      dropoffZone,
      serviceDate: new Date(serviceDate).toISOString().slice(0, 10),
      pickupTime,
    };

    switch (domain) {
      case PartnerServiceDomain.PASSENGER_TRANSPORT:
        return {
          ...baseDisclosure,
          domain: 'PASSENGER_TRANSPORT',
          passengerSeats: requirementsPayload.passengerSeats || 50,
          busClass: requirementsPayload.busClass || 'STANDARD_STAFF',
          serviceType: 'Staff Transportation',
        };

      case PartnerServiceDomain.FREIGHT:
        return {
          ...baseDisclosure,
          domain: 'FREIGHT',
          cargoType: requirementsPayload.cargoType || 'General Freight',
          weightKg: requirementsPayload.weightKg,
          volumeM3: requirementsPayload.volumeM3,
          palletCount: requirementsPayload.palletCount,
          bodyType: requirementsPayload.bodyType,
          temperatureControlled: !!requirementsPayload.temperatureControlled,
          requiredTempCelsius: requirementsPayload.requiredTempCelsius,
          hazmat: !!requirementsPayload.hazmat,
          tailLiftRequired: !!requirementsPayload.tailLiftRequired,
        };

      case PartnerServiceDomain.RECOVERY:
        // Recovery requires accurate pickup area for ETA calculation
        return {
          ...baseDisclosure,
          domain: 'RECOVERY',
          disabledVehicleType: requirementsPayload.disabledVehicleType,
          recoveryType: requirementsPayload.recoveryType,
          vehicleCondition: requirementsPayload.vehicleCondition,
          urgency: requirementsPayload.urgency,
          destinationWorkshopArea: dropoffZone,
        };

      case PartnerServiceDomain.LIMOUSINE:
        return {
          ...baseDisclosure,
          domain: 'LIMOUSINE',
          luxuryClass: requirementsPayload.luxuryClass,
          passengerCount: requirementsPayload.passengerCount,
          luggageCount: requirementsPayload.luggageCount,
          serviceType: requirementsPayload.serviceType,
          meetAndGreet: !!requirementsPayload.meetAndGreet,
          // Conceal VIP identity & flight booking contact
          isVipSanitized: true,
        };

      default:
        return baseDisclosure;
    }
  }

  /**
   * Generates full operational dispatch details after award.
   */
  static buildPostAwardDisclosure(
    domain: PartnerServiceDomain,
    pickupLocation: string,
    dropoffLocation: string,
    requirementsPayload: Record<string, any>,
    specialInstructions?: string
  ): Record<string, any> {
    return {
      domain,
      fullPickupAddress: pickupLocation,
      fullDropoffAddress: dropoffLocation,
      specialInstructions,
      requirements: requirementsPayload,
      disclosedAt: new Date().toISOString(),
    };
  }
}
