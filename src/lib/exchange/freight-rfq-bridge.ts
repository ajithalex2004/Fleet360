/**
 * src/lib/exchange/freight-rfq-bridge.ts
 *
 * Phase 3 (P1): Canonical Freight RFQ Unification Bridge.
 *
 * Implements Insight 1 from the Private Partner Exchange Architecture Blueprint:
 * - Preserves the domain-specific Freight Load Board models (`logistics_freight_rfqs`,
 *   `logistics_carrier_bids`, `logistics_shipment_orders`, `logistics_cargo_lines`)
 *   where they hold rich cargo/hazmat/container/customs semantics.
 * - Synchronizes Freight RFQs, Carrier Bids, and Awards into the single canonical
 *   Exchange transaction lifecycle:
 *     OutsourceRequest -> MarketplaceOpportunity -> PartnerQuote -> OutsourceAward
 * - Ensures every Freight transaction receives:
 *     1. Staged information disclosure (`DisclosurePolicyService`)
 *     2. 3-Stage Synchronous Pre-Dispatch Compliance Guard (`PreDispatchComplianceGuard`)
 *     3. Immutable SHA-256 `RateCardSnapshot` frozen at award (`RateCardService`)
 *     4. 3-Way Financial Reconciliation (`SettlementReconciliationService`)
 *     5. Spread/Commission & IFRS 15 General Ledger Accounting (`ExchangeCommercialLedgerService`)
 */

