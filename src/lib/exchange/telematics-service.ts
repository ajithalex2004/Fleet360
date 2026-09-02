/**
 * src/lib/exchange/telematics-service.ts
 *
 * Live In-Transit Telematics, Automated Geofencing & Predictive ETA Engine for Fleet360 Exchange.
 */

import { prisma } from '@/lib/prisma';
import { hashDriverToken } from './outsource-engine';
import { raiseAlert } from '@/lib/alerts/raise';

export interface GpsPingInput {
  latitude: number;
  longitude: number;
  speed?: number; // km/h or m/s
  heading?: number;
  accuracy?: number;
}

export interface TelematicsProcessingResult {
  ok: boolean;
  assignmentId: string;
  currentStatus: string;
  geofenceTriggered?: 'PICKUP_REACHED' | 'DESTINATION_REACHED' | null;
  distanceToPickupMeters?: number;
  distanceToDestinationMeters?: number;
  predictedEta?: string;
  delayMinutes?: number;
  isDelayAlertTriggered?: boolean;
}

export class TelematicsService {
  /**
   * Compute geodesic distance between two GPS coordinates using Haversine formula (in meters)
   */
  static calculateHaversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371e3; // Earth radius in meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(R * c);
  }

  /**
   * Process incoming GPS telemetry ping from driver mobile web link
   */
  static async ingestDriverGpsPing(
    rawToken: string,
    ping: GpsPingInput
  ): Promise<TelematicsProcessingResult> {
    const tokenHash = hashDriverToken(rawToken);

    const assignment = await prisma.partnerAssignment.findUnique({
      where: { driverTokenHash: tokenHash },
      include: {
        award: {
          include: { request: true },
        },
      },
    });

    if (!assignment) throw new Error('Invalid or expired trip token');
    if (assignment.isTokenRevoked) throw new Error('Trip link has been revoked');
    if (new Date() > new Date(assignment.driverTokenExp)) throw new Error('Trip link expired');

    const request = assignment.award.request;
    let geofenceTriggered: 'PICKUP_REACHED' | 'DESTINATION_REACHED' | null = null;
    let distanceToPickup: number | undefined;
    let distanceToDestination: number | undefined;

    // 1. Evaluate Pickup Geofence (250m radius)
    if (request.pickupLatitude && request.pickupLongitude) {
      distanceToPickup = TelematicsService.calculateHaversineDistance(
        ping.latitude,
        ping.longitude,
        request.pickupLatitude,
        request.pickupLongitude
      );

      // If driver is ASSIGNED and within 250m of pickup -> Auto-trigger REACHED
      if (!assignment.reachedAt && distanceToPickup <= 250) {
        await prisma.partnerAssignment.update({
          where: { id: assignment.id },
          data: { reachedAt: new Date() },
        });

        await prisma.partnerTripEvent.create({
          data: {
            assignmentId: assignment.id,
            eventType: 'GEOFENCE_PICKUP_ENTERED',
            actor: 'GEOFENCE_ENGINE',
            latitude: ping.latitude,
            longitude: ping.longitude,
            payload: {
              distanceMeters: distanceToPickup,
              radiusThresholdMeters: 250,
            },
          },
        });

        geofenceTriggered = 'PICKUP_REACHED';
      }
    }

    // 2. Evaluate Dropoff Destination Geofence (250m radius)
    if (request.dropoffLatitude && request.dropoffLongitude) {
      distanceToDestination = TelematicsService.calculateHaversineDistance(
        ping.latitude,
        ping.longitude,
        request.dropoffLatitude,
        request.dropoffLongitude
      );

      // If trip is STARTED and within 250m of dropoff -> Log destination arrival
      if (assignment.startedAt && !assignment.completedAt && distanceToDestination <= 250) {
        await prisma.partnerTripEvent.create({
          data: {
            assignmentId: assignment.id,
            eventType: 'GEOFENCE_DESTINATION_ENTERED',
            actor: 'GEOFENCE_ENGINE',
            latitude: ping.latitude,
            longitude: ping.longitude,
            payload: {
              distanceMeters: distanceToDestination,
              radiusThresholdMeters: 250,
            },
          },
        });

        geofenceTriggered = 'DESTINATION_REACHED';
      }
    }

    // 3. Predictive ETA & Congestion Delay Detection
    let predictedEta: string | undefined;
    let delayMinutes = 0;
    let isDelayAlertTriggered = false;

    if (distanceToDestination && request.pickupTime) {
      // Estimate travel time assuming 40 km/h urban velocity if speed is low
      const speedKmh = ping.speed && ping.speed > 5 ? ping.speed : 40;
      const hoursRemaining = (distanceToDestination / 1000) / speedKmh;
      const minutesRemaining = Math.round(hoursRemaining * 60);

      const etaDate = new Date(Date.now() + minutesRemaining * 60 * 1000);
      predictedEta = etaDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Compare against scheduled pickup/arrival window
      const [scheduledHour, scheduledMin] = request.pickupTime.split(':').map(Number);
      const scheduledDate = new Date(request.serviceDate);
      scheduledDate.setHours(scheduledHour || 6, scheduledMin || 0, 0, 0);

      if (etaDate.getTime() > scheduledDate.getTime() + 15 * 60 * 1000) {
        delayMinutes = Math.round((etaDate.getTime() - scheduledDate.getTime()) / (1000 * 60));
        isDelayAlertTriggered = true;

        await raiseAlert({
          tenantId: request.tenantId,
          code: 'IN_TRANSIT_DELAY_PREDICTED',
          sourceModule: 'exchange',
          subjectType: 'TripSchedule' as any,
          subjectId: request.sourceReferenceId,
          title: `⚠️ In-Transit Delay Predicted: ${delayMinutes}m delay on ${request.requestNumber}`,
          description: `Vehicle is ${delayMinutes} mins behind schedule. Projected ETA: ${predictedEta}`,
          severity: 'HIGH',
          actor: 'ETA_ENGINE',
        }).catch(() => {});
      }
    }

    // 4. Record GPS Ping in PartnerTripEvent
    await prisma.partnerTripEvent.create({
      data: {
        assignmentId: assignment.id,
        eventType: 'GPS_PING',
        actor: 'DRIVER_MOBILE',
        latitude: ping.latitude,
        longitude: ping.longitude,
        payload: {
          speed: ping.speed,
          heading: ping.heading,
          accuracy: ping.accuracy,
          distanceToPickup,
          distanceToDestination,
          predictedEta,
        },
      },
    });

    return {
      ok: true,
      assignmentId: assignment.id,
      currentStatus: assignment.completedAt
        ? 'COMPLETED'
        : assignment.startedAt
        ? 'STARTED'
        : assignment.reachedAt
        ? 'REACHED'
        : 'ASSIGNED',
      geofenceTriggered,
      distanceToPickupMeters: distanceToPickup,
      distanceToDestinationMeters: distanceToDestination,
      predictedEta,
      delayMinutes,
      isDelayAlertTriggered,
    };
  }
}
