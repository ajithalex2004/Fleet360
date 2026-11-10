/**
 * src/lib/exchange/outsource-engine.ts
 *
 * Core Outsourcing Workflow Engine for Fleet360 Operations & Exchange.
 * Hardened for Phase 1 & Phase 2:
 * - Deterministic Partner Eligibility and Multi-Partner RFQ
 * - Partner Quote Decline with structured reason codes
 * - Deadline Governance & Extensions
 * - Multi-Domain Contract-Rate Direct Award (Passenger Transport, Freight, Limousine, Recovery)
 * - Immutable SHA-256 Rate-Card Snapshot & Commercial Economics frozen into OutsourceAward
 * - Idempotent Award retries on same quoteId
 * - SHA-256 hashed driver execution tokens (zero plaintext in DB)
 * - Strict backend state machine enforcement (ASSIGNED -> REACHED -> STARTED -> COMPLETED / CANCELLED / ABORTED)
 * - 3-Stage Synchronous Pre-Dispatch Compliance Guard (validating against serviceDate cutoff & revoking tokens on expiry)
 * - TenantPartnerRelationship authorization validation
 * - Immutable execution telemetry via PartnerTripEvent
 */

import { prisma } from '@/lib/prisma';
import { activeRlsScope } from '@/lib/rls-scope';
import { logAudit, logAuditInTx } from '@/lib/audit';
import { raiseAlert } from '@/lib/alerts/raise';
import { randomBytes, createHash } from 'crypto';
import {
  OutsourceDeclineReason,
  OutsourcePricingMethod,
  OutsourceRequestStatus,
  OutsourceVisibility,
  PartnerQuoteStatus,
  PartnerServiceDomain,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { AlertSubjectType } from '@/events/contracts/alert.events';
import { DisclosurePolicyService } from './disclosure-service';
import { PreDispatchComplianceGuard } from './compliance-guard';
import {
  RateCardService,
  type RateCardSnapshot,
  type RateCardAncillaryCharges,
} from './rate-card-service';
import type {
  CommercialModel,
  AgencySettlementMode,
  Ifrs15PrincipalIndicators,
} from './commercial-ledger-service';

export function hashDriverToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

async function runInExchangeTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const scope = activeRlsScope();
  const scopedTx = scope?.tx as Prisma.TransactionClient | undefined;
  if (scopedTx && typeof scopedTx.outsourceRequest?.findUnique === 'function') {
    return fn(scopedTx);
  }
  return prisma.$transaction(fn, { maxWait: 15_000, timeout: 30_000 });
}

