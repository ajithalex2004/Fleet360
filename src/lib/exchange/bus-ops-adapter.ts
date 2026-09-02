/**
 * src/lib/exchange/bus-ops-adapter.ts
 *
 * Bus Ops (Passenger Transport / TripSchedule) Canonical Outsourcing Adapter.
 * Bridges native TripSchedule records with Fleet360 Exchange Core.
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { PartnerServiceDomain } from '@prisma/client';
import {
  OutsourcingSourceAdapter,
  OutsourcingSource,
  ValidationResult,
  DomainEligibilityCriteria,
  BusRequirements,
} from './adapters/types';

export class BusOpsOutsourcingAdapter implements OutsourcingSourceAdapter {
  domain = PartnerServiceDomain.PASSENGER_TRANSPORT;

  async getSourceReference(tripId: string, tenantId: string): Promise<OutsourcingSource> {
    const trip = await prisma.tripSchedule.findUnique({
      where: { id: tripId, tenantId, deletedAt: null },
      include: { route: true },
    });

    if (!trip) throw new Error(`Trip schedule ${tripId} not found`);

    return {
      domain: this.domain,
      sourceReferenceType: 'TRIP_SCHEDULE',
      sourceReferenceId: trip.id,
      tenantId: trip.tenantId,
      pickupLocation: trip.route?.pickupLocation || 'Dubai Hub',
      dropoffLocation: trip.route?.dropoffLocation || 'Destination Site',
      serviceDate: new Date(trip.serviceDate),
      pickupTime: trip.departureTime || '07:00',
      specialInstructions: trip.notes || undefined,
      domainPayload: {
        passengerSeats: trip.capacity || 50,
        busClass: 'STANDARD_STAFF',
      } as BusRequirements,
    };
  }

  async validateOutsource(source: OutsourcingSource): Promise<ValidationResult> {
    const trip = await prisma.tripSchedule.findUnique({
      where: { id: source.sourceReferenceId, tenantId: source.tenantId, deletedAt: null },
    });

    if (!trip) return { isValid: false, errors: ['Trip schedule not found'] };
    if (trip.status === 'CANCELLED' || trip.status === 'COMPLETED') {
      return { isValid: false, errors: [`Trip is already ${trip.status}`] };
    }

    return { isValid: true, errors: [] };
  }

  async buildRequirementsPayload(source: OutsourcingSource): Promise<Record<string, any>> {
    return {
      passengerSeats: source.domainPayload.passengerSeats || 50,
      busClass: source.domainPayload.busClass || 'STANDARD_STAFF',
      luggageAllowed: source.domainPayload.luggageAllowed ?? false,
    };
  }

  async buildEligibilityRequirements(source: OutsourcingSource): Promise<DomainEligibilityCriteria> {
    return {
      domain: this.domain,
      pickupCity: 'Dubai',
      serviceDate: source.serviceDate,
      domainPayload: {
        requiredCapacity: source.domainPayload.passengerSeats || 50,
      },
    };
  }

  async applyAward(award: any): Promise<void> {
    const tripId = award.request?.sourceReferenceId || award.sourceReferenceId;
    if (!tripId) return;

    await prisma.tripSchedule.updateMany({
      where: { id: tripId, tenantId: award.tenantId },
      data: { status: 'ASSIGNED', updatedAt: new Date() },
    });

    await logAudit({
      tenantId: award.tenantId,
      entityType: 'TripSchedule',
      entityId: tripId,
      action: 'UPDATE',
      details: `OUTSOURCE_AWARDED to partner ${award.partnerId} for AED ${award.totalAwarded}`,
      userId: award.awardedBy,
    }).catch(() => {});
  }

  async applyAssignment(assignment: any): Promise<void> {
    // Synchronize assigned driver info if needed
  }

  async syncExecutionStatus(event: any): Promise<void> {
    const tripId = event.sourceReferenceId;
    if (!tripId) return;

    const status = event.eventType;
    const now = new Date();
    const updateData: any = { updatedAt: now };

    if (status === 'STARTED') {
      updateData.status = 'IN_PROGRESS';
      updateData.actualDeparture = now.toTimeString().slice(0, 5);
    } else if (status === 'COMPLETED') {
      updateData.status = 'COMPLETED';
      updateData.actualArrival = now.toTimeString().slice(0, 5);
    }

    await prisma.tripSchedule.updateMany({
      where: { id: tripId },
      data: updateData,
    });
  }

  async handleCancellation(requestId: string, reason: string): Promise<void> {
    // Reset trip status back to SCHEDULED
  }
}
