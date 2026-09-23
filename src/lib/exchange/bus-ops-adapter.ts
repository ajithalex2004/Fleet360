/**
 * src/lib/exchange/bus-ops-adapter.ts
 *
 * Bus Ops (Passenger Transport / TripSchedule) Canonical Outsourcing Adapter.
 * Bridges native TripSchedule records with Fleet360 Exchange Core.
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { PartnerServiceDomain, Prisma } from '@prisma/client';
import {
  OutsourcingSourceAdapter,
  OutsourcingSource,
  ValidationResult,
  DomainEligibilityCriteria,
  BusRequirements,
  AwardApplicationPayload,
  ExecutionStatusEvent,
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
      // BusRoute has `origin`/`destination`, not `pickupLocation`/`dropoffLocation`.
      pickupLocation: trip.route?.origin || 'Dubai Hub',
      dropoffLocation: trip.route?.destination || 'Destination Site',
      // TripSchedule has no `serviceDate` column — `departureTime` (a full
      // timestamp, not just a time-of-day) IS the date this trip runs.
      serviceDate: trip.departureTime,
      // TripSchedule.departureTime is a full Date, but pickupTime here is
      // the 'HH:MM' string OutsourcingSource expects — format it rather
      // than assigning the Date object itself.
      pickupTime: trip.departureTime.toTimeString().slice(0, 5),
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

  async buildRequirementsPayload(source: OutsourcingSource): Promise<Record<string, unknown>> {
    const payload = source.domainPayload as BusRequirements;
    return {
      passengerSeats: payload.passengerSeats || 50,
      busClass: payload.busClass || 'STANDARD_STAFF',
      luggageAllowed: payload.luggageAllowed ?? false,
    };
  }

  async buildEligibilityRequirements(source: OutsourcingSource): Promise<DomainEligibilityCriteria> {
    const payload = source.domainPayload as BusRequirements;
    return {
      domain: this.domain,
      pickupCity: 'Dubai',
      serviceDate: source.serviceDate,
      domainPayload: {
        requiredCapacity: payload.passengerSeats || 50,
      },
    };
  }

  async applyAward(award: AwardApplicationPayload): Promise<void> {
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

  async applyAssignment(assignment: Record<string, unknown>): Promise<void> {
    // Synchronize assigned driver info if needed
    void assignment;
  }

  async syncExecutionStatus(event: ExecutionStatusEvent): Promise<void> {
    const tripId = event.sourceReferenceId;
    if (!tripId) return;

    const status = event.eventType;
    const now = new Date();
    const updateData: Prisma.TripScheduleUpdateManyMutationInput = { updatedAt: now };

    // NOTE: TripSchedule has no actualDeparture/actualArrival columns (only
    // the scheduled departureTime/arrivalTime) — writing to those field
    // names would fail Prisma's runtime schema validation. Only `status` is
    // updated here until real "actual time" tracking columns exist.
    if (status === 'STARTED') {
      updateData.status = 'IN_PROGRESS';
    } else if (status === 'COMPLETED') {
      updateData.status = 'COMPLETED';
    }

    await prisma.tripSchedule.updateMany({
      where: { id: tripId },
      data: updateData,
    });
  }

  async handleCancellation(requestId: string, reason: string): Promise<void> {
    // Reset trip status back to SCHEDULED
    void requestId;
    void reason;
  }
}