export interface CreateOutsourceRequestInput {
  tenantId: string;
  sourceReferenceType?: string; // TRIP_SCHEDULE | SHIPMENT | LIMO_BOOKING | RECOVERY_INCIDENT
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
  closesAt?: Date | string;
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

export interface DeclineQuoteInput {
  requestId: string;
  partnerId: string;
  declineReason: OutsourceDeclineReason;
  declineNotes?: string;
  actorUserId?: string;
}

export interface AwardQuoteInput {
  tenantId: string;
  requestId: string;
  quoteId: string;
  awardedByUserId: string;
  rateCardSnapshot?: RateCardSnapshot;
  ancillaryCharges?: Partial<RateCardAncillaryCharges>;
  commercialModel?: CommercialModel;
  agencySettlementMode?: AgencySettlementMode;
  buyerAgreedPrice?: number;
  platformFeePct?: number;
  ifrs15Indicators?: Ifrs15PrincipalIndicators;
  financePolicyVersion?: string;
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

export interface ContractDirectAwardInput {
  tenantId: string;
  sourceReferenceId: string;
  sourceReferenceType?: string;
  domain?: PartnerServiceDomain;
  vehicleTypeRequired?: string;
  partnerId: string;
  serviceDate: Date | string;
  pickupTime: string;
  pickupLocation: string;
  dropoffLocation: string;
  requiredCapacity?: number;
  agreedPrice: number;
  vatAmount?: number;
  currency?: string;
  awardedByUserId: string;
  rateCardId?: string;
  rateCardVersion?: number;
  ancillaryCharges?: Partial<RateCardAncillaryCharges>;
  commercialModel?: CommercialModel;
  agencySettlementMode?: AgencySettlementMode;
  buyerAgreedPrice?: number;
  platformFeePct?: number;
  ifrs15Indicators?: Ifrs15PrincipalIndicators;
  financePolicyVersion?: string;
}

export class OutsourceEngine {
  /**
   * Create an Outsource Request from Fleet360 Operations
   */
  static async createOutsourceRequest(input: CreateOutsourceRequestInput) {
    const closesAt = input.closesAt
      ? new Date(input.closesAt)
      : new Date(Date.now() + (input.closesInHours || 24) * 60 * 60 * 1000);

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

    const disclosurePayload = DisclosurePolicyService.buildSanitizedDisclosure(
      request.domain,
      request.pickupLocation,
      request.dropoffLocation,
      request.serviceDate,
      request.pickupTime,
      { requiredCapacity: request.requiredCapacity },
    );

    const opportunity = await prisma.marketplaceOpportunity.create({
      data: {
        tenantId: input.tenantId,
        outsourceRequestId: request.id,
        domain: request.domain,
        visibility: OutsourceVisibility.DIRECT,
        status: 'OPEN',
        closesAt,
        disclosurePayload: disclosurePayload as Prisma.InputJsonValue,
        requirementsVersion: 1,
        createdBy: input.createdByUserId,
      },
    });

    await logAudit({
      tenantId: input.tenantId,
      entityType: 'OutsourceRequest',
      entityId: request.id,
      action: 'CREATE',
      details: `Created outsource request ${requestNumber} (${request.pricingMethod}, ${allowedPartnerIds?.length || 0} partner(s) invited)`,
      userId: input.createdByUserId,
    });

    return { ...request, opportunity };
  }

  /**
   * Submit or revise a partner quotation
   */
  static async submitOrReviseQuote(input: SubmitQuoteInput) {
    const request = await prisma.outsourceRequest.findUnique({
      where: { id: input.requestId },
      include: { opportunity: true },
    });

    if (!request) throw new Error('Outsource request not found');

    if (request.opportunity && new Date() > request.opportunity.closesAt) {
      throw new Error(`Quote submission deadline passed on ${request.opportunity.closesAt.toISOString()}`);
    }

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

    await prisma.outsourceRequestPartner.updateMany({
      where: { requestId: input.requestId, partnerId: input.partnerId },
      data: { status: 'QUOTED' },
    });

    if (request.status === OutsourceRequestStatus.PUBLISHED) {
      await prisma.outsourceRequest.update({
        where: { id: request.id },
        data: { status: OutsourceRequestStatus.QUOTED },
      });
    }

    await raiseAlert({
      tenantId: newQuote.request.tenantId,
      code: 'OUTSOURCE_QUOTE_RECEIVED',
      sourceModule: 'exchange',
      subjectType: 'OutsourceRequest' as unknown as AlertSubjectType,
      subjectId: input.requestId,
      title: `💰 Outsource Quote Received: ${newQuote.partner.legalName} (Rev ${revisionNo})`,
      description: `Partner ${newQuote.partner.legalName} quoted AED ${total.toFixed(2)} for ${newQuote.request.requestNumber}.`,
      severity: 'LOW',
      actor: input.actorUserId || newQuote.partner.legalName,
    });

    return newQuote;
  }

  /**
   * Partner declines an RFQ request with a structured reason
   */
  static async declineRequest(input: DeclineQuoteInput) {
    const invite = await prisma.outsourceRequestPartner.findUnique({
      where: {
        requestId_partnerId: {
          requestId: input.requestId,
          partnerId: input.partnerId,
        },
      },
      include: { request: true, partner: true },
    });

    if (!invite) throw new Error('Partner invite not found');

    const updated = await prisma.outsourceRequestPartner.update({
      where: { id: invite.id },
      data: {
        status: 'DECLINED',
        declinedAt: new Date(),
        declineReason: input.declineReason,
        declineNotes: input.declineNotes,
      },
    });

    await logAudit({
      tenantId: invite.request.tenantId,
      entityType: 'OutsourceRequestPartner',
      entityId: invite.id,
      action: 'UPDATE',
      details: `Partner ${input.partnerId} declined RFQ${input.declineReason ? `: ${input.declineReason}` : ''}`,
      userId: input.actorUserId || invite.partner.legalName,
    });

    return updated;
  }

