import { requireBusOpsRequest } from '@/lib/bus-ops/access';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { OutsourceEngine } from '@/lib/exchange/outsource-engine';
import { MarketplaceService } from '@/lib/exchange/marketplace-service';
import { BusOpsOutsourcingAdapter } from '@/lib/exchange/bus-ops-adapter';
import { LimousineOutsourcingAdapter } from '@/lib/exchange/adapters/limo-adapter';
import { RecoveryOutsourcingAdapter } from '@/lib/exchange/adapters/recovery-adapter';
import { FreightOutsourcingAdapter } from '@/lib/exchange/adapters/freight-adapter';
import { PartnerInvoiceService } from '@/lib/exchange/partner-invoice-service';
import { PartnerServiceDomain } from '@prisma/client';

export const runtime = 'nodejs';

/**
 * GET /api/bus-ops/outsource?tripId=... | ?mode=marketplace&domain=ALL|PASSENGER_TRANSPORT|LIMOUSINE|RECOVERY
 * POST /api/bus-ops/outsource
 */
export async function GET(req: NextRequest) {
  const policyError = await requireBusOpsRequest(req);
  if (policyError) return policyError;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const { searchParams } = new URL(req.url);
  const tripId = searchParams.get('tripId');
  const domainParam = searchParams.get('domain');

  return withTenantRls(prisma, tenantId, async () => {
    const targetDomains: PartnerServiceDomain[] =
      domainParam === 'LIMOUSINE'
        ? [PartnerServiceDomain.LIMOUSINE]
        : domainParam === 'PASSENGER_TRANSPORT'
          ? [PartnerServiceDomain.PASSENGER_TRANSPORT]
          : domainParam === 'RECOVERY'
            ? [PartnerServiceDomain.RECOVERY]
            : [
                PartnerServiceDomain.PASSENGER_TRANSPORT,
                PartnerServiceDomain.LIMOUSINE,
                PartnerServiceDomain.RECOVERY,
              ];

    // 1. Fetch approved transport partners for Bus & Limousine
    const approvedPartners = await prisma.transportPartner.findMany({
      where: {
        operationalStatus: 'ACTIVE',
        deletedAt: null,
        capabilities: {
          some: { domain: { in: targetDomains } },
        },
      },
      select: {
        id: true,
        legalName: true,
        partnerCode: true,
        primaryContactPhone: true,
        city: true,
        capabilities: {
          select: {
            domain: true,
          },
        },
      },
      orderBy: { legalName: 'asc' },
    });

    let existingRequest = null;
    if (tripId) {
      existingRequest = await prisma.outsourceRequest.findFirst({
        where: {
          tenantId,
          sourceReferenceId: tripId,
        },
        include: {
          invitedPartners: { include: { partner: true } },
          quotes: { include: { partner: true } },
          opportunity: true,
          award: {
            include: {
              partner: true,
              assignment: true,
              invoice: true,
            },
          },
        },
      });

      return NextResponse.json({
        approvedPartners,
        outsourceRequest: existingRequest,
      });
    }

    // 2. Operator Marketplace mode: load all Bus & Limousine OutsourceRequests for this tenant
    const requests = await prisma.outsourceRequest.findMany({
      where: {
        tenantId,
        domain: { in: targetDomains },
      },
      include: {
        invitedPartners: {
          include: {
            partner: {
              select: { id: true, legalName: true, partnerCode: true, city: true, primaryContactPhone: true },
            },
          },
        },
        quotes: {
          include: {
            partner: {
              select: { id: true, legalName: true, partnerCode: true, city: true, primaryContactPhone: true },
            },
          },
          orderBy: { amount: 'asc' },
        },
        opportunity: true,
        award: {
          include: {
            partner: {
              select: { id: true, legalName: true, partnerCode: true, city: true, primaryContactPhone: true },
            },
            assignment: {
              include: {
                pod: true,
                events: {
                  orderBy: { occurredAt: 'desc' },
                  take: 20,
                },
              },
            },
            invoice: {
              include: { items: true, disputes: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // 3. Postable Bus Trips (TripSchedule)
    const postableBusTrips = await prisma.tripSchedule.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: { in: ['SCHEDULED', 'PLANNED', 'PENDING'] },
      },
      include: {
        route: true,
      },
      orderBy: { departureTime: 'asc' },
      take: 50,
    }).catch(() => []);

    // 4. Postable Limousine / Chauffeur / Passenger Bookings
    const postableLimoBookings = await prisma.booking.findMany({
      where: {
        tenantId,
        status: { in: ['PENDING', 'CONFIRMED', 'APPROVED'] },
      },
      orderBy: { startDate: 'desc' },
      take: 50,
    }).catch(() => []);

    // 5. Postable Roadside Breakdown Reports (Recovery & Towing)
    const postableBreakdowns = await prisma.breakdownReport.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: { in: ['REPORTED', 'ACKNOWLEDGED', 'RECOVERY_PENDING'] },
      },
      orderBy: { reportedAt: 'desc' },
      take: 50,
    }).catch(() => []);

    return NextResponse.json({
      approvedPartners,
      outsourceRequest: existingRequest,
      requests,
      postableBusTrips,
      postableLimoBookings,
      postableBreakdowns,
    });
  });
}

export async function POST(req: NextRequest) {
  const policyError = await requireBusOpsRequest(req);
  if (policyError) return policyError;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId, userId } = authz;

  return withTenantRls(prisma, tenantId, async () => {
    try {
      const rawBody = await req.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(rawBody);
      const { action } = body;

      if (action === 'CREATE_REQUEST') {
        const {
          tripId,
          bookingId,
          breakdownId,
          sourceReferenceId,
          domain,
          serviceDate,
          pickupTime,
          pickupLocation,
          dropoffLocation,
          requiredCapacity,
          vehicleTypeRequired,
          pricingMethod,
          invitedPartnerIds,
          specialInstructions,
          publishToMarketplace,
          closesAt,
          requirementsPayload,
        } = body;

        const resolvedDomain: PartnerServiceDomain =
          domain === 'LIMOUSINE'
            ? PartnerServiceDomain.LIMOUSINE
            : domain === 'RECOVERY'
              ? PartnerServiceDomain.RECOVERY
              : domain === 'FREIGHT'
                ? PartnerServiceDomain.FREIGHT
                : PartnerServiceDomain.PASSENGER_TRANSPORT;

        const resolvedSourceType =
          resolvedDomain === PartnerServiceDomain.LIMOUSINE
            ? 'LIMO_BOOKING'
            : resolvedDomain === PartnerServiceDomain.RECOVERY
              ? 'BREAKDOWN_REPORT'
              : resolvedDomain === PartnerServiceDomain.FREIGHT
                ? 'FREIGHT_SHIPMENT'
                : 'TRIP_SCHEDULE';

        const resolvedSourceId =
          String(sourceReferenceId || breakdownId || bookingId || tripId || `ADHOC-${Date.now()}`);

        const defaultCapacity =
          resolvedDomain === PartnerServiceDomain.RECOVERY
            ? 1
            : resolvedDomain === PartnerServiceDomain.LIMOUSINE
              ? 3
              : resolvedDomain === PartnerServiceDomain.FREIGHT
                ? 1000
                : 50;

        const defaultVehicleType =
          resolvedDomain === PartnerServiceDomain.RECOVERY
            ? 'FLATBED'
            : resolvedDomain === PartnerServiceDomain.LIMOUSINE
              ? 'LUXURY_SEDAN'
              : resolvedDomain === PartnerServiceDomain.FREIGHT
                ? 'BOX_TRUCK'
                : '50-Seat Coach';

        const request = await OutsourceEngine.createOutsourceRequest({
          tenantId,
          domain: resolvedDomain,
          sourceReferenceType: resolvedSourceType,
          sourceReferenceId: resolvedSourceId,
          serviceDate: serviceDate || new Date(),
          pickupTime: pickupTime || '08:00',
          pickupLocation: pickupLocation || 'Dubai',
          dropoffLocation: dropoffLocation || 'Abu Dhabi',
          requiredCapacity: Number(requiredCapacity) || defaultCapacity,
          vehicleTypeRequired: vehicleTypeRequired || defaultVehicleType,
          pricingMethod,
          invitedPartnerIds: Array.isArray(invitedPartnerIds) ? invitedPartnerIds : undefined,
          specialInstructions,
          closesAt,
          createdByUserId: userId || 'OPERATIONS',
        });

        let opportunity = null;
        if (publishToMarketplace) {
          opportunity = await MarketplaceService.publishOpportunity({
            tenantId,
            outsourceRequestId: request.id,
            closesAt,
            createdByUserId: userId || 'OPERATIONS',
            requirementsPayload:
              requirementsPayload && typeof requirementsPayload === 'object'
                ? (requirementsPayload as Record<string, unknown>)
                : {
                    requiredCapacity: request.requiredCapacity,
                    vehicleTypeRequired: request.vehicleTypeRequired,
                  },
          }).catch(() => null);
        }

        return NextResponse.json({ ok: true, request, opportunity });
      }

      if (action === 'PUBLISH_TO_MARKETPLACE') {
        const { requestId, closesAt, requirementsPayload } = body;
        if (!requestId) {
          return NextResponse.json({ error: 'requestId is required' }, { status: 400 });
        }

        const opportunity = await MarketplaceService.publishOpportunity({
          tenantId,
          outsourceRequestId: String(requestId),
          closesAt,
          createdByUserId: userId || 'OPERATIONS',
          requirementsPayload:
            requirementsPayload && typeof requirementsPayload === 'object'
              ? (requirementsPayload as Record<string, unknown>)
              : undefined,
        });

        return NextResponse.json({ ok: true, opportunity });
      }

      if (action === 'AWARD_QUOTE') {
        const {
          requestId,
          quoteId,
          tripId,
          ancillaryCharges,
          commercialModel,
          agencySettlementMode,
          buyerAgreedPrice,
          platformFeePct,
          ifrs15Indicators,
        } = body;

        const existingReq = await prisma.outsourceRequest.findFirst({
          where: { id: String(requestId), tenantId },
        });

        const award = await OutsourceEngine.awardQuote({
          tenantId,
          requestId,
          quoteId,
          awardedByUserId: userId || 'OPERATIONS',
          ancillaryCharges,
          commercialModel,
          agencySettlementMode,
          buyerAgreedPrice: buyerAgreedPrice != null ? Number(buyerAgreedPrice) : undefined,
          platformFeePct: platformFeePct != null ? Number(platformFeePct) : undefined,
          ifrs15Indicators,
        });

        const sourceRefId = tripId || existingReq?.sourceReferenceId;
        if (existingReq?.domain === PartnerServiceDomain.LIMOUSINE) {
          const limoAdapter = new LimousineOutsourcingAdapter();
          await limoAdapter.applyAward({
            ...award,
            requestId: existingReq.id,
            sourceReferenceId: sourceRefId,
          });
        } else if (existingReq?.domain === PartnerServiceDomain.RECOVERY) {
          const recoveryAdapter = new RecoveryOutsourcingAdapter();
          await recoveryAdapter.applyAward({
            ...award,
            requestId: existingReq.id,
            sourceReferenceId: sourceRefId,
          });
        } else if (existingReq?.domain === PartnerServiceDomain.FREIGHT) {
          const freightAdapter = new FreightOutsourcingAdapter();
          await freightAdapter.applyAward({
            ...award,
            requestId: existingReq.id,
            sourceReferenceId: sourceRefId,
          });
        } else if (sourceRefId) {
          const busAdapter = new BusOpsOutsourcingAdapter();
          await busAdapter.applyAward({ ...award, sourceReferenceId: sourceRefId });
        }

        return NextResponse.json({ ok: true, award });
      }

      if (action === 'APPROVE_INVOICE') {
        const { invoiceId, approvedAmount } = body;

        const res = await PartnerInvoiceService.approveInvoice({
          tenantId,
          invoiceId,
          approvedAmount,
          approvedByUserId: userId || 'FINANCE',
        });

        return NextResponse.json({ ok: true, invoice: res.invoice, payable: res.payable });
      }

      if (action === 'LOOKUP_CONTRACT_RATE') {
        const { partnerId, originLocation, destinationLocation, vehicleType, requiredCapacity } = body;
        const { RateCardService } = await import('@/lib/exchange/rate-card-service');
        const rate = await RateCardService.lookupContractRate({
          tenantId,
          partnerId,
          originLocation,
          destinationLocation,
          vehicleType,
          requiredCapacity,
        });

        return NextResponse.json({ ok: true, rate });
      }

      if (action === 'CONTRACT_DIRECT_AWARD') {
        const {
          tripId,
          bookingId,
          breakdownId,
          sourceReferenceId,
          domain,
          vehicleTypeRequired,
          partnerId,
          serviceDate,
          pickupTime,
          pickupLocation,
          dropoffLocation,
          requiredCapacity,
          agreedPrice,
          currency,
          rateCardId,
          ancillaryCharges,
          commercialModel,
          agencySettlementMode,
          buyerAgreedPrice,
          platformFeePct,
          ifrs15Indicators,
        } = body;

        const resolvedSourceId = String(sourceReferenceId || breakdownId || bookingId || tripId || `ADHOC-${Date.now()}`);
        const resolvedDomain: PartnerServiceDomain =
          domain === 'LIMOUSINE'
            ? PartnerServiceDomain.LIMOUSINE
            : domain === 'RECOVERY'
              ? PartnerServiceDomain.RECOVERY
              : domain === 'FREIGHT'
                ? PartnerServiceDomain.FREIGHT
                : PartnerServiceDomain.PASSENGER_TRANSPORT;

        const award = await OutsourceEngine.createContractDirectAward({
          tenantId,
          sourceReferenceId: resolvedSourceId,
          domain: resolvedDomain,
          vehicleTypeRequired,
          partnerId,
          serviceDate: serviceDate || new Date(),
          pickupTime: pickupTime || '07:00',
          pickupLocation: pickupLocation || 'Pickup Point',
          dropoffLocation: dropoffLocation || 'Dropoff Point',
          requiredCapacity:
            Number(requiredCapacity) ||
            (resolvedDomain === PartnerServiceDomain.RECOVERY
              ? 1
              : resolvedDomain === PartnerServiceDomain.LIMOUSINE
                ? 3
                : resolvedDomain === PartnerServiceDomain.FREIGHT
                  ? 1000
                  : 50),
          agreedPrice: Number(agreedPrice),
          currency,
          rateCardId,
          ancillaryCharges,
          commercialModel,
          agencySettlementMode,
          buyerAgreedPrice: buyerAgreedPrice != null ? Number(buyerAgreedPrice) : undefined,
          platformFeePct: platformFeePct != null ? Number(platformFeePct) : undefined,
          ifrs15Indicators,
          awardedByUserId: userId || 'OPERATIONS',
        });

        if (resolvedDomain === PartnerServiceDomain.LIMOUSINE) {
          const limoAdapter = new LimousineOutsourcingAdapter();
          await limoAdapter.applyAward({ ...award, sourceReferenceId: resolvedSourceId });
        } else if (resolvedDomain === PartnerServiceDomain.RECOVERY) {
          const recoveryAdapter = new RecoveryOutsourcingAdapter();
          await recoveryAdapter.applyAward({ ...award, sourceReferenceId: resolvedSourceId });
        } else if (resolvedDomain === PartnerServiceDomain.FREIGHT) {
          const freightAdapter = new FreightOutsourcingAdapter();
          await freightAdapter.applyAward({ ...award, sourceReferenceId: resolvedSourceId });
        } else if (tripId || sourceReferenceId) {
          const busAdapter = new BusOpsOutsourcingAdapter();
          await busAdapter.applyAward({ ...award, sourceReferenceId: resolvedSourceId });
        }

        return NextResponse.json({ ok: true, award });
      }

      if (action === 'CANCEL_REQUEST') {
        const { requestId } = body;
        if (!requestId) {
          return NextResponse.json({ error: 'requestId is required' }, { status: 400 });
        }

        const updated = await prisma.outsourceRequest.updateMany({
          where: { id: String(requestId), tenantId },
          data: { status: 'CANCELLED' },
        });
        await prisma.marketplaceOpportunity.updateMany({
          where: { outsourceRequestId: String(requestId), tenantId },
          data: { status: 'CANCELLED' },
        }).catch(() => {});

        return NextResponse.json({ ok: true, updated });
      }

      if (action === 'EXTEND_OR_REBROADCAST_RFQ') {
        const { requestId, extensionHours } = body;
        if (!requestId) {
          return NextResponse.json({ error: 'requestId is required' }, { status: 400 });
        }

        const hours = Math.max(1, Math.min(168, Number(extensionHours) || 24));
        const newClosesAt = new Date(Date.now() + hours * 60 * 60 * 1000);

        await prisma.outsourceRequest.updateMany({
          where: { id: String(requestId), tenantId },
          data: {
            status: 'PUBLISHED',
          },
        });

        const existingOpp = await prisma.marketplaceOpportunity.findFirst({
          where: { outsourceRequestId: String(requestId), tenantId },
        }).catch(() => null);

        let opportunity = null;
        if (existingOpp) {
          await prisma.marketplaceOpportunity.updateMany({
            where: { outsourceRequestId: String(requestId), tenantId },
            data: {
              status: 'OPEN',
              closesAt: newClosesAt,
            },
          }).catch(() => {});
          opportunity = { ...existingOpp, status: 'OPEN', closesAt: newClosesAt };
        } else {
          opportunity = await MarketplaceService.publishOpportunity({
            tenantId,
            outsourceRequestId: String(requestId),
            closesAt: newClosesAt,
            createdByUserId: userId || 'OPERATIONS',
          }).catch(() => null);
        }

        return NextResponse.json({
          ok: true,
          requestId: String(requestId),
          closesAt: newClosesAt.toISOString(),
          opportunity,
        });
      }

      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      const message = err instanceof Error ? err.message : 'Failed to process request';
      if (
        code === 'P2002' ||
        /already been awarded|only SUBMITTED quotes can be awarded|blocked by this tenant|Cannot award/i.test(message)
      ) {
        return NextResponse.json({ error: message }, { status: 409 });
      }
      console.error('[api/bus-ops/outsource POST]', err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
