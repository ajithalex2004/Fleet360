/**
 * src/lib/exchange/outsource-engine.ts
 *
 * Core Outsourcing Workflow Engine for Fleet360 Operations & Exchange.
 * Handles Outsource Requests, Partner Invitations, Quotes with Revisions, Awards, and Execution Tokens.
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { raiseAlert } from '@/lib/alerts/raise';
import { randomBytes } from 'crypto';
import {
  OutsourcePricingMethod,
  OutsourceRequestStatus,
  PartnerQuoteStatus,
  PartnerServiceDomain,
} from '@prisma/client';

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
        invitedPartners: input.invitedPartnerIds
          ? {
              create: input.invitedPartnerIds.map((pid) => ({
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
   * Award an Outsource Quote (Transaction-Safe)
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
   * Assign Vehicle & Driver and generate secure driver execution link
   */
  static async assignVehicleAndDriver(input: AssignVehicleDriverInput) {
    const token = randomBytes(32).toString('hex');
    const tokenExp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const assignment = await prisma.partnerAssignment.upsert({
      where: { awardId: input.awardId },
      update: {
        vehicleId: input.vehicleId,
        vehiclePlate: input.vehiclePlate.trim().toUpperCase(),
        driverId: input.driverId,
        driverName: input.driverName.trim(),
        driverPhone: input.driverPhone.trim(),
        driverToken: token,
        driverTokenExp: tokenExp,
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
        driverToken: token,
        driverTokenExp: tokenExp,
        driverAssignedAt: new Date(),
      },
    });

    // Update award status to ASSIGNED
    await prisma.outsourceAward.update({
      where: { id: input.awardId },
      data: { status: 'ASSIGNED' },
    });

    return {
      assignment,
      driverSecureUrl: `/track/partner-trip/${token}`,
    };
  }

  /**
   * Driver execution status milestone updates
   */
  static async updateDriverMilestone(
    token: string,
    milestone: 'REACHED' | 'STARTED' | 'COMPLETED',
    podData?: {
      passengerCount?: number;
      signedByName?: string;
      signatureUrl?: string;
      photoUrl?: string;
      completionNotes?: string;
    }
  ) {
    const assignment = await prisma.partnerAssignment.findUnique({
      where: { driverToken: token },
      include: {
        award: {
          include: { request: true },
        },
      },
    });

    if (!assignment) throw new Error('Invalid or expired driver execution token');
    if (new Date() > assignment.driverTokenExp) {
      throw new Error('Driver token has expired');
    }

    const now = new Date();
    const updateData: any = {};

    if (milestone === 'REACHED') {
      updateData.reachedAt = now;
    } else if (milestone === 'STARTED') {
      updateData.startedAt = now;
      await prisma.outsourceAward.update({
        where: { id: assignment.awardId },
        data: { status: 'IN_PROGRESS' },
      });
    } else if (milestone === 'COMPLETED') {
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

    return prisma.partnerAssignment.update({
      where: { id: assignment.id },
      data: updateData,
    });
  }
}
