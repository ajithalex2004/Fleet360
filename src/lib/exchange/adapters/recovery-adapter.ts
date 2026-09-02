/**
 * src/lib/exchange/adapters/recovery-adapter.ts
 *
 * Phase 2.7: Recovery & Towing Outsourcing Adapter.
 * Connects Roadside Assistance, Vehicle Breakdowns, and Accident Towing to Fleet360 Exchange Core.
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { PartnerServiceDomain } from '@prisma/client';
import {
  OutsourcingSourceAdapter,
  OutsourcingSource,
  ValidationResult,
  DomainEligibilityCriteria,
  RecoveryRequirements,
} from './types';

export class RecoveryOutsourcingAdapter implements OutsourcingSourceAdapter {
  domain = PartnerServiceDomain.RECOVERY;

  async getSourceReference(breakdownId: string, tenantId: string): Promise<OutsourcingSource> {
    return {
      domain: this.domain,
      sourceReferenceType: 'BREAKDOWN_REPORT',
      sourceReferenceId: breakdownId,
      tenantId,
      pickupLocation: 'Sheikh Mohammed Bin Zayed Road (E311) Near Global Village',
      dropoffLocation: 'Al Quoz Auto Central Workshop 12',
      serviceDate: new Date(),
      pickupTime: 'Immediate Dispatch',
      specialInstructions: 'Vehicle steering locked after collision. Flatbed with winch required.',
      domainPayload: {
        disabledVehicleType: 'Toyota Land Cruiser (SUV)',
        disabledVehiclePlate: 'Dubai X 44102',
        recoveryType: 'FLATBED',
        vehicleCondition: 'STEERING_LOCKED',
        urgency: 'EMERGENCY_HIGHWAY',
        destinationWorkshop: 'Al Quoz Central Workshop',
      } as RecoveryRequirements,
    };
  }

  async validateOutsource(source: OutsourcingSource): Promise<ValidationResult> {
    const payload = source.domainPayload as RecoveryRequirements;
    const errors: string[] = [];

    if (!payload.disabledVehicleType) errors.push('Disabled vehicle type is required');
    if (!payload.recoveryType) errors.push('Recovery equipment type (FLATBED, WHEEL_LIFT, WINCH) is required');
    if (!payload.destinationWorkshop) errors.push('Destination workshop is required');

    return { isValid: errors.length === 0, errors };
  }

  async buildRequirementsPayload(source: OutsourcingSource): Promise<Record<string, any>> {
    const payload = source.domainPayload as RecoveryRequirements;
    return {
      disabledVehicleType: payload.disabledVehicleType,
      disabledVehiclePlate: payload.disabledVehiclePlate,
      recoveryType: payload.recoveryType,
      vehicleCondition: payload.vehicleCondition || 'ROLLING',
      urgency: payload.urgency || 'STANDARD',
      destinationWorkshop: payload.destinationWorkshop,
    };
  }

  async buildEligibilityRequirements(source: OutsourcingSource): Promise<DomainEligibilityCriteria> {
    const payload = source.domainPayload as RecoveryRequirements;
    return {
      domain: this.domain,
      pickupCity: 'Dubai',
      serviceDate: source.serviceDate,
      domainPayload: {
        requiredRecoveryType: payload.recoveryType,
        urgency: payload.urgency,
      },
    };
  }

  async applyAward(award: any): Promise<void> {
    await logAudit({
      tenantId: award.tenantId,
      entityType: 'BreakdownReport',
      entityId: award.requestId,
      action: 'UPDATE',
      details: `RECOVERY_OUTSOURCE_AWARDED to partner ${award.partnerId} for AED ${award.totalAwarded}`,
      userId: award.awardedBy,
    }).catch(() => {});
  }

  async applyAssignment(assignment: any): Promise<void> {
    // Notify breakdown ticket of assigned flatbed truck & operator
  }

  async syncExecutionStatus(event: any): Promise<void> {
    // Synchronize recovery milestone: REACHED_SCENE, LOADED, DELIVERED_TO_WORKSHOP
  }

  async handleCancellation(requestId: string, reason: string): Promise<void> {
    // Handle roadside cancellation
  }
}
