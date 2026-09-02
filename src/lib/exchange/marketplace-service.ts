/**
 * src/lib/exchange/marketplace-service.ts
 *
 * Phase 3: Private Fleet360 Marketplace Engine.
 * Manages Opportunity publication envelopes, staged disclosure, blind quoting, and post-award relationship formation.
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { raiseAlert } from '@/lib/alerts/raise';
import { OutsourceVisibility, PartnerServiceDomain } from '@prisma/client';
import { DisclosurePolicyService } from './disclosure-service';
import { OutsourceEngine } from './outsource-engine';

export interface PublishOpportunityInput {
  tenantId: string;
  outsourceRequestId: string;
  visibility?: OutsourceVisibility;
  closesAt?: Date | string;
  createdByUserId: string;
  requirementsPayload?: Record<string, any>;
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

    const closesAt = input.closesAt ? new Date(input.closesAt) : request.closesAt;
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
        disclosurePayload: sanitizedPayload,
        requirementsVersion: 1,
        createdBy: input.createdByUserId,
      },
    });

    // Proactive Alert to Marketplace
    await raiseAlert({
      tenantId: input.tenantId,
      code: 'MARKETPLACE_OPPORTUNITY_PUBLISHED',
      sourceModule: 'exchange',
      subjectType: 'MarketplaceOpportunity' as any,
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
   * Discover Open Opportunities for an Exchange Partner based on domain capability & tenant relationship
   */
  static async listOpportunitiesForPartner(partnerId: string) {
    const partner = await prisma.transportPartner.findUnique({
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
    const blockedTenantIds = new Set(
      partner.tenantRelationships
        .filter((r) => r.status === 'BLOCKED')
        .map((r) => r.tenantId)
    );

    const now = new Date();
    const opportunities = await prisma.marketplaceOpportunity.findMany({
      where: {
        status: 'OPEN',
        closesAt: { gt: now },
        domain: { in: partnerDomains },
        tenantId: { notIn: Array.from(blockedTenantIds) },
        visibility: { in: [OutsourceVisibility.EXCHANGE_NETWORK, OutsourceVisibility.TENANT_NETWORK] },
      },
      include: {
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
          notes: `Established automatically upon Marketplace Award for request ${opportunity.request.requestNumber}`,
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
