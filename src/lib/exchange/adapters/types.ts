/**
 * src/lib/exchange/adapters/types.ts
 *
 * Phase 2.7: Canonical Multi-Domain Outsourcing Adapter Contract & Typed Domain Payloads.
 * Connects native Fleet360 operational domains into the canonical Exchange Core:
 * - PASSENGER_TRANSPORT (Bus Operations)
 * - FREIGHT (Freight & Logistics)
 * - RECOVERY (Recovery & Towing)
 * - LIMOUSINE (Limousine & Chauffeur)
 */

import { PartnerServiceDomain } from '@prisma/client';

export interface OutsourcingSource {
  domain: PartnerServiceDomain;
  sourceReferenceType: string; // TRIP_SCHEDULE, FREIGHT_SHIPMENT, BREAKDOWN_REPORT, LIMO_BOOKING
  sourceReferenceId: string;
  tenantId: string;
  pickupLocation: string;
  pickupLatitude?: number;
  pickupLongitude?: number;
  dropoffLocation: string;
  dropoffLatitude?: number;
  dropoffLongitude?: number;
  serviceDate: Date;
  pickupTime: string;
  specialInstructions?: string;
  domainPayload: Record<string, any>;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface DomainEligibilityCriteria {
  domain: PartnerServiceDomain;
  pickupCity: string;
  serviceDate: Date;
  domainPayload: Record<string, any>;
}

// -----------------------------------------------------------------------------
// Typed Domain Requirements Payloads
// -----------------------------------------------------------------------------

export interface BusRequirements {
  passengerSeats: number;
  busClass?: 'STANDARD_STAFF' | 'COACH_LUXURY' | 'MINI_COASTER' | 'VIP_SHUTTLE';
  luggageAllowed?: boolean;
}

export interface FreightRequirements {
  cargoType: string; // General, Palletized, FMCG, Cold Chain, Hazardous
  weightKg: number;
  volumeM3?: number;
  palletCount?: number;
  bodyType: 'BOX_TRUCK' | 'CURTAIN_SIDE' | 'FLATBED_TRAILER' | 'REEFER_COLD' | 'PICKUP_3T';
  temperatureControlled?: boolean;
  requiredTempCelsius?: number;
  hazmat?: boolean;
  tailLiftRequired?: boolean;
  customsOrPortPermit?: boolean;
}

export interface RecoveryRequirements {
  disabledVehicleType: string; // Sedan, 4x4 SUV, Light Truck, Heavy Bus, Construction
  disabledVehiclePlate?: string;
  recoveryType: 'FLATBED' | 'WHEEL_LIFT' | 'WINCH_OFFROAD' | 'HEAVY_CRANE';
  vehicleCondition: 'ROLLING' | 'STEERING_LOCKED' | 'SEVERELY_DAMAGED' | 'BASEMENT_PARKING';
  urgency: 'STANDARD' | 'URGENT' | 'EMERGENCY_HIGHWAY';
  destinationWorkshop: string;
}

export interface LimousineRequirements {
  luxuryClass: 'EXECUTIVE_SEDAN' | 'LUXURY_SEDAN' | 'PREMIUM_SUV' | 'LUXURY_VAN';
  passengerCount: number;
  luggageCount: number;
  serviceType: 'AIRPORT_TRANSFER' | 'HOURLY_CHAUFFEUR' | 'POINT_TO_POINT';
  flightNumber?: string;
  meetAndGreet?: boolean;
  waterAndWifiRequired?: boolean;
}

// -----------------------------------------------------------------------------
// Domain-Aware Execution Evidence
// -----------------------------------------------------------------------------

export interface DomainExecutionProof {
  domain: PartnerServiceDomain;
  // Passenger
  passengerCount?: number;
  supervisorSignature?: string;
  // Freight Proof of Delivery
  recipientName?: string;
  consigneeSignature?: string;
  cargoPhotos?: string[];
  packagesReceived?: number;
  // Recovery
  workshopRecipient?: string;
  damagedVehiclePhotos?: string[];
  // Limousine
  vipSignOff?: string;
  // Common
  gpsCoordinates?: { lat: number; lng: number };
  timestamp: Date;
  notes?: string;
}

// -----------------------------------------------------------------------------
// Canonical Outsourcing Source Adapter Interface
// -----------------------------------------------------------------------------

export interface OutsourcingSourceAdapter {
  domain: PartnerServiceDomain;

  getSourceReference(sourceReferenceId: string, tenantId: string): Promise<OutsourcingSource>;
  validateOutsource(source: OutsourcingSource): Promise<ValidationResult>;
  buildRequirementsPayload(source: OutsourcingSource): Promise<Record<string, any>>;
  buildEligibilityRequirements(source: OutsourcingSource): Promise<DomainEligibilityCriteria>;
  applyAward(award: any): Promise<void>;
  applyAssignment(assignment: any): Promise<void>;
  syncExecutionStatus(event: any): Promise<void>;
  handleCancellation(requestId: string, reason: string): Promise<void>;
}
