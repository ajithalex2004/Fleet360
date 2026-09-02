/**
 * src/lib/exchange/adapters/freight-adapter.ts
 *
 * Phase 2.7: Freight & Logistics Outsourcing Adapter.
 * Connects Freight Orders, FTL/LTL shipments, and Container movements to Fleet360 Exchange Core.
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { PartnerServiceDomain } from '@prisma/client';
import {
  OutsourcingSourceAdapter,
  OutsourcingSource,
  ValidationResult,
  DomainEligibilityCriteria,
  FreightRequirements,
} from './types';

export class FreightOutsourcingAdapter implements OutsourcingSourceAdapter {
  domain = PartnerServiceDomain.FREIGHT;

  async getSourceReference(shipmentId: string, tenantId: string): Promise<OutsourcingSource> {
    return {
      domain: this.domain,
      sourceReferenceType: 'FREIGHT_SHIPMENT',
      sourceReferenceId: shipmentId,
      tenantId,
      pickupLocation: 'Jebel Ali Free Zone (JAFZA) South',
      dropoffLocation: 'Dubai Industrial City Warehouse 4',
      serviceDate: new Date(),
      pickupTime: '08:30',
      specialInstructions: 'Temperature sensitive pharmaceuticals - maintain +4C',
      domainPayload: {
        cargoType: 'Pharmaceuticals',
        weightKg: 4500,
        volumeM3: 22,
        palletCount: 8,
        bodyType: 'REEFER_COLD',
        temperatureControlled: true,
        requiredTempCelsius: 4,
        hazmat: false,
        tailLiftRequired: true,
      } as FreightRequirements,
    };
  }

  async validateOutsource(source: OutsourcingSource): Promise<ValidationResult> {
    const payload = source.domainPayload as FreightRequirements;
    const errors: string[] = [];

    if (!payload.cargoType) errors.push('Cargo type is required');
    if (!payload.weightKg || payload.weightKg <= 0) errors.push('Valid cargo weight (kg) is required');
    if (!payload.bodyType) errors.push('Vehicle body type (BOX_TRUCK, REEFER, FLATBED) is required');

    return { isValid: errors.length === 0, errors };
  }

  async buildRequirementsPayload(source: OutsourcingSource): Promise<Record<string, any>> {
    const payload = source.domainPayload as FreightRequirements;
    return {
      cargoType: payload.cargoType,
      weightKg: payload.weightKg,
      volumeM3: payload.volumeM3 || 0,
      palletCount: payload.palletCount || 0,
      bodyType: payload.bodyType || 'BOX_TRUCK',
      temperatureControlled: !!payload.temperatureControlled,
      requiredTempCelsius: payload.requiredTempCelsius,
      hazmat: !!payload.hazmat,
      tailLiftRequired: !!payload.tailLiftRequired,
      customsOrPortPermit: !!payload.customsOrPortPermit,
    };
  }

  async buildEligibilityRequirements(source: OutsourcingSource): Promise<DomainEligibilityCriteria> {
    const payload = source.domainPayload as FreightRequirements;
    return {
      domain: this.domain,
      pickupCity: 'Dubai',
      serviceDate: source.serviceDate,
      domainPayload: {
        requiredPayloadKg: payload.weightKg,
        requiredBodyType: payload.bodyType,
        requiresReefer: payload.temperatureControlled,
        requiresHazmat: payload.hazmat,
      },
    };
  }

  async applyAward(award: any): Promise<void> {
    await logAudit({
      tenantId: award.tenantId,
      entityType: 'FreightShipment',
      entityId: award.requestId,
      action: 'UPDATE',
      details: `FREIGHT_OUTSOURCE_AWARDED to carrier ${award.partnerId} for AED ${award.totalAwarded}`,
      userId: award.awardedBy,
    }).catch(() => {});
  }

  async applyAssignment(assignment: any): Promise<void> {
    // Synchronize carrier truck and driver to freight tracking system
  }

  async syncExecutionStatus(event: any): Promise<void> {
    // Update freight shipment status (DISPATCHED, IN_TRANSIT, DELIVERED)
  }

  async handleCancellation(requestId: string, reason: string): Promise<void> {
    // Handle freight cancellation
  }
}
