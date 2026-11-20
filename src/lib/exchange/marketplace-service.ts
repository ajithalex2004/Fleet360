/**
 * src/lib/exchange/marketplace-service.ts
 *
 * Phase 3 + Phase 1 Governance: Private Fleet360 Marketplace Engine.
 * Manages Opportunity publication envelopes, staged disclosure, blind quoting,
 * 3-Mode Network Policy (CLOSED | PREFERRED | EXTENDED), Preferred Exclusive Window,
 * Platform Kill Switch, and post-award relationship formation.
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
import { EXCHANGE_OPEN_MARKET, isActivated } from './partner-activation';
import { NetworkPolicyService } from './network-policy-service';

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
    await NetworkPolicyService.hydrateFromDatabaseIfStale(true);
    if (NetworkPolicyService.isPlatformKillSwitchActive()) {
      throw new Error('The Private Partner Exchange is currently suspended by platform governance.');
    }

    const request = await prisma.outsourceRequest.findUnique({
      where: { id: input.outsourceRequestId, tenantId: input.tenantId },
      include: { opportunity: true },
    });

    if (!request) throw new Error('Outsource request not found');
    if (
      request.opportunity &&
      request.opportunity.visibility !== OutsourceVisibility.DIRECT &&
      request.opportunity.status === 'OPEN'
    ) {
      throw new Error('Request is already published to Marketplace');
    }

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

    const opportunity = request.opportunity
      ? await prisma.marketplaceOpportunity.update({
          where: { id: request.opportunity.id },
          data: {
            visibility,
            status: 'OPEN',
            publishedAt: new Date(),
            closesAt,
            disclosurePayload: sanitizedPayload as Prisma.InputJsonValue,
          },
        })
      : await prisma.marketplaceOpportunity.create({
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

    await raiseAlert({
      tenantId: input.tenantId,
      code: 'MARKETPLACE_OPPORTUNITY_PUBLISHED',
      sourceModule: 'exchange',
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
   */
  static async listOpportunitiesForPartner(partnerId: string) {
    await NetworkPolicyService.hydrateFromDatabaseIfStale(true);
    if (NetworkPolicyService.isPlatformKillSwitchActive()) {
      return {
        opportunities: [],
        reason: 'The Private Partner Exchange is currently suspended by platform governance.',
      };
    }

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
      if (!isActivated(partner)) {
        return { opportunities: [], reason: 'Partner is not activated yet' };
      }
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

      const sharingConsents = NetworkPolicyService.getPartnerSharingConsents(partnerId);
      const openOrConsortium =
        EXCHANGE_OPEN_MARKET || sharingConsents.some((c) => c.allowQualificationDiscovery);

      const now = new Date();
      const opportunities = await tx.marketplaceOpportunity.findMany({
        where: {
          status: 'OPEN',
          closesAt: { gt: now },
          domain: { in: partnerDomains },
          tenantId: { notIn: blockedTenantIds },
          OR: [
            openOrConsortium
              ? { visibility: OutsourceVisibility.EXCHANGE_NETWORK }
              : { visibility: OutsourceVisibility.EXCHANGE_NETWORK, tenantId: { in: networkTenantIds } },
            { visibility: OutsourceVisibility.TENANT_NETWORK, tenantId: { in: networkTenantIds } },
            { request: { invitedPartners: { some: { partnerId } } } },
          ],
        },
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

      // Enforce PREFERRED Exclusive Quotation Window if any returned opportunity carries buyer tenant metadata
      const relMap = new Map(
        partner.tenantRelationships.map((r) => [r.tenantId, r.status as string])
      );
      const hasPreferredRelationship = partner.tenantRelationships.some(
        (r) => r.status === 'PREFERRED'
      );
      const partnerServiceAreas = (partner.serviceAreas || []).map((sa) => {
        const rec = sa as unknown as Record<string, unknown>;
        const zones = Array.isArray(sa.zones) ? sa.zones : [];
        const zoneName =
          typeof rec.zoneName === 'string' && rec.zoneName.trim()
            ? rec.zoneName.trim()
            : zones.length > 0
            ? zones.join(', ')
            : null;
        return {
          emirate: String(sa.emirate || '').toUpperCase(),
          zoneName,
        };
      });
      const partnerRecord = partner as unknown as Record<string, unknown>;
      const homeEmirate =
        typeof partnerRecord.emirate === 'string' && partnerRecord.emirate.trim()
          ? partnerRecord.emirate.trim().toUpperCase()
          : null;

      // ARCH-3: Resolve buyer tenantId internally for Preferred Exclusive Window evaluation
      // without exposing tenantId in the MarketplaceOpportunity select or response payload.
      const requestTenantMap = new Map<string, string>();
      const missingRequestIds = opportunities
        .filter((opp) => typeof (opp as unknown as Record<string, unknown>).tenantId !== 'string')
        .map((opp) => opp.outsourceRequestId)
        .filter(Boolean);

      if (missingRequestIds.length > 0 && tx.outsourceRequest?.findMany) {
        const reqRows = await tx.outsourceRequest
          .findMany({
            where: { id: { in: missingRequestIds } },
            select: { id: true, tenantId: true },
          })
          .catch(() => [] as Array<{ id: string; tenantId: string }>);
        for (const r of reqRows) {
          if (r?.id && r?.tenantId) requestTenantMap.set(r.id, r.tenantId);
        }
      }

      const resolveBuyerTenantId = (opp: (typeof opportunities)[number]): string | null => {
        const oppRecord = opp as unknown as Record<string, unknown>;
        if (typeof oppRecord.tenantId === 'string' && oppRecord.tenantId) {
          return oppRecord.tenantId;
        }
        return requestTenantMap.get(opp.outsourceRequestId) ?? null;
      };

      const filteredOpportunities = opportunities.filter((opp) => {
        const buyerTenantId = resolveBuyerTenantId(opp);
        if (!buyerTenantId) return true;
        const relStatus = relMap.get(buyerTenantId) ?? null;
        const windowCheck = NetworkPolicyService.isHeldInPreferredExclusiveWindow({
          buyerTenantId,
          publishedAt: (opp.publishedAt as Date | string) || (opp.createdAt as Date | string) || now,
          relationshipStatus: relStatus,
          asOf: now,
        });
        return !windowCheck.blocked;
      });

      const enrichedOpportunities = filteredOpportunities.map((opp) => {
        const sanitizedOpp: Record<string, unknown> = { ...(opp as unknown as Record<string, unknown>) };
        delete sanitizedOpp.tenantId;
        const buyerTenantId = resolveBuyerTenantId(opp);
        const buyerRelStatus = buyerTenantId ? relMap.get(buyerTenantId) ?? null : null;
        const isPreferredForBuyer = buyerTenantId
          ? buyerRelStatus === 'PREFERRED'
          : hasPreferredRelationship;
        const buyerPolicy = buyerTenantId
          ? NetworkPolicyService.getTenantPolicy(buyerTenantId)
          : null;
        const windowMinutes =
          buyerPolicy && buyerPolicy.preferredExclusiveWindowMinutes > 0
            ? buyerPolicy.preferredExclusiveWindowMinutes
            : 30;

        const disclosure = (opp.disclosurePayload || {}) as Record<string, unknown>;
        const pickupText = String(disclosure.pickupZone || '').toLowerCase();
        const dropoffText = String(disclosure.dropoffZone || '').toLowerCase();
        const combinedZones = `${pickupText} ${dropoffText}`;

        const candidateEmirates = new Set<string>(
          partnerServiceAreas.map((sa) => sa.emirate).filter(Boolean)
        );
        if (homeEmirate) candidateEmirates.add(homeEmirate);

        let matchedZoneLabel: string | null = null;
        for (const sa of partnerServiceAreas) {
          if (sa.zoneName && combinedZones.includes(sa.zoneName.toLowerCase())) {
            matchedZoneLabel = `${sa.emirate.replace(/_/g, ' ')} (${sa.zoneName})`;
            break;
          }
        }
        if (!matchedZoneLabel) {
          for (const em of candidateEmirates) {
            const readable = em.replace(/_/g, ' ').toLowerCase();
            if (
              combinedZones.includes(readable) ||
              (em === 'DUBAI' && (combinedZones.includes('dxb') || combinedZones.includes('jebel ali') || combinedZones.includes('difc'))) ||
              (em === 'ABU_DHABI' && (combinedZones.includes('auh') || combinedZones.includes('mussafah') || combinedZones.includes('yas'))) ||
              (em === 'SHARJAH' && combinedZones.includes('shj'))
            ) {
              matchedZoneLabel = em.replace(/_/g, ' ');
              break;
            }
          }
        }

        const emirateMatch =
          candidateEmirates.size === 0 ? true : matchedZoneLabel !== null;

        const pubDate = new Date(
          (opp.publishedAt as Date | string) || (opp.createdAt as Date | string) || now
        );
        const exclusiveEndsAtMs = pubDate.getTime() + windowMinutes * 60 * 1000;
        const exclusiveWindowActive =
          isPreferredForBuyer && exclusiveEndsAtMs > now.getTime();

        return {
          ...(sanitizedOpp as unknown as typeof opp),
          emirateMatch,
          matchedZoneLabel,
          preferredWindow: {
            isPreferredPartner: isPreferredForBuyer,
            exclusiveWindowActive,
            exclusiveWindowEndsAt: exclusiveWindowActive
              ? new Date(exclusiveEndsAtMs).toISOString()
              : null,
          },
        };
      });

      return {
        opportunities: enrichedOpportunities,
        partnerDomains,
        partnerServiceAreas,
        hasPreferredRelationship,
      };
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

  /**
   * ARCH-2 (Phase 16): Automated Expired RFQ Opportunity & Quote Sweeper.
   * Transitions OPEN opportunities whose closesAt <= now to EXPIRED and raises
   * an operational alert if an opportunity expires with 0 quotes.
   */
  static async sweepExpiredOpportunities(params?: {
    tenantId?: string;
    now?: Date;
    actorUserId?: string;
  }): Promise<{
    sweptCount: number;
    expiredOpportunityIds: string[];
    zeroQuoteOpportunityIds: string[];
  }> {
    const now = params?.now ? new Date(params.now) : new Date();
    const actor = params?.actorUserId || 'SYSTEM_SLA_SWEEPER';

    const openExpired = prisma.marketplaceOpportunity?.findMany
      ? await prisma.marketplaceOpportunity
          .findMany({
            where: {
              status: 'OPEN',
              closesAt: { lte: now },
              ...(params?.tenantId ? { tenantId: params.tenantId } : {}),
            },
            include: {
              request: {
                include: {
                  quotes: true,
                },
              },
            },
          })
          .catch(() => [])
      : [];

    const expiredOpportunityIds: string[] = [];
    const zeroQuoteOpportunityIds: string[] = [];

    for (const opp of openExpired) {
      await prisma.marketplaceOpportunity
        .update({
          where: { id: opp.id },
          data: { status: 'EXPIRED' },
        })
        .catch(() => {});

      expiredOpportunityIds.push(opp.id);

      const activeQuotes = Array.isArray(opp.request?.quotes) ? opp.request.quotes : [];
      if (activeQuotes.length === 0) {
        zeroQuoteOpportunityIds.push(opp.id);
        await raiseAlert({
          tenantId: opp.tenantId,
          code: 'MARKETPLACE_OPPORTUNITY_EXPIRED',
          sourceModule: 'exchange',
          subjectType: 'MarketplaceOpportunity' as unknown as AlertSubjectType,
          subjectId: opp.id,
          title: `⏰ Marketplace RFQ Expired With 0 Quotes: ${opp.request?.requestNumber || opp.id}`,
          description: `Bidding window closed at ${new Date(opp.closesAt).toISOString()} with no partner quotes submitted. Consider extending the window or direct-awarding via contracted rate card.`,
          severity: 'MEDIUM',
          actor,
        }).catch(() => {});
      }

      await logAudit({
        tenantId: opp.tenantId,
        entityType: 'MarketplaceOpportunity',
        entityId: opp.id,
        action: 'UPDATE',
        details: `Automated sweeper transitioned expired OPEN opportunity ${opp.id} to EXPIRED (${activeQuotes.length} quotes submitted)`,
        userId: actor,
      }).catch(() => {});
    }

    return {
      sweptCount: expiredOpportunityIds.length,
      expiredOpportunityIds,
      zeroQuoteOpportunityIds,
    };
  }
}