import { prisma } from '@/lib/prisma';
import {
  OutsourcePricingMethod,
  OutsourceVisibility,
  PartnerServiceDomain,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { FreightOutsourcingAdapter } from './adapters/freight-adapter';
import { OutsourceEngine } from './outsource-engine';
import { DisclosurePolicyService } from './disclosure-service';
import type {
  CommercialModel,
  AgencySettlementMode,
  Ifrs15PrincipalIndicators,
} from './commercial-ledger-service';
import type { RateCardAncillaryCharges } from './rate-card-service';

export interface BridgeFreightRfqInput {
  tenantId: string;
  rfqId?: string;
  rfqNo?: string | null;
  shipmentOrderId: string;
  inviteScope?: 'SELECTED_CARRIERS' | 'ALL_ACTIVE_CARRIERS' | string | null;
  invitedCarrierIds?: string[];
  bidDeadlineAt?: Date | string | null;
  createdByUserId?: string;
}

export interface BridgeCarrierBidInput {
  tenantId: string;
  rfqId?: string | null;
  bidId?: string;
  shipmentOrderId: string;
  carrierId: string;
  amount: number;
  vatAmount?: number;
  currency?: string;
  validityUntil?: Date | string | null;
  proposedVehicleId?: string;
  proposedDriverId?: string;
  notes?: string | null;
  canonicalRequestId?: string;
  actorUserId?: string;
}

export interface BridgeFreightAwardInput {
  tenantId: string;
  rfqId: string;
  bidId: string;
  shipmentOrderId: string;
  carrierId: string;
  amount: number;
  vatAmount?: number;
  currency?: string;
  canonicalRequestId?: string;
  canonicalQuoteId?: string;
  awardedByUserId: string;
  ancillaryCharges?: Partial<RateCardAncillaryCharges>;
  commercialModel?: CommercialModel;
  agencySettlementMode?: AgencySettlementMode;
  buyerAgreedPrice?: number;
  platformFeePct?: number;
  ifrs15Indicators?: Ifrs15PrincipalIndicators;
  financePolicyVersion?: string;
}

export class FreightRfqCanonicalBridge {
  private static adapter = new FreightOutsourcingAdapter();

  /**
   * 1. Bridge a Freight Load Board RFQ (`logistics_freight_rfqs`) into a canonical
   *    Exchange `OutsourceRequest` + `MarketplaceOpportunity`.
   */
  static async bridgeFreightRfqToCanonicalExchange(input: BridgeFreightRfqInput) {
    const source = await this.adapter.getSourceReference(input.shipmentOrderId, input.tenantId);
    const requirementsPayload = await this.adapter.buildRequirementsPayload(source);

    const closesAt = input.bidDeadlineAt
      ? new Date(input.bidDeadlineAt)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);

    const created = await OutsourceEngine.createOutsourceRequest({
      tenantId: input.tenantId,
      sourceReferenceType: 'FREIGHT_SHIPMENT',
      sourceReferenceId: input.shipmentOrderId,
      domain: PartnerServiceDomain.FREIGHT,
      pricingMethod: OutsourcePricingMethod.RFQ,
      serviceDate: source.serviceDate,
      pickupTime: source.pickupTime,
      pickupLocation: source.pickupLocation,
      pickupLatitude: source.pickupLatitude,
      pickupLongitude: source.pickupLongitude,
      dropoffLocation: source.dropoffLocation,
      dropoffLatitude: source.dropoffLatitude,
      dropoffLongitude: source.dropoffLongitude,
      requiredCapacity: Math.max(1, Math.round(Number(requirementsPayload.palletCount || 1))),
      vehicleTypeRequired: String(requirementsPayload.bodyType || 'BOX_TRUCK'),
      specialInstructions: source.specialInstructions,
      closesAt,
      invitedPartnerIds: input.invitedCarrierIds,
      createdByUserId: input.createdByUserId || 'FREIGHT_MARKETPLACE',
    });

    const visibility =
      input.inviteScope === 'ALL_ACTIVE_CARRIERS'
        ? OutsourceVisibility.TENANT_NETWORK
        : OutsourceVisibility.DIRECT;

    const disclosurePayload = DisclosurePolicyService.buildSanitizedDisclosure(
      PartnerServiceDomain.FREIGHT,
      source.pickupLocation,
      source.dropoffLocation,
      source.serviceDate,
      source.pickupTime,
      {
        ...requirementsPayload,
        freightRfqId: input.rfqId ?? null,
        freightRfqNo: input.rfqNo ?? null,
      },
    );

    const updatedOpportunity = await prisma.marketplaceOpportunity.update({
      where: { id: created.opportunity.id },
      data: {
        visibility,
        disclosurePayload: disclosurePayload as Prisma.InputJsonValue,
      },
    });

    return {
      canonicalRequestId: created.id,
      canonicalOpportunityId: updatedOpportunity.id,
      requestNumber: created.requestNumber,
      visibility: updatedOpportunity.visibility,
      disclosurePayload,
    };
  }

  /**
   * 2. Bridge a Freight Carrier Bid (`logistics_carrier_bids`) into a canonical
   *    Exchange `PartnerQuote`.
   */
  static async bridgeCarrierBidToCanonicalQuote(input: BridgeCarrierBidInput) {
    let requestId = input.canonicalRequestId;

    if (!requestId) {
      const existingReq = await prisma.outsourceRequest.findFirst({
        where: {
          tenantId: input.tenantId,
          domain: PartnerServiceDomain.FREIGHT,
          sourceReferenceId: input.shipmentOrderId,
        },
        orderBy: { createdAt: 'desc' },
      });
      requestId = existingReq?.id;
    }

    if (!requestId) {
      const bridged = await this.bridgeFreightRfqToCanonicalExchange({
        tenantId: input.tenantId,
        rfqId: input.rfqId ?? undefined,
        shipmentOrderId: input.shipmentOrderId,
        invitedCarrierIds: [input.carrierId],
      });
      requestId = bridged.canonicalRequestId;
    }

    let validHours = 48;
    if (input.validityUntil) {
      const diffMs = new Date(input.validityUntil).getTime() - Date.now();
      if (diffMs > 0) {
        validHours = Math.max(1, Math.round(diffMs / (60 * 60 * 1000)));
      }
    }

    const quote = await OutsourceEngine.submitOrReviseQuote({
      requestId,
      partnerId: input.carrierId,
      amount: Number(input.amount),
      vatAmount: input.vatAmount,
      currency: input.currency || 'AED',
      validHours,
      proposedVehicleId: input.proposedVehicleId,
      proposedDriverId: input.proposedDriverId,
      notes: input.notes || (input.bidId ? `Bridged from Freight Bid ${input.bidId}` : undefined),
      actorUserId: input.actorUserId || input.carrierId,
    });

    return {
      canonicalRequestId: requestId,
      canonicalQuoteId: quote.id,
      revisionNo: quote.revisionNo,
      totalAmount: Number(quote.totalAmount),
    };
  }

  /**
   * 3. Bridge a Freight RFQ Award (`awardCarrierBid`) into a canonical Exchange
   *    `OutsourceAward` with frozen SHA-256 `RateCardSnapshot` and commercial model.
   */
  static async bridgeFreightAwardToCanonicalAward(input: BridgeFreightAwardInput) {
    let requestId = input.canonicalRequestId;
    let quoteId = input.canonicalQuoteId;

    if (!requestId) {
      const existingReq = await prisma.outsourceRequest.findFirst({
        where: {
          tenantId: input.tenantId,
          domain: PartnerServiceDomain.FREIGHT,
          sourceReferenceId: input.shipmentOrderId,
        },
        orderBy: { createdAt: 'desc' },
      });
      requestId = existingReq?.id;
    }

    if (!requestId || !quoteId) {
      const bridgedQuote = await this.bridgeCarrierBidToCanonicalQuote({
        tenantId: input.tenantId,
        rfqId: input.rfqId,
        bidId: input.bidId,
        shipmentOrderId: input.shipmentOrderId,
        carrierId: input.carrierId,
        amount: input.amount,
        vatAmount: input.vatAmount,
        currency: input.currency,
        canonicalRequestId: requestId,
        actorUserId: input.awardedByUserId,
      });
      requestId = bridgedQuote.canonicalRequestId;
      quoteId = bridgedQuote.canonicalQuoteId;
    }

    const award = await OutsourceEngine.awardQuote({
      tenantId: input.tenantId,
      requestId,
      quoteId,
      awardedByUserId: input.awardedByUserId,
      ancillaryCharges: input.ancillaryCharges,
      commercialModel: input.commercialModel,
      agencySettlementMode: input.agencySettlementMode,
      buyerAgreedPrice: input.buyerAgreedPrice,
      platformFeePct: input.platformFeePct,
      ifrs15Indicators: input.ifrs15Indicators,
      financePolicyVersion: input.financePolicyVersion,
    });

    await this.adapter.applyAward({
      tenantId: input.tenantId,
      partnerId: input.carrierId,
      requestId,
      sourceReferenceId: input.shipmentOrderId,
      totalAwarded: award.totalAwarded,
      awardedBy: input.awardedByUserId,
    });

    const snap = (award.commercialSnapshot || {}) as Record<string, unknown>;

    return {
      canonicalAwardId: award.id,
      canonicalRequestId: requestId,
      canonicalQuoteId: quoteId,
      totalAwarded: Number(award.totalAwarded),
      rateCardSnapshot: snap.rateCardSnapshot,
      commercialSnapshot: snap,
    };
  }

  /**
   * 4. ARCH-4 (Phase 17): Canonical Read-Path View Adapter for Freight RFQs.
   * Projects canonical Exchange `PartnerQuote` rows into the Freight Load Board
   * Bid view shape and merges them with any legacy `logistics_carrier_bids` rows.
   */
  static async mergeCanonicalQuotesIntoFreightBids<T extends Record<string, unknown>>(params: {
    tenantId: string;
    rfqId: string;
    legacyBids: T[];
  }): Promise<T[]> {
    const legacyList = Array.isArray(params.legacyBids) ? [...params.legacyBids] : [];
    try {
      if (!prisma.outsourceRequest?.findMany) return legacyList;

      const canonicalRequests = await prisma.outsourceRequest.findMany({
        where: {
          tenantId: params.tenantId,
          domain: PartnerServiceDomain.FREIGHT,
        },
        include: {
          opportunity: true,
          quotes: {
            include: {
              partner: true,
            },
            orderBy: { amount: 'asc' },
          },
        },
        take: 50,
      });

      let linkedShipmentId: string | null = null;
      if (typeof (prisma as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
        const rfqRows = await prisma
          .$queryRawUnsafe<Array<{ shipment_order_id: string | null }>>(
            `SELECT shipment_order_id FROM logistics_freight_rfqs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
            params.rfqId,
            params.tenantId,
          )
          .catch(() => []);
        linkedShipmentId = rfqRows[0]?.shipment_order_id ?? null;
      }

      const matchingReq = canonicalRequests.find((r) => {
        const disc = (r.opportunity?.disclosurePayload || {}) as Record<string, unknown>;
        return (
          disc.freightRfqId === params.rfqId ||
          r.sourceReferenceId === params.rfqId ||
          (linkedShipmentId !== null && r.sourceReferenceId === linkedShipmentId) ||
          r.id === params.rfqId
        );
      });

      if (!matchingReq || !Array.isArray(matchingReq.quotes) || matchingReq.quotes.length === 0) {
        return legacyList;
      }

      const existingCarrierAmounts = new Set(
        legacyList.map((b) => `${String(b.carrierId || '')}:${Number(b.amount || 0).toFixed(2)}`)
      );

      for (const q of matchingReq.quotes) {
        if (q.status === 'SUPERSEDED' || q.status === 'WITHDRAWN') continue;
        const dedupKey = `${q.partnerId}:${Number(q.amount).toFixed(2)}`;
        if (existingCarrierAmounts.has(dedupKey)) continue;

        legacyList.push({
          id: q.id,
          carrierId: q.partnerId,
          carrierName: q.partner?.legalName || q.partnerId,
          bidNo: `EXQ-${q.id.slice(0, 6).toUpperCase()}-R${q.revisionNo}`,
          amount: Number(q.amount),
          vatAmount: Number(q.vatAmount),
          totalAmount: Number(q.totalAmount),
          currency: q.currency || 'AED',
          transitTimeHours: null,
          validityUntil: q.validUntil ? new Date(q.validUntil).toISOString() : null,
          status: q.status,
          notes: q.notes || `Canonical Exchange Quote (Rev ${q.revisionNo})`,
          canonicalQuoteId: q.id,
          canonicalRequestId: matchingReq.id,
          revisionNo: q.revisionNo,
        } as unknown as T);
      }

      return legacyList.sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0));
    } catch {
      return legacyList;
    }
  }
}
