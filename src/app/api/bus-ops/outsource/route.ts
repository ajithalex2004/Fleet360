export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { OutsourceEngine } from '@/lib/exchange/outsource-engine';
import { BusOpsOutsourcingAdapter } from '@/lib/exchange/bus-ops-adapter';
import { PartnerInvoiceService } from '@/lib/exchange/partner-invoice-service';

export const runtime = 'nodejs';

/**
 * GET /api/bus-ops/outsource?tripId=...
 * POST /api/bus-ops/outsource
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const { searchParams } = new URL(req.url);
  const tripId = searchParams.get('tripId');

  return withTenantRls(prisma, tenantId, async () => {
    // 1. Fetch approved transport partners for this tenant
    const approvedPartners = await prisma.transportPartner.findMany({
      where: {
        operationalStatus: 'ACTIVE',
        deletedAt: null,
        capabilities: {
          some: { domain: 'PASSENGER_TRANSPORT' },
        },
      },
      select: {
        id: true,
        legalName: true,
        partnerCode: true,
        primaryContactPhone: true,
        city: true,
      },
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
          award: {
            include: {
              partner: true,
              assignment: true,
              invoice: true,
            },
          },
        },
      });
    }

    return NextResponse.json({
      approvedPartners,
      outsourceRequest: existingRequest,
    });
  });
}

export async function POST(req: NextRequest) {
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
          serviceDate,
          pickupTime,
          pickupLocation,
          dropoffLocation,
          requiredCapacity,
          vehicleTypeRequired,
          pricingMethod,
          invitedPartnerIds,
          specialInstructions,
        } = body;

        const request = await OutsourceEngine.createOutsourceRequest({
          tenantId,
          sourceReferenceType: 'TRIP_SCHEDULE',
          sourceReferenceId: tripId,
          serviceDate,
          pickupTime,
          pickupLocation,
          dropoffLocation,
          requiredCapacity: Number(requiredCapacity) || 50,
          vehicleTypeRequired,
          pricingMethod,
          invitedPartnerIds,
          specialInstructions,
          createdByUserId: userId || 'OPERATIONS',
        });

        return NextResponse.json({ ok: true, request });
      }

      if (action === 'AWARD_QUOTE') {
        const { requestId, quoteId, tripId } = body;

        const award = await OutsourceEngine.awardQuote({
          tenantId,
          requestId,
          quoteId,
          awardedByUserId: userId || 'OPERATIONS',
        });

        if (tripId) {
          const adapter = new BusOpsOutsourcingAdapter();
          await adapter.markAwarded(award.id, tripId, tenantId);
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
          partnerId,
          serviceDate,
          pickupTime,
          pickupLocation,
          dropoffLocation,
          requiredCapacity,
          agreedPrice,
        } = body;

        const award = await OutsourceEngine.createContractDirectAward({
          tenantId,
          sourceReferenceId: tripId,
          partnerId,
          serviceDate: serviceDate || new Date(),
          pickupTime: pickupTime || '07:00',
          pickupLocation: pickupLocation || 'Pickup Point',
          dropoffLocation: dropoffLocation || 'Dropoff Point',
          requiredCapacity: Number(requiredCapacity) || 50,
          agreedPrice: Number(agreedPrice),
          awardedByUserId: userId || 'OPERATIONS',
        });

        if (tripId) {
          const adapter = new BusOpsOutsourcingAdapter();
          await adapter.markAwarded(award.id, tripId, tenantId);
        }

        return NextResponse.json({ ok: true, award });
      }

      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (err) {
      console.error('[api/bus-ops/outsource POST]', err);
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to process request' }, { status: 500 });
    }
  });
}