  /**
   * Extend RFQ bidding deadline
   */
  static async extendDeadline(
    requestId: string,
    newDeadline: Date | string,
    tenantId: string,
    userId: string
  ) {
    const opportunity = await prisma.marketplaceOpportunity.findUnique({
      where: { outsourceRequestId: requestId },
    });
    if (!opportunity || opportunity.tenantId !== tenantId) {
      throw new Error('Outsource request opportunity not found');
    }

    const updated = await prisma.marketplaceOpportunity.update({
      where: { id: opportunity.id },
      data: { closesAt: new Date(newDeadline) },
    });

    await logAudit({
      tenantId,
      entityType: 'OutsourceRequest',
      entityId: requestId,
      action: 'UPDATE',
      details: `Deadline extended to ${new Date(newDeadline).toISOString()}`,
      userId,
    });

    return updated;
  }

  /**
   * Award an Outsource Quote (Transaction-Safe, Idempotent on same quoteId, with SHA-256 Rate-Card Snapshot)
   */
  static async awardQuote(input: AwardQuoteInput) {
    return runInExchangeTx(async (tx) => {
      // Serialize concurrent award attempts on the same OutsourceRequest under READ COMMITTED
      // so parallel retries/competing awards never hit P2002 or abort outer RLS transactions.
      if (typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
        await tx
          .$queryRawUnsafe(`SELECT id FROM outsource_requests WHERE id = $1 FOR UPDATE`, input.requestId)
          .catch(() => {});
      }

      const request = await tx.outsourceRequest.findUnique({
        where: { id: input.requestId, tenantId: input.tenantId },
        include: { award: true },
      });

      if (!request) throw new Error('Outsource request not found');

      // Idempotent retry: if already awarded to the exact same quoteId, return existing award
      if (request.award) {
        if (request.award.quoteId === input.quoteId) {
          return request.award;
        }
        throw new Error('Request has already been awarded');
      }

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

      // Build immutable SHA-256 RateCardSnapshot frozen at award time
      const rateCardSnapshot =
        input.rateCardSnapshot ||
        RateCardService.buildImmutableRateCardSnapshot({
          rateCardId: `QUOTE-${quote.id}`,
          version: quote.revisionNo,
          effectiveFrom: request.serviceDate,
          pricingUnit: 'PER_TRIP',
          baseRate: Number(quote.amount),
          minimumCharge: Number(quote.amount),
          currency: quote.currency,
          originZone: request.pickupLocation,
          destinationZone: request.dropoffLocation,
          vehicleType: request.vehicleTypeRequired ?? undefined,
          ancillaryCharges: input.ancillaryCharges,
        });

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
        rateCardSnapshot,
        commercialModel: input.commercialModel || 'AGENCY',
        agencySettlementMode: input.agencySettlementMode || 'PLATFORM_COLLECT_AND_NET_REMIT',
        buyerAgreedPrice: input.buyerAgreedPrice != null ? Number(input.buyerAgreedPrice) : Number(quote.amount),
        platformFeePct: input.platformFeePct != null ? Number(input.platformFeePct) : 3,
        ifrs15Indicators: input.ifrs15Indicators || null,
        financePolicyVersion: input.financePolicyVersion || 'IFRS15-UAE-2026.1',
      };

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
          commercialSnapshot: commercialSnapshot as unknown as Prisma.InputJsonValue,
          awardedBy: input.awardedByUserId,
          status: 'AWARDED',
        },
      });

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

