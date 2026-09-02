/**
 * src/lib/exchange/bus-ops-adapter.ts
 *
 * Bus Ops (Passenger Transport / TripSchedule) Outsourcing Adapter.
 * Bridges OutsourceAward and Driver execution events with native Bus Ops TripSchedule records.
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { PartnerServiceDomain } from '@prisma/client';

export interface OutsourcingSourceAdapter {
  domain: PartnerServiceDomain;
  validateOutsource(sourceReferenceId: string, tenantId: string): Promise<{ ok: boolean; error?: string; details?: any }>;
  markAwarded(awardId: string, sourceReferenceId: string, tenantId: string): Promise<{ ok: boolean }>;
  syncExecutionStatus(sourceReferenceId: string, tenantId: string, status: 'REACHED' | 'STARTED' | 'COMPLETED', payload?: any): Promise<void>;
}

export class BusOpsOutsourcingAdapter implements OutsourcingSourceAdapter {
  domain = PartnerServiceDomain.PASSENGER_TRANSPORT;

  /**
   * Validate TripSchedule is available for outsourcing
   */
  async validateOutsource(tripId: string, tenantId: string) {
    const trip = await prisma.tripSchedule.findUnique({
      where: { id: tripId, tenantId, deletedAt: null },
    });

    if (!trip) {
      return { ok: false, error: 'Trip schedule not found' };
    }

    if (trip.status === 'CANCELLED' || trip.status === 'COMPLETED') {
      return { ok: false, error: `Trip is already ${trip.status}` };
    }

    return {
      ok: true,
      details: {
        tripNumber: trip.tripNumber,
        routeId: trip.routeId,
        departureTime: trip.departureTime,
        arrivalTime: trip.arrivalTime,
        capacity: trip.capacity,
      },
    };
  }

  /**
   * On Award: Link trip to partner and update status
   */
  async markAwarded(awardId: string, tripId: string, tenantId: string) {
    const award = await prisma.outsourceAward.findUnique({
      where: { id: awardId, tenantId },
      include: { partner: true },
    });

    if (!award) throw new Error('Outsource award not found');

    await prisma.tripSchedule.update({
      where: { id: tripId },
      data: {
        status: 'ASSIGNED',
        updatedAt: new Date(),
      },
    });

    await logAudit(
      prisma,
      tenantId,
      'TripSchedule',
      tripId,
      'UPDATE',
      {
        action: 'OUTSOURCE_AWARDED',
        awardId: award.id,
        partnerId: award.partnerId,
        partnerName: award.partner.legalName,
        awardedPrice: Number(award.totalAwarded),
      },
      award.awardedBy
    );

    return { ok: true };
  }

  /**
   * Synchronize Driver execution updates into TripSchedule
   */
  async syncExecutionStatus(
    tripId: string,
    tenantId: string,
    status: 'REACHED' | 'STARTED' | 'COMPLETED',
    payload?: any
  ) {
    const now = new Date();
    const updateData: any = { updatedAt: now };

    if (status === 'STARTED') {
      updateData.status = 'IN_PROGRESS';
      updateData.actualDepartureAt = now;
    } else if (status === 'COMPLETED') {
      updateData.status = 'COMPLETED';
      updateData.actualArrivalAt = now;
    }

    await prisma.tripSchedule.update({
      where: { id: tripId },
      data: updateData,
    });

    await logAudit(
      prisma,
      tenantId,
      'TripSchedule',
      tripId,
      'UPDATE',
      {
        action: `DRIVER_${status}`,
        payload,
      },
      'PARTNER_DRIVER'
    );
  }
}
