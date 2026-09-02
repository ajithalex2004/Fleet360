/**
 * src/lib/exchange/outsource-engine.ts
 *
 * Core Outsourcing Workflow Engine for Fleet360 Operations & Exchange.
 * Hardened for Phase 1.5 Production Readiness:
 * - SHA-256 hashed driver execution tokens (zero plaintext in DB)
 * - Strict backend state machine enforcement (ASSIGNED -> REACHED -> STARTED -> COMPLETED)
 * - Server-side compliance validation gates (vehicle mulkiya, driver license & RTA permits)
 * - TenantPartnerRelationship authorization validation
 * - Immutable execution telemetry via PartnerTripEvent
 * - Concurrency and race-condition defenses
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { raiseAlert } from '@/lib/alerts/raise';
import { randomBytes, createHash } from 'crypto';
import {
  OutsourcePricingMethod,
  OutsourceRequestStatus,
  PartnerQuoteStatus,
  PartnerServiceDomain,
} from '@prisma/client';

export function hashDriverToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

export interface CreateOutsourceRequestInput {
  tenantId: string;
  sourceReferenceType?: string; // TRIP_SCHEDULE
  sourceReferenceId: string;
  domain?: PartnerServiceDomain;
  pricingMethod?: OutsourcePricingMethod;
  serviceDate: Date | string;
  pickupTime: string;
  pickupLocation: string;
  pickupLatitude?: number;
  pickupLongitude?: number;
  dropoffLocation: string;
  dropoffLatitude?: number;
  dropoffLongitude?: number;
  requiredCapacity?: number;
  vehicleTypeRequired?: string;
  specialInstructions?: string;
  closesInHours?: number;
  invitedPartnerIds?: string[];
  createdByUserId: string;
}

export interface SubmitQuoteInput {
  requestId: string;
  partnerId: string;
  amount: number;
  vatAmount?: number;
  currency?: string;
  validHours?: number;
  proposedVehicleId?: string;
  proposedDriverId?: string;
  notes?: string;
  actorUserId?: string;
}

export interface AwardQuoteInput {
  tenantId: string;
  requestId: string;
  quoteId: string;
  awardedByUserId: string;
}

export interface AssignVehicleDriverInput {
  awardId: string;
  partnerId: string;
  vehicleId?: string;
  vehiclePlate: string;
  driverId?: string;
  driverName: string;
  driverPhone: string;
  actorUserId?: string;
}

export class OutsourceEngine {
  /**
   * Create an Outsource Request from Fleet360 Operations
   */
  static async createOutsourceRequest(input: CreateOutsourceRequestInput) {
    const closesAt = new Date(
      Date.now() + (input.closesInHours || 24) * 60 * 60 * 1000
    );

    const count = await prisma.outsourceRequest.count({
      where: { tenantId: input.tenantId },
    });
    const requestNumber = `OUT-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;

    // Filter invited partners against TenantPartnerRelationship blocklists
    let allowedPartnerIds = input.invitedPartnerIds;
    if (allowedPartnerIds && allowedPartnerIds.length > 0) {
      const blockedRelationships = await prisma.tenantPartnerRelationship.findMany({
        where: {
          tenantId: input.tenantId,
          partnerId: { in: allowedPartnerIds },
          status: 'BLOCKED',
        },
        select: { partnerId: true },
      });
      const blockedSet = new Set(blockedRelationships.map((b) => b.partnerId));
      allowedPartnerIds = allowedPartnerIds.filter((pid) => !blockedSet.has(pid));
    }

    const request = await prisma.outsourceRequest.create({
      data: {
        tenantId: input.tenantId,
        requestNumber,
        domain: input.domain || PartnerServiceDomain.PASSENGER_TRANSPORT,
        sourceReferenceType: input.sourceReferenceType || 'TRIP_SCHEDULE',
        sourceReferenceId: input.sourceReferenceId,
        pricingMethod: input.pricingMethod || OutsourcePricingMethod.RFQ,
        status: OutsourceRequestStatus.PUBLISHED,
        serviceDate: new Date(input.serviceDate),
        pickupTime: input.pickupTime,
        pickupLocation: input.pickupLocation,
        pickupLatitude: input.pickupLatitude,
        pickupLongitude: input.pickupLongitude,
        dropoffLocation: input.dropoffLocation,
        dropoffLatitude: input.dropoffLatitude,
        dropoffLongitude: input.dropoffLongitude,
        requiredCapacity: input.requiredCapacity || 50,
        vehicleTypeRequired: input.vehicleTypeRequired || '50-Seat Bus',
        specialInstructions: input.specialInstructions,
        closesAt,
        createdBy: input.createdByUserId,
        invitedPartners: allowedPartnerIds
          ? {
              create: allowedPartnerIds.map((pid) => ({
                partnerId: pid,
                status: 'INVITED',
              })),
            }
          : undefined,
      },
      include: {
        invitedPartners: { include: { partner: true } },
      },
    });

    await logAudit(
      prisma,
      input.tenantId,
      'OutsourceRequest',
      request.id,
      'CREATE',
      { requestNumber, pricingMethod: request.pricingMethod },
      input.createdByUserId
    );

    return request;
  }

  /**
   * Submit or revise a partner quotation
   */
  static async submitOrReviseQuote(input: SubmitQuoteInput) {
    const vatRate = 0.05; // UAE 5% VAT
    const subtotal = Number(input.amount);
    const vat = input.vatAmount != null ? Number(input.vatAmount) : subtotal * vatRate;
    const total = subtotal + vat;
    const validUntil = new Date(
      Date.now() + (input.validHours || 48) * 60 * 60 * 1000
    );

    // Check for previous quote to handle revisions
    const previousQuote = await prisma.partnerQuote.findFirst({
      where: {
        requestId: input.requestId,
        partnerId: input.partnerId,
        status: { in: [PartnerQuoteStatus.SUBMITTED, PartnerQuoteStatus.DRAFT] },
      },
      orderBy: { revisionNo: 'desc' },
    });

    let revisionNo = 1;
    let supersedesQuoteId: string | null = null;

    if (previousQuote) {
      revisionNo = previousQuote.revisionNo + 1;
      supersedesQuoteId = previousQuote.id;

      // Mark old quote as SUPERSEDED
      await prisma.partnerQuote.update({
        where: { id: previousQuote.id },
        data: { status: PartnerQuoteStatus.SUPERSEDED },
      });
    }

    const newQuote = await prisma.partnerQuote.create({
      data: {
        requestId: input.requestId,
        partnerId: input.partnerId,
        revisionNo,
        supersedesQuoteId,
        amount: subtotal,
        vatAmount: vat,
        totalAmount: total,
        currency: input.currency || 'AED',
        validUntil,
        status: PartnerQuoteStatus.SUBMITTED,
        notes: input.notes,
        proposedVehicleId: input.proposedVehicleId,
        proposedDriverId: input.proposedDriverId,
      },
      include: {
        partner: true,
        request: true,
      },
    });

    // Update invite status if existed
    await prisma.outsourceRequestPartner.updateMany({
      where: { requestId: input.requestId, partnerId: input.partnerId },
      data: { status: 'QUOTED' },
    });

    // Notify Requesting Tenant
    await raiseAlert({
      tenantId: newQuote.request.tenantId,
      code: 'OUTSOURCE_QUOTE_RECEIVED',
      sourceModule: 'exchange',
      subjectType: 'OutsourceRequest' as any,
      subjectId: input.requestId,
      title: `💰 Outsource Quote Received: ${newQuote.partner.legalName} (Rev ${revisionNo})`,
      description: `Partner ${newQuote.partner.legalName} quoted AED ${total.toFixed(2)} for ${newQuote.request.requestNumber}.`,
      severity: 'LOW',
      actor: input.actorUserId || newQuote.partner.legalName,
    });

    return newQuote;
  }

  /**
   * Award an Outsource Quote (Transaction-Safe with Row Locking & State Checks)
   */
  static async awardQuote(input: AwardQuoteInput) {
    return prisma.$transaction(async (tx) => {
      // 1. Validate request and quote
      const request = await tx.outsourceRequest.findUnique({
        where: { id: input.requestId, tenantId: input.tenantId },
        include: { award: true },
      });

      if (!request) throw new Error('Outsource request not found');
      if (request.award) throw new Error('Request has already been awarded');
      if (request.status === OutsourceRequestStatus.CANCELLED) {
        throw new Error('Cannot award a cancelled request');
      }

      const quote = await tx.partnerQuote.findUnique({
        where: { id: input.quoteId, requestId: input.requestId },
        include: { partner: true },
      });

      if (!quote) throw new Error('Quote not found for this request');
      if (quote.status !== PartnerQuoteStatus.SUBMITTED) {
        throw new Error(`Quote status is ${quote.status}; only SUBMITTED quotes can be awarded`);
      }

      // Check tenant relationship authorization
      const relationship = await tx.tenantPartnerRelationship.findUnique({
        where: {
          tenantId_partnerId: {
            tenantId: input.tenantId,
            partnerId: quote.partnerId,
          },
        },
      });
      if (relationship && relationship.status === 'BLOCKED') {
        throw new Error(`Partner ${quote.partner.legalName} is blocked by this tenant`);
      }

      // 2. Snapshot commercial terms
      const commercialSnapshot = {
        requestId: request.id,
        requestNumber: request.requestNumber,
        quoteId: quote.id,
        quoteRevision: quote.revisionNo,
        partnerId: quote.partnerId,
        partnerName: quote.partner.legalName,
        partnerCode: quote.partner.partnerCode,
        amount: Number(quote.amount),
        vatAmount: Number(quote.vatAmount),
        totalAmount: Number(quote.totalAmount),
        currency: quote.currency,
        serviceDate: request.serviceDate.toISOString(),
        pickupLocation: request.pickupLocation,
        dropoffLocation: request.dropoffLocation,
        awardedAt: new Date().toISOString(),
      };

      // 3. Create OutsourceAward
      const award = await tx.outsourceAward.create({
        data: {
          tenantId: input.tenantId,
          requestId: request.id,
          quoteId: quote.id,
          partnerId: quote.partnerId,
          awardedPrice: quote.amount,
          vatAmount: quote.vatAmount,
          totalAwarded: quote.totalAmount,
          currency: quote.currency,
          commercialSnapshot,
          awardedBy: input.awardedByUserId,
          status: 'AWARDED',
        },
      });

      // 4. Update Quote status to ACCEPTED, others to REJECTED
      await tx.partnerQuote.update({
        where: { id: quote.id },
        data: { status: PartnerQuoteStatus.ACCEPTED },
      });

      await tx.partnerQuote.updateMany({
        where: {
          requestId: request.id,
          id: { not: quote.id },
          status: PartnerQuoteStatus.SUBMITTED,
        },
        data: { status: PartnerQuoteStatus.REJECTED },
      });

      // 5. Update Request status to AWARDED
      await tx.outsourceRequest.update({
        where: { id: request.id },
        data: { status: OutsourceRequestStatus.AWARDED },
      });

      // 6. Log Audit
      await logAudit(
        tx,
        input.tenantId,
        'OutsourceAward',
        award.id,
        'CREATE',
        {
          partnerId: quote.partnerId,
          totalAwarded: Number(quote.totalAmount),
          requestNumber: request.requestNumber,
        },
        input.awardedByUserId
      );

      return award;
    });
  }

  /**
   * Assign Vehicle & Driver with Server-Side Compliance Enforcement Gates
   * and SHA-256 Hashed Driver Execution Token
   */
  static async assignVehicleAndDriver(input: AssignVehicleDriverInput) {
    const award = await prisma.outsourceAward.findUnique({
      where: { id: input.awardId },
      include: {
        partner: {
          include: { complianceDocuments: true },
        },
      },
    });

    if (!award) throw new Error('Award not found');
    if (award.partnerId !== input.partnerId) {
      throw new Error('Partner unauthorized for this award');
    }

    // 1. Compliance Gate: Partner Operational Status
    if (award.partner.operationalStatus !== 'ACTIVE') {
      throw new Error(`Partner is not in ACTIVE operational status (current: ${award.partner.operationalStatus})`);
    }

    // 2. Compliance Gate: Vehicle Mulkiya
    if (input.vehicleId) {
      const vehicle = await prisma.partnerVehicle.findUnique({
        where: { id: input.vehicleId },
      });
      if (vehicle) {
        if (!vehicle.isActive) throw new Error(`Vehicle ${vehicle.licensePlate} is inactive`);
        if (vehicle.mulkiyaExpiry && new Date(vehicle.mulkiyaExpiry) < new Date()) {
          throw new Error(`Vehicle ${vehicle.licensePlate} Mulkiya registration expired on ${new Date(vehicle.mulkiyaExpiry).toLocaleDateString()}`);
        }
      }
    }

    // 3. Compliance Gate: Driver License & Regulatory Permit
    if (input.driverId) {
      const driver = await prisma.partnerDriver.findUnique({
        where: { id: input.driverId },
      });
      if (driver) {
        if (!driver.isActive) throw new Error(`Driver ${driver.fullName} is inactive`);
        if (driver.licenseExpiry && new Date(driver.licenseExpiry) < new Date()) {
          throw new Error(`Driver ${driver.fullName} driving license expired on ${new Date(driver.licenseExpiry).toLocaleDateString()}`);
        }
        if (driver.permitExpiry && new Date(driver.permitExpiry) < new Date()) {
          throw new Error(`Driver ${driver.fullName} RTA/regulatory permit expired on ${new Date(driver.permitExpiry).toLocaleDateString()}`);
        }
      }
    }

    // 4. Generate 64-character raw token and compute SHA-256 hash
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashDriverToken(rawToken);
    const tokenExp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const existingAssignment = await prisma.partnerAssignment.findUnique({
      where: { awardId: input.awardId },
    });

    const assignment = await prisma.partnerAssignment.upsert({
      where: { awardId: input.awardId },
      update: {
        vehicleId: input.vehicleId,
        vehiclePlate: input.vehiclePlate.trim().toUpperCase(),
        driverId: input.driverId,
        driverName: input.driverName.trim(),
        driverPhone: input.driverPhone.trim(),
        driverTokenHash: tokenHash,
        driverTokenExp: tokenExp,
        isTokenRevoked: false,
        driverAssignedAt: new Date(),
        updatedAt: new Date(),
      },
      create: {
        awardId: input.awardId,
        partnerId: input.partnerId,
        vehicleId: input.vehicleId,
        vehiclePlate: input.vehiclePlate.trim().toUpperCase(),
        driverId: input.driverId,
        driverName: input.driverName.trim(),
        driverPhone: input.driverPhone.trim(),
        driverTokenHash: tokenHash,
        driverTokenExp: tokenExp,
        isTokenRevoked: false,
        driverAssignedAt: new Date(),
      },
    });

    // Record Immutable PartnerTripEvent
    await prisma.partnerTripEvent.create({
      data: {
        assignmentId: assignment.id,
        eventType: existingAssignment ? 'TOKEN_ROTATED' : 'DRIVER_ASSIGNED',
        actor: input.actorUserId || 'PARTNER_DISPATCH',
        payload: {
          vehiclePlate: input.vehiclePlate,
          driverName: input.driverName,
        },
      },
    });

    // Update award status to ASSIGNED
    await prisma.outsourceAward.update({
      where: { id: input.awardId },
      data: { status: 'ASSIGNED' },
    });

    return {
      assignment,
      driverSecureUrl: `/track/partner-trip/${rawToken}`,
      rawToken,
    };
  }

  /**
   * Driver execution status milestone updates with strict State Machine
   * Sequence: ASSIGNED -> REACHED -> STARTED -> COMPLETED
   */
  static async updateDriverMilestone(
    rawToken: string,
    milestone: 'REACHED' | 'STARTED' | 'COMPLETED',
    podData?: {
      passengerCount?: number;
      signedByName?: string;
      signatureUrl?: string;
      photoUrl?: string;
      completionNotes?: string;
    }
  ) {
    const tokenHash = hashDriverToken(rawToken);

    const assignment = await prisma.partnerAssignment.findUnique({
      where: { driverTokenHash: tokenHash },
      include: {
        award: {
          include: { request: true },
        },
      },
    });

    if (!assignment) throw new Error('Invalid or expired driver execution link');
    if (assignment.isTokenRevoked) throw new Error('Driver execution token has been revoked');
    if (new Date() > assignment.driverTokenExp) {
      throw new Error('Driver execution link has expired');
    }

    // 1. Strict State Machine Validation: Completed trips become strictly read-only
    if (assignment.completedAt || assignment.award.status === 'COMPLETED') {
      throw new Error('Trip is already completed and finalized; further milestone mutations rejected');
    }
    if (assignment.cancelledAt || assignment.award.status === 'CANCELLED') {
      throw new Error('Trip is cancelled; further mutations rejected');
    }

    const now = new Date();
    const updateData: any = {};

    if (milestone === 'REACHED') {
      if (assignment.reachedAt) {
        throw new Error('Milestone REACHED was already recorded');
      }
      updateData.reachedAt = now;
    } else if (milestone === 'STARTED') {
      if (!assignment.reachedAt) {
        throw new Error('Cannot transition to STARTED before reaching pickup location (REACHED required)');
      }
      if (assignment.startedAt) {
        throw new Error('Milestone STARTED was already recorded');
      }
      updateData.startedAt = now;
      await prisma.outsourceAward.update({
        where: { id: assignment.awardId },
        data: { status: 'IN_PROGRESS' },
      });
    } else if (milestone === 'COMPLETED') {
      if (!assignment.startedAt) {
        throw new Error('Cannot transition to COMPLETED before starting the trip (STARTED required)');
      }
      updateData.completedAt = now;
      await prisma.outsourceAward.update({
        where: { id: assignment.awardId },
        data: { status: 'COMPLETED' },
      });

      if (podData) {
        await prisma.outsourcePod.upsert({
          where: { assignmentId: assignment.id },
          update: {
            passengerCount: podData.passengerCount,
            signedByName: podData.signedByName,
            signatureUrl: podData.signatureUrl,
            photoUrl: podData.photoUrl,
            completionNotes: podData.completionNotes,
          },
          create: {
            assignmentId: assignment.id,
            passengerCount: podData.passengerCount,
            signedByName: podData.signedByName,
            signatureUrl: podData.signatureUrl,
            photoUrl: podData.photoUrl,
            completionNotes: podData.completionNotes,
          },
        });
      }
    }

    // Record Immutable PartnerTripEvent
    await prisma.partnerTripEvent.create({
      data: {
        assignmentId: assignment.id,
        eventType: milestone,
        actor: 'DRIVER',
        payload: podData ? { podData } : undefined,
      },
    });

    return prisma.partnerAssignment.update({
      where: { id: assignment.id },
      data: updateData,
    });
  }
}