      await tx.outsourceRequestPartner.updateMany({
        where: { requestId: request.id, partnerId: quote.partnerId },
        data: { status: 'AWARDED' },
      });

      await tx.outsourceRequestPartner.updateMany({
        where: {
          requestId: request.id,
          partnerId: { not: quote.partnerId },
          status: { in: ['INVITED', 'VIEWED', 'QUOTED'] },
        },
        data: { status: 'NOT_SELECTED' },
      });

      await tx.outsourceRequest.update({
        where: { id: request.id },
        data: { status: OutsourceRequestStatus.AWARDED },
      });

      await logAuditInTx({
        tenantId: input.tenantId,
        entityType: 'OutsourceAward',
        entityId: award.id,
        action: 'CREATE',
        details: `Awarded request ${request.requestNumber} to partner ${quote.partnerId} for ${Number(quote.totalAmount)}`,
        userId: input.awardedByUserId,
      }, tx);

      return award;
    });
  }

  /**
   * Direct Contract-Rate Award across all 4 vertical domains (PASSENGER_TRANSPORT, FREIGHT, LIMOUSINE, RECOVERY)
   */
  static async createContractDirectAward(input: ContractDirectAwardInput) {
    return runInExchangeTx(async (tx) => {
      const subtotal = Number(input.agreedPrice);
      const vat = input.vatAmount != null ? Number(input.vatAmount) : subtotal * 0.05;
      const total = subtotal + vat;
      const domain = input.domain || PartnerServiceDomain.PASSENGER_TRANSPORT;
      const sourceReferenceType = input.sourceReferenceType || (
        domain === PartnerServiceDomain.FREIGHT
          ? 'SHIPMENT'
          : domain === PartnerServiceDomain.LIMOUSINE
          ? 'LIMO_BOOKING'
          : domain === PartnerServiceDomain.RECOVERY
          ? 'RECOVERY_INCIDENT'
          : 'TRIP_SCHEDULE'
      );

      const partner = await tx.transportPartner.findUnique({
        where: { id: input.partnerId },
      });
      if (!partner) throw new Error('Partner not found');

      const count = await tx.outsourceRequest.count({
        where: { tenantId: input.tenantId },
      });
      const requestNumber = `OUT-CTR-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;

      const request = await tx.outsourceRequest.create({
        data: {
          tenantId: input.tenantId,
          requestNumber,
          domain,
          sourceReferenceType,
          sourceReferenceId: input.sourceReferenceId,
          pricingMethod: OutsourcePricingMethod.CONTRACT_RATE,
          status: OutsourceRequestStatus.AWARDED,
          serviceDate: new Date(input.serviceDate),
          pickupTime: input.pickupTime,
          pickupLocation: input.pickupLocation,
          dropoffLocation: input.dropoffLocation,
          requiredCapacity: input.requiredCapacity || 50,
          vehicleTypeRequired: input.vehicleTypeRequired || '50-Seat Bus',
          invitedPartners: {
            create: [{ partnerId: partner.id, status: 'AWARDED' }],
          },
        },
      });

      const quote = await tx.partnerQuote.create({
        data: {
          requestId: request.id,
          partnerId: partner.id,
          revisionNo: 1,
          amount: subtotal,
          vatAmount: vat,
          totalAmount: total,
          currency: input.currency || 'AED',
          validUntil: new Date(Date.now() + 30 * 86400000),
          status: PartnerQuoteStatus.ACCEPTED,
          notes: 'Direct contracted rate award',
        },
      });

      const rateCardSnapshot = RateCardService.buildImmutableRateCardSnapshot({
        rateCardId: input.rateCardId || `CONTRACT-${partner.id}`,
        version: input.rateCardVersion ?? 1,
        effectiveFrom: input.serviceDate,
        pricingUnit: 'PER_TRIP',
        baseRate: subtotal,
        minimumCharge: subtotal,
        currency: input.currency || 'AED',
        originZone: input.pickupLocation,
        destinationZone: input.dropoffLocation,
        vehicleType: input.vehicleTypeRequired,
        ancillaryCharges: input.ancillaryCharges,
      });

      const commercialSnapshot = {
        requestId: request.id,
        requestNumber: request.requestNumber,
        quoteId: quote.id,
        partnerId: partner.id,
        partnerName: partner.legalName,
        partnerCode: partner.partnerCode,
        domain,
        sourceReferenceType,
        pricingMethod: 'CONTRACT_RATE',
        amount: subtotal,
        vatAmount: vat,
        totalAmount: total,
        currency: input.currency || 'AED',
        serviceDate: new Date(input.serviceDate).toISOString(),
        awardedAt: new Date().toISOString(),
        rateCardSnapshot,
        commercialModel: input.commercialModel || 'AGENCY',
        agencySettlementMode: input.agencySettlementMode || 'PLATFORM_COLLECT_AND_NET_REMIT',
        buyerAgreedPrice: input.buyerAgreedPrice != null ? Number(input.buyerAgreedPrice) : subtotal,
        platformFeePct: input.platformFeePct != null ? Number(input.platformFeePct) : 3,
        ifrs15Indicators: input.ifrs15Indicators || null,
        financePolicyVersion: input.financePolicyVersion || 'IFRS15-UAE-2026.1',
      };

      const award = await tx.outsourceAward.create({
        data: {
          tenantId: input.tenantId,
          requestId: request.id,
          quoteId: quote.id,
          partnerId: partner.id,
          awardedPrice: subtotal,
          vatAmount: vat,
          totalAwarded: total,
          currency: input.currency || 'AED',
          commercialSnapshot: commercialSnapshot as unknown as Prisma.InputJsonValue,
          awardedBy: input.awardedByUserId,
          status: 'AWARDED',
        },
      });

      return award;
    });
  }

  /**
   * Assign Vehicle & Driver with Stage-2 Service-Date Compliance Enforcement Gates
   * and SHA-256 Hashed Driver Execution Token
   */
  static async assignVehicleAndDriver(input: AssignVehicleDriverInput) {
    const award = await prisma.outsourceAward.findUnique({
      where: { id: input.awardId },
      include: {
        partner: {
          include: { complianceDocuments: true },
        },
        request: true,
      },
    });

    if (!award) throw new Error('Award not found');
    if (award.partnerId !== input.partnerId) {
      throw new Error('Partner unauthorized for this award');
    }

    // Effective cutoff: Math.max(now, serviceDate) so documents expiring before future serviceDate are rejected!
    const effectiveCutoff = PreDispatchComplianceGuard.computeEffectiveCutoff(
      award.request?.serviceDate
    );

    // 1. Compliance Gate: Partner Operational Status & Company Documents
    if (award.partner.operationalStatus !== 'ACTIVE') {
      throw new Error(`Partner is not in ACTIVE operational status (current: ${award.partner.operationalStatus})`);
    }

    if (Array.isArray(award.partner.complianceDocuments)) {
      for (const doc of award.partner.complianceDocuments) {
        if (
          (doc.docType === 'TRADE_LICENSE' || doc.docType === 'COMMERCIAL_INSURANCE') &&
          doc.expiryDate &&
          new Date(doc.expiryDate) < effectiveCutoff
        ) {
          throw new Error(
            `Partner ${doc.docType} expired on ${new Date(doc.expiryDate).toLocaleDateString()} before scheduled service date`
          );
        }
      }
    }

    // 2. Compliance Gate: Vehicle Mulkiya against serviceDate cutoff
    if (input.vehicleId) {
      const vehicle = await prisma.partnerVehicle.findUnique({
        where: { id: input.vehicleId },
      });
      if (vehicle) {
        if (!vehicle.isActive) throw new Error(`Vehicle ${vehicle.licensePlate} is inactive`);
        if (vehicle.mulkiyaExpiry && new Date(vehicle.mulkiyaExpiry) < effectiveCutoff) {
          throw new Error(`Vehicle ${vehicle.licensePlate} Mulkiya registration expired on ${new Date(vehicle.mulkiyaExpiry).toLocaleDateString()}`);
        }
      }
    }

    // 3. Compliance Gate: Driver License & Regulatory Permit against serviceDate cutoff
    if (input.driverId) {
      const driver = await prisma.partnerDriver.findUnique({
        where: { id: input.driverId },
      });
      if (driver) {
        if (!driver.isActive) throw new Error(`Driver ${driver.fullName} is inactive`);
        if (driver.licenseExpiry && new Date(driver.licenseExpiry) < effectiveCutoff) {
          throw new Error(`Driver ${driver.fullName} driving license expired on ${new Date(driver.licenseExpiry).toLocaleDateString()}`);
        }
        if (driver.permitExpiry && new Date(driver.permitExpiry) < effectiveCutoff) {
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
      data: { status: 'AWARDED' === award.status ? 'ASSIGNED' : award.status },
    });

    // Automated WhatsApp / SMS Link Dispatch
    let dispatchResult = null;
    try {
      const { DriverDispatchService } = await import('./driver-dispatch-service');
      dispatchResult = await DriverDispatchService.dispatchDriverLink({
        assignmentId: assignment.id,
        driverName: input.driverName,
        driverPhone: input.driverPhone,
        vehiclePlate: input.vehiclePlate,
        pickupLocation: award.request?.pickupLocation || 'Pickup Location',
        pickupTime: award.request?.pickupTime || '07:00',
        dropoffLocation: award.request?.dropoffLocation,
        rawToken,
        channel: 'WHATSAPP',
        actorUserId: input.actorUserId,
      });
    } catch {
      // Graceful fallback if background notification service has local network delay
    }

    return {
      assignment,
      driverSecureUrl: `/track/partner-trip/${rawToken}`,
      rawToken,
      dispatchResult,
    };
  }

  /**
   * Driver execution status milestone updates with strict State Machine
   * and Synchronous Stage-3 Pre-Dispatch Compliance Guard
   * Sequence: ASSIGNED -> REACHED -> STARTED -> COMPLETED / ABORTED
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

    // 1. Strict State Machine Validation: Completed or cancelled trips become strictly read-only
    if (assignment.completedAt || assignment.award.status === 'COMPLETED') {
      throw new Error('Trip is already completed and finalized; further milestone mutations rejected');
    }
    if (assignment.cancelledAt || assignment.award.status === 'CANCELLED') {
      throw new Error('Trip is cancelled; further mutations rejected');
    }
    if (assignment.award.status === 'ABORTED') {
      throw new Error('Trip was aborted due to operational incident; further mutations rejected');
    }

    // 2. Stage-3 Synchronous Pre-Dispatch Compliance Guard on REACHED / STARTED
    if (milestone === 'REACHED' || milestone === 'STARTED') {
      await PreDispatchComplianceGuard.enforcePreDispatchForAssignment(assignment.id);
    }

    const now = new Date();
    const updateData: Prisma.PartnerAssignmentUpdateInput = {};

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

  /**
   * Replace Resource (Vehicle/Driver) with Revision History & Token Rotation
   */
  static async replaceResource(input: {
    awardId: string;
    partnerId: string;
    vehiclePlate: string;
    driverName: string;
    driverPhone: string;
    replacedReason: string;
    actorUserId?: string;
  }) {
    const assignment = await prisma.partnerAssignment.findUnique({
      where: { awardId: input.awardId },
      include: { revisions: true },
    });

    if (!assignment) throw new Error('Assignment not found');
    if (assignment.partnerId !== input.partnerId) throw new Error('Unauthorized partner');

    const nextRevNo = assignment.revisions.length + 1;

    await prisma.partnerAssignmentRevision.create({
      data: {
        assignmentId: assignment.id,
        revisionNo: nextRevNo,
        vehiclePlate: assignment.vehiclePlate || 'UNKNOWN',
        driverName: assignment.driverName || 'UNKNOWN',
        driverPhone: assignment.driverPhone || 'UNKNOWN',
        replacedReason: input.replacedReason,
        replacedBy: input.actorUserId || 'PARTNER_OPERATIONS',
      },
    });

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashDriverToken(rawToken);
    const tokenExp = new Date(Date.now() + 7 * 86400000);

    const updated = await prisma.partnerAssignment.update({
      where: { id: assignment.id },
      data: {
        vehiclePlate: input.vehiclePlate.trim().toUpperCase(),
        driverName: input.driverName.trim(),
        driverPhone: input.driverPhone.trim(),
        driverTokenHash: tokenHash,
        driverTokenExp: tokenExp,
        isTokenRevoked: false,
        updatedAt: new Date(),
      },
    });

    await prisma.partnerTripEvent.create({
      data: {
        assignmentId: assignment.id,
        eventType: 'RESOURCE_SUBSTITUTED',
        actor: input.actorUserId || 'PARTNER_DISPATCH',
        payload: {
          revisionNo: nextRevNo,
          newVehiclePlate: input.vehiclePlate,
          newDriverName: input.driverName,
          reason: input.replacedReason,
        },
      },
    });

    return {
      assignment: updated,
      driverSecureUrl: `/track/partner-trip/${rawToken}`,
      rawToken,
    };
  }

  /**
   * Withdraw a submitted quote before award
   */
  static async withdrawQuote(quoteId: string, partnerId: string, actorUserId?: string) {
    const quote = await prisma.partnerQuote.findUnique({
      where: { id: quoteId, partnerId },
      include: { request: true },
    });

    if (!quote) throw new Error('Quote not found');
    if (quote.status !== PartnerQuoteStatus.SUBMITTED) {
      throw new Error(`Cannot withdraw quote in ${quote.status} status`);
    }

    const updated = await prisma.partnerQuote.update({
      where: { id: quote.id },
      data: { status: PartnerQuoteStatus.WITHDRAWN },
    });

    await logAudit({
      tenantId: quote.request.tenantId,
      entityType: 'PartnerQuote',
      entityId: quote.id,
      action: 'UPDATE',
      details: `Quote withdrawn by partner ${partnerId}`,
      userId: actorUserId || partnerId,
    });

    return updated;
  }

  /**
   * Cancel an awarded trip before departure
   */
  static async cancelAward(awardId: string, tenantId: string, reason: string, actorUserId: string) {
    const award = await prisma.outsourceAward.findUnique({
      where: { id: awardId, tenantId },
      include: { assignment: true },
    });

    if (!award) throw new Error('Award not found');
    if (award.status === 'IN_PROGRESS' || award.status === 'COMPLETED') {
      throw new Error('Cannot cancel a trip that has already started or completed');
    }

    const updated = await prisma.outsourceAward.update({
      where: { id: award.id },
      data: { status: 'CANCELLED' },
    });

    if (award.assignment) {
      await prisma.partnerAssignment.update({
        where: { id: award.assignment.id },
        data: { cancelledAt: new Date(), isTokenRevoked: true },
      });
    }

    await logAudit({
      tenantId,
      entityType: 'OutsourceAward',
      entityId: award.id,
      action: 'UPDATE',
      details: `Award cancelled${reason ? `: ${reason}` : ''}`,
      userId: actorUserId,
    });

    return updated;
  }

  /**
   * Abort a trip due to operational emergency / road accident
   */
  static async abortTrip(awardId: string, reason: string, actorUserId: string) {
    const award = await prisma.outsourceAward.findUnique({
      where: { id: awardId },
      include: { assignment: true },
    });

    if (!award) throw new Error('Award not found');
    if (award.status === 'COMPLETED') {
      throw new Error('Cannot abort a trip that is already completed');
    }

    const updated = await prisma.outsourceAward.update({
      where: { id: award.id },
      data: {
        status: 'ABORTED',
        abortedAt: new Date(),
        abortReason: reason,
      },
    });

    if (award.assignment) {
      await prisma.partnerTripEvent.create({
        data: {
          assignmentId: award.assignment.id,
          eventType: 'TRIP_ABORTED',
          actor: actorUserId || 'DISPATCH',
          payload: { reason },
        },
      });
    }

    return updated;
  }
}
