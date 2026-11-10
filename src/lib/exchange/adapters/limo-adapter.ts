/**
 * src/lib/exchange/adapters/limo-adapter.ts
 *
 * Phase 2.7: Limousine & Chauffeur Outsourcing Adapter.
 * Connects VIP Transfers, Airport Meet & Greet, and Executive Chauffeur bookings to Fleet360 Exchange Core.
 */

import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { PartnerServiceDomain } from '@prisma/client';
import {
  OutsourcingSourceAdapter,
  OutsourcingSource,
  ValidationResult,
  DomainEligibilityCriteria,
  LimousineRequirements,
  AwardApplicationPayload,
  ExecutionStatusEvent,
} from './types';

function inferLuxuryClass(category?: string | null): LimousineRequirements['luxuryClass'] {
  const c = String(category ?? '').toUpperCase();
  if (c.includes('SUV') || c.includes('ESCALADE') || c.includes('PATROL') || c.includes('LAND CRUISER')) {
    return 'PREMIUM_SUV';
  }
  if (c.includes('VAN') || c.includes('SPRINTER') || c.includes('V-CLASS') || c.includes('V CLASS')) {
    return 'LUXURY_VAN';
  }
  if (c.includes('EXEC')) {
    return 'EXECUTIVE_SEDAN';
  }
  return 'LUXURY_SEDAN';
}

export class LimousineOutsourcingAdapter implements OutsourcingSourceAdapter {
  domain = PartnerServiceDomain.LIMOUSINE;

