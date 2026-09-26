/**
 * src/lib/exchange/marketplace-service.ts
 *
 * Phase 3: Private Fleet360 Marketplace Engine.
 * Manages Opportunity publication envelopes, staged disclosure, blind quoting, and post-award relationship formation.
 */

import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { raiseAlert } from '@/lib/alerts/raise';
import { OutsourceVisibility } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { AlertSubjectType } from '@/events/contracts/alert.events';
import { DisclosurePolicyService } from './disclosure-service';
import { OutsourceEngine } from './outsource-engine';

export interface PublishOpportunityInput {
  tenantId: string;
  outsourceRequestId: string;
  visibility?: OutsourceVisibility;
  closesAt?: Date | string;
  createdByUserId: string;
  requirementsPayload?: Record<string, unknown>;
}

export interface AwardMarketplaceOpportunityInput {
  tenantId: string;
  opportunityId: string;
  quoteId: string;
  awardedByUserId: string;
}

export class MarketplaceService {
  /**
   * Publish an OutsourceRequest into the Private Fleet360 Marketplace
   */
  static async publishOpportunity(input: PublishOpportunityInput) {
    const request = await prisma.outsourceRequest.findUnique({
      where: { id: input.outsourceRequestId, tenantId: input.tenantId },
      include: { opportunity: true },
    });

    if (!request) throw new Error('Outsource request not found');
    if (request.opportunity) throw new Error('Request is already published to Marketplace');

    // OutsourceRequest itself has no closesAt column — the deadline is only
    // ever stored on the MarketplaceOpportunity we're about to create, so
    // there's nothing on `request` to fall back to. Default to 24h out,
    // matching OutsourceEngine.createOutsourceRequest's default window.
    const closesAt = input.closesAt
      ? new Date(input.closesAt)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);
    const visibility = input.visibility || OutsourceVisibility.EXCHANGE_NETWORK;

    // Generate Sanitized Disclosure Payload
    const sanitizedPayload = DisclosurePolicyService.buildSanitizedDisclosure(
      request.domain,
      request.pickupLocation,
      request.dropoffLocation,
      request.serviceDate,
      request.pickupTime,
      input.requirementsPayload || { requiredCapacity: request.requiredCapacity }
    );

    const opportunity = await prisma.marketplaceOpportunity.create({
      data: {
        tenantId: input.tenantId,
        outsourceRequestId: request.id,
        domain: request.domain,
        visibility,
        status: 'OPEN',
        closesAt,
        disclosurePayload: sanitizedPayload as Prisma.InputJsonValue,
        requirementsVersion: 1,
        createdBy: input.createdByUserId,
      },
    });