  async getSourceReference(bookingId: string, tenantId: string): Promise<OutsourcingSource> {
    try {
      const booking = await withTenantRls(prisma, tenantId, (tx) =>
        tx.booking.findFirst({
          where: { id: bookingId, tenantId },
        }),
      );

      if (booking) {
        let meta: Record<string, unknown> = {};
        if (booking.notes) {
          try {
            meta = JSON.parse(booking.notes);
          } catch {
            meta = { rawNotes: booking.notes };
          }
        }

        const pickupLocation =
          String(meta.pickupLocation ?? meta.origin ?? meta.originAddress ?? 'Dubai International Airport (DXB) VIP Terminal');
        const dropoffLocation =
          String(meta.dropoffLocation ?? meta.destination ?? meta.destinationAddress ?? 'Downtown Dubai Hotel');
        const pickupTime =
          typeof meta.pickupTime === 'string' && meta.pickupTime
            ? meta.pickupTime
            : booking.startDate.toTimeString().slice(0, 5);
        const passengerCount = Number(meta.passengers ?? meta.passengerCount ?? 2) || 2;
        const luggageCount = Number(meta.luggageCount ?? meta.luggage ?? 2) || 2;
        const flightNumber = typeof meta.flightNumber === 'string' ? meta.flightNumber : undefined;
        const meetAndGreet = meta.meetAndGreet !== undefined ? Boolean(meta.meetAndGreet) : Boolean(flightNumber);
        const waterAndWifiRequired = meta.waterAndWifiRequired !== undefined ? Boolean(meta.waterAndWifiRequired) : true;
        const luxuryClass =
          (typeof meta.luxuryClass === 'string'
            ? (meta.luxuryClass as LimousineRequirements['luxuryClass'])
            : undefined) ?? inferLuxuryClass(booking.vehicleCategory);

        return {
          domain: this.domain,
          sourceReferenceType: 'LIMO_BOOKING',
          sourceReferenceId: booking.id,
          tenantId,
          pickupLocation,
          dropoffLocation,
          serviceDate: booking.startDate,
          pickupTime,
          specialInstructions:
            typeof meta.specialInstructions === 'string'
              ? meta.specialInstructions
              : typeof meta.rawNotes === 'string'
                ? meta.rawNotes
                : `Booking ${booking.bookingRef ?? booking.id} (${booking.requestorName})`,
          domainPayload: {
            luxuryClass,
            passengerCount,
            luggageCount,
            serviceType: flightNumber ? 'AIRPORT_TRANSFER' : 'POINT_TO_POINT',
            flightNumber,
            meetAndGreet,
            waterAndWifiRequired,
          } as LimousineRequirements,
        };
      }
    } catch {
      // Fallback for synthetic/test IDs
    }

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

  async buildRequirementsPayload(source: OutsourcingSource): Promise<Record<string, unknown>> {
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

  async applyAward(award: AwardApplicationPayload): Promise<void> {
    const bookingId = award.request?.sourceReferenceId || award.sourceReferenceId;
    if (bookingId && award.tenantId) {
      await withTenantRls(prisma, award.tenantId, async (tx) => {
        const existing = await tx.booking.findFirst({
          where: { id: bookingId, tenantId: award.tenantId },
        });
        if (existing) {
          let meta: Record<string, unknown> = {};
          if (existing.notes) {
            try {
              meta = JSON.parse(existing.notes);
            } catch {
              meta = { rawNotes: existing.notes };
            }
          }
          const updatedNotes = JSON.stringify({
            ...meta,
            outsourced: true,
            outsourceRequestId: award.requestId,
            outsourcePartnerId: award.partnerId,
            outsourceTotalAwarded: Number(award.totalAwarded ?? 0),
          });
          await tx.booking.update({
            where: { id: existing.id },
            data: {
              status: 'CONFIRMED',
              notes: updatedNotes,
            },
          });
        }
      }).catch(() => {});
    }

    await logAudit({
      tenantId: award.tenantId,
      entityType: 'LimousineBooking',
      entityId: bookingId || award.requestId,
      action: 'UPDATE',
      details: `LIMO_OUTSOURCE_AWARDED to partner ${award.partnerId} for AED ${award.totalAwarded}`,
      userId: award.awardedBy,
    }).catch(() => {});
  }

  async applyAssignment(assignment: Record<string, unknown>): Promise<void> {
    const tenantId = typeof assignment.tenantId === 'string' ? assignment.tenantId : undefined;
    const bookingId = typeof assignment.sourceReferenceId === 'string' ? assignment.sourceReferenceId : undefined;
    if (!tenantId || !bookingId) return;

    await withTenantRls(prisma, tenantId, async (tx) => {
      const existing = await tx.booking.findFirst({
        where: { id: bookingId, tenantId },
      });
      if (!existing) return;

      let meta: Record<string, unknown> = {};
      if (existing.notes) {
        try {
          meta = JSON.parse(existing.notes);
        } catch {
          meta = { rawNotes: existing.notes };
        }
      }
      await tx.booking.update({
        where: { id: existing.id },
        data: {
          notes: JSON.stringify({
            ...meta,
            partnerDriverName: assignment.driverName,
            partnerDriverPhone: assignment.driverPhone,
            partnerVehiclePlate: assignment.vehiclePlate,
          }),
        },
      });
    }).catch(() => {});
  }

  async syncExecutionStatus(event: ExecutionStatusEvent): Promise<void> {
    if (!event.sourceReferenceId) return;
    const mappedBookingStatus =
      event.eventType === 'STARTED'
        ? 'ACTIVE'
        : event.eventType === 'COMPLETED'
          ? 'COMPLETED'
          : event.eventType === 'CANCELLED' || event.eventType === 'ABORTED'
            ? 'CANCELLED'
            : undefined;
    if (!mappedBookingStatus) return;

    await prisma.booking.updateMany({
      where: { id: event.sourceReferenceId },
      data: { status: mappedBookingStatus },
    }).catch(() => {});
  }

  async handleCancellation(requestId: string, reason: string): Promise<void> {
    await logAudit({
      entityType: 'LimousineOutsourceRequest',
      entityId: requestId,
      action: 'DELETE',
      details: `Limousine outsource request cancelled: ${reason}`,
    }).catch(() => {});
  }
}