    // Proactive Alert to Marketplace
    await raiseAlert({
      tenantId: input.tenantId,
      code: 'MARKETPLACE_OPPORTUNITY_PUBLISHED',
      sourceModule: 'exchange',
      // AlertSubjectType (@/events/contracts/alert.events) only covers the
      // bus-ops/fleet domain (Vehicle, Driver, TripSchedule, Route, ...) —
      // it has no member for Exchange/Marketplace entities. This same gap
      // repeats as `as any` across most of src/lib/exchange/*.ts
      // (outsource-engine.ts, partner-invoice-service.ts,
      // telematics-service.ts, risk-monitor-service.ts,
      // exception-service.ts, partner-service.ts) — extending the shared
      // union to cover the Exchange domain is a cross-cutting decision
      // beyond this one file, so this keeps the same subjectType value,
      // just as an explicit typed bypass instead of `any`.
      subjectType: 'MarketplaceOpportunity' as unknown as AlertSubjectType,
      subjectId: opportunity.id,
      title: `🌐 Marketplace RFQ Published: ${request.requestNumber} (${request.domain})`,
      description: `Opportunity open for quotes until ${closesAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
      severity: 'LOW',
      actor: input.createdByUserId,
    });

    await logAudit({
      tenantId: input.tenantId,
      entityType: 'MarketplaceOpportunity',
      entityId: opportunity.id,
      action: 'CREATE',
      details: `Published opportunity ${opportunity.id} with visibility ${visibility}`,
      userId: input.createdByUserId,
    }).catch(() => {});

    return opportunity;
  }

  /**
   * Discover Open Opportunities for an Exchange Partner based on domain capability & tenant relationship.
   *
   * Reads across tenants (every buyer's opportunities), so it runs in platform
   * context. Callers must pass a partner resolved from the signed-in user
   * (requirePartnerContext), never one taken from the request. Visibility
   * follows checkQuoteEligibility (@/lib/exchange/partner-auth):
   * EXCHANGE_NETWORK is open to every partner, TENANT_NETWORK to partners with
   * a relationship to the buyer, DIRECT only to invited partners; buyers that
   * BLOCKED the partner are excluded.
   */
  static async listOpportunitiesForPartner(partnerId: string) {
    return withPlatformAdmin(prisma, async (tx) => {
      const partner = await tx.transportPartner.findUnique({
        where: { id: partnerId, deletedAt: null },
        include: {
          capabilities: { where: { isApproved: true } },
          serviceAreas: true,
          tenantRelationships: true,
        },
      });

      if (!partner) throw new Error('Partner not found');
      if (partner.marketplaceStatus !== 'APPROVED') {
        return { opportunities: [], reason: `Marketplace status is ${partner.marketplaceStatus}` };
      }
      if (partner.operationalStatus !== 'ACTIVE') {
        return { opportunities: [], reason: `Operational status is ${partner.operationalStatus}` };
      }

      const partnerDomains = partner.capabilities.map((c) => c.domain);
      const blockedTenantIds = partner.tenantRelationships
        .filter((r) => r.status === 'BLOCKED')
        .map((r) => r.tenantId);
      const networkTenantIds = partner.tenantRelationships
        .filter((r) => r.status !== 'BLOCKED')
        .map((r) => r.tenantId);

      const now = new Date();
      const opportunities = await tx.marketplaceOpportunity.findMany({
        where: {
          status: 'OPEN',
          closesAt: { gt: now },
          domain: { in: partnerDomains },
          tenantId: { notIn: blockedTenantIds },
          OR: [
            { visibility: OutsourceVisibility.EXCHANGE_NETWORK },
            { visibility: OutsourceVisibility.TENANT_NETWORK, tenantId: { in: networkTenantIds } },
            { request: { invitedPartners: { some: { partnerId } } } },
          ],
        },
        // Pre-award view: the sanitized disclosure payload and scheduling
        // fields only. Not tenant_id or created_by — the buyer's identity is
        // concealed until award (DisclosurePolicyService).
        select: {
          id: true,
          outsourceRequestId: true,
          domain: true,
          visibility: true,
          status: true,
          publishedAt: true,
          closesAt: true,
          disclosurePayload: true,
          requirementsVersion: true,
          createdAt: true,
          request: {
            select: {
              requestNumber: true,
              serviceDate: true,
              pickupTime: true,
              pricingMethod: true,
              quotes: {
                where: { partnerId },
                select: { id: true, revisionNo: true, amount: true, totalAmount: true, status: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return { opportunities, partnerDomains };
    });
  }

  /**
   * Award a Marketplace Opportunity and Establish Post-Award TRANSACTIONAL Relationship
   */
  static async awardMarketplaceOpportunity(input: AwardMarketplaceOpportunityInput) {
    const opportunity = await prisma.marketplaceOpportunity.findUnique({
      where: { id: input.opportunityId, tenantId: input.tenantId },
      include: { request: true },
    });

    if (!opportunity) throw new Error('Opportunity not found');

    const quote = await prisma.partnerQuote.findUnique({
      where: { id: input.quoteId },
      include: { partner: true },
    });

    if (!quote) throw new Error('Quote not found');

    // 1. Award via canonical OutsourceEngine
    const award = await OutsourceEngine.awardQuote({
      tenantId: input.tenantId,
      requestId: opportunity.outsourceRequestId,
      quoteId: input.quoteId,
      awardedByUserId: input.awardedByUserId,
    });

    // 2. Post-Award Relationship Formation: Create TRANSACTIONAL relationship if none existed
    const existingRel = await prisma.tenantPartnerRelationship.findUnique({
      where: {
        tenantId_partnerId: {
          tenantId: input.tenantId,
          partnerId: quote.partnerId,
        },
      },
    });

    if (!existingRel) {
      await prisma.tenantPartnerRelationship.create({
        data: {
          tenantId: input.tenantId,
          partnerId: quote.partnerId,
          status: 'TRANSACTIONAL',
          commercialNotes: `Established automatically upon Marketplace Award for request ${opportunity.request.requestNumber}`,
        },
      });
    }

    // 3. Close Opportunity
    const updatedOpp = await prisma.marketplaceOpportunity.update({
      where: { id: opportunity.id },
      data: { status: 'AWARDED' },
    });

    return { award, opportunity: updatedOpp };
  }
}
