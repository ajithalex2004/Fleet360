export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { runAsTenant } from '@/lib/rls-scope';
import { PartnerService } from '@/lib/exchange/partner-service';
import { NetworkPolicyService } from '@/lib/exchange/network-policy-service';
import { RateCardService } from '@/lib/exchange/rate-card-service';
import { EMIRATES, isActivated, isEmirate } from '@/lib/exchange/partner-activation';
import {
  exchangeNotProvisionedResponse,
  isExchangeNotProvisioned,
  partnerAuthFailure,
  PROFILE_ROLES,
  requirePartnerContext,
  resolvePartnerViewer,
} from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/partner/profile?partnerId=...
 *   A partner member gets its own partner's profile. Buyer staff (the
 *   outsourcing partner directory) get a partner in their tenant's partner
 *   network, the first one when none is named.
 *   When ?mode=directory is provided, buyer staff receive their tenant's
 *   governed partner directory, active rate cards, and network access policy.
 * PUT /api/exchange/partner/profile
 *   A PARTNER_ADMIN updates its own partner's company details.
 *
 * Both used to take partnerId from the request (GET fell back to the first
 * partner in the database), so anyone signed in could read or edit any
 * partner.
 */

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  try {
    const mode = req.nextUrl.searchParams.get('mode');
    if (mode === 'directory') {
      await NetworkPolicyService.hydrateFromDatabaseIfStale(true);
      const rawPolicy = NetworkPolicyService.getTenantPolicy(authz.tenantId);
      const networkPolicy = {
        ...rawPolicy,
        networkMode: rawPolicy.accessMode,
        allowExtendedPartnerInvites: rawPolicy.accessMode === 'EXTENDED',
        requireConsortiumSharingConsent: true,
      };
      const relationships = await withPlatformAdmin(prisma, (tx) =>
        tx.tenantPartnerRelationship.findMany({
          where: { tenantId: authz.tenantId },
          include: {
            partner: {
              include: {
                capabilities: true,
                complianceDocuments: true,
                vehicles: { where: { isActive: true } },
                drivers: { where: { isActive: true } },
                scorecard: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
      );

      const rateCards = await withPlatformAdmin(prisma, (tx) =>
        tx.partnerRateCard.findMany({
          where: { tenantId: authz.tenantId },
          include: {
            partner: { select: { id: true, legalName: true, partnerCode: true } },
          },
          orderBy: { createdAt: 'desc' },
        }),
      );

      const enrichedRateCards = rateCards.map((rc) => {
        const snap = RateCardService.buildImmutableRateCardSnapshot({
          rateCardId: rc.id,
          version: 1,
          effectiveFrom: rc.createdAt,
          pricingUnit: rc.unitType || 'PER_TRIP',
          baseRate: Number(rc.rateAmount),
          currency: rc.currency || 'AED',
          originZone: rc.originZone,
          destinationZone: rc.destinationZone,
          vehicleType: rc.vehicleType,
        });
        return {
          ...rc,
          rateAmount: Number(rc.rateAmount),
          snapshotHash: snap.snapshotHash,
          ancillaryCharges: snap.ancillaryCharges,
        };
      });

      const now = new Date();
      const partners = relationships.map((rel) => {
        const p = rel.partner;
        const validDocs = (p.complianceDocuments || []).filter(
          (d) =>
            (d.status === 'VALID' || d.status === 'APPROVED') &&
            (!d.expiryDate || new Date(d.expiryDate) > now),
        );
        const expiredDocs = (p.complianceDocuments || []).filter(
          (d) => d.expiryDate && new Date(d.expiryDate) <= now,
        );
        const sc = p.scorecard as Record<string, any> | null;
        return {
          ...p,
          relationshipId: rel.id,
          relationshipStatus: rel.status,
          paymentTerms: rel.paymentTerms,
          commercialNotes: rel.commercialNotes,
          isPreferred: rel.status === 'PREFERRED',
          complianceEligible:
            p.operationalStatus === 'ACTIVE' &&
            p.onboardingStatus === 'APPROVED' &&
            expiredDocs.length === 0 &&
            validDocs.length > 0,
          validDocsCount: validDocs.length,
          expiredDocsCount: expiredDocs.length,
          latestScorecard: sc
            ? {
                ...sc,
                overallScore: sc.overallScore ?? sc.compositeScore,
                onTimeRate: sc.onTimeRate ?? sc.onTimePerformance,
                quoteResponseRate: sc.quoteResponseRate,
                cancellationRate: sc.cancellationRate ?? sc.exceptionRate,
                complianceRate: sc.complianceRate ?? sc.podQualityRate,
              }
            : null,
        };
      });

      const [exceptions, awards, invoices, requests, statements] = await Promise.all([
        withPlatformAdmin(prisma, (tx) =>
          tx.outsourceException
            ? tx.outsourceException.findMany({
                where: { tenantId: authz.tenantId },
                include: {
                  partner: { select: { id: true, legalName: true, partnerCode: true } },
                  award: {
                    select: {
                      id: true,
                      totalAwarded: true,
                      status: true,
                      request: {
                        select: {
                          requestNumber: true,
                          domain: true,
                          pickupLocation: true,
                          dropoffLocation: true,
                        },
                      },
                    },
                  },
                },
                orderBy: { createdAt: 'desc' },
                take: 50,
              })
            : Promise.resolve([]),
        ).catch(() => []),
        withPlatformAdmin(prisma, (tx) =>
          tx.outsourceAward
            ? tx.outsourceAward.findMany({
                where: { tenantId: authz.tenantId },
                include: {
                  request: { select: { id: true, domain: true, pricingMethod: true } },
                },
                take: 500,
              })
            : Promise.resolve([]),
        ).catch(() => []),
        withPlatformAdmin(prisma, (tx) =>
          tx.partnerInvoice
            ? tx.partnerInvoice.findMany({
                where: { tenantId: authz.tenantId },
                take: 500,
              })
            : Promise.resolve([]),
        ).catch(() => []),
        withPlatformAdmin(prisma, (tx) =>
          tx.outsourceRequest
            ? tx.outsourceRequest.findMany({
                where: { tenantId: authz.tenantId },
                select: { id: true, domain: true, status: true, pricingMethod: true },
                take: 500,
              })
            : Promise.resolve([]),
        ).catch(() => []),
        withPlatformAdmin(prisma, (tx) =>
          tx.partnerSettlementStatement
            ? tx.partnerSettlementStatement.findMany({
                where: { tenantId: authz.tenantId },
                take: 200,
              })
            : Promise.resolve([]),
        ).catch(() => []),
      ]);

      // Phase 19: Compute Executive Outsource Spend, Commission & 3-Way Match Analytics
      const domains = ['PASSENGER_TRANSPORT', 'FREIGHT', 'LIMOUSINE', 'RECOVERY'] as const;
      const totalAwardedSpendAed = awards.reduce((sum: number, a: any) => sum + Number(a.totalAwarded || 0), 0);

      const verticalBreakdown = domains.map((dom) => {
        const domRequests = requests.filter((r: any) => (r.domain || 'PASSENGER_TRANSPORT') === dom);
        const domAwards = awards.filter((a: any) => (a.request?.domain || 'PASSENGER_TRANSPORT') === dom);
        const spendAed = domAwards.reduce((sum: number, a: any) => sum + Number(a.totalAwarded || 0), 0);
        return {
          domain: dom,
          requestCount: domRequests.length,
          awardCount: domAwards.length,
          awardedSpendAed: Math.round(spendAed * 100) / 100,
          shareOfSpendPct:
            totalAwardedSpendAed > 0 ? Math.round((spendAed / totalAwardedSpendAed) * 1000) / 10 : 0,
        };
      });

      let agencyAwardCount = 0;
      let principalAwardCount = 0;
      let agencyPlatformFeeEarnedAed = 0;
      let principalGrossMarginAed = 0;
      let netPartnerPayoutAed = 0;

      for (const a of awards as any[]) {
        const snap = (a.commercialSnapshot || {}) as Record<string, any>;
        const model = snap.commercialModel === 'PRINCIPAL' ? 'PRINCIPAL' : 'AGENCY';
        const baseAwarded = Number(a.awardedPrice ?? a.awardedAmount ?? Number(a.totalAwarded || 0) / 1.05);
        if (model === 'PRINCIPAL') {
          principalAwardCount += 1;
          const buyerPrice = Number(snap.buyerAgreedPrice ?? baseAwarded * 1.12);
          principalGrossMarginAed += Math.max(0, buyerPrice - baseAwarded);
          netPartnerPayoutAed += Number(snap.netPartnerPayout ?? a.totalAwarded ?? 0);
        } else {
          agencyAwardCount += 1;
          const feePct = snap.platformFeePct != null ? Number(snap.platformFeePct) : 3;
          const feeAmt =
            snap.platformFeeAmount != null
              ? Number(snap.platformFeeAmount)
              : (baseAwarded * feePct) / 100;
          agencyPlatformFeeEarnedAed += feeAmt;
          netPartnerPayoutAed += Number(snap.netPartnerPayout ?? Number(a.totalAwarded || 0) - feeAmt);
        }
      }

      const totalInvoices = invoices.length;
      const autoMatchedCount = invoices.filter(
        (inv: any) =>
          inv.verificationStatus === 'MATCHED' ||
          (!inv.verificationStatus && (inv.status === 'APPROVED' || inv.status === 'PAID')),
      ).length;
      const varianceHoldCount = invoices.filter(
        (inv: any) => inv.verificationStatus === 'VARIANCE_DETECTED' || inv.status === 'DISPUTED',
      ).length;
      const totalInvoicedAed = invoices.reduce((sum: number, inv: any) => sum + Number(inv.totalAmount || 0), 0);
      const totalApprovedAed = invoices.reduce(
        (sum: number, inv: any) => sum + Number(inv.approvedAmount ?? inv.totalAmount ?? 0),
        0,
      );
      const statementDeductionsAed = statements.reduce(
        (sum: number, s: any) => sum + Number(s.totalDeductions || 0),
        0,
      );
      const varianceSavingsAed =
        Math.max(0, totalInvoicedAed - totalApprovedAed) + statementDeductionsAed;

      const executiveAnalytics = {
        verticalBreakdown,
        commercialLedger: {
          agencyAwardCount,
          principalAwardCount,
          totalAwardedGrossAed: Math.round(totalAwardedSpendAed * 100) / 100,
          agencyPlatformFeeEarnedAed: Math.round(agencyPlatformFeeEarnedAed * 100) / 100,
          principalGrossMarginAed: Math.round(principalGrossMarginAed * 100) / 100,
          netPartnerPayoutAed: Math.round(netPartnerPayoutAed * 100) / 100,
        },
        threeWayMatchStats: {
          totalInvoices,
          autoMatchedCount,
          varianceHoldCount,
          autoMatchRatePct:
            totalInvoices > 0 ? Math.round((autoMatchedCount / totalInvoices) * 1000) / 10 : 100,
          totalInvoicedAed: Math.round(totalInvoicedAed * 100) / 100,
          totalApprovedAed: Math.round(totalApprovedAed * 100) / 100,
          varianceSavingsAed: Math.round(varianceSavingsAed * 100) / 100,
        },
      };

      return NextResponse.json({
        partner: partners[0] || null,
        partners,
        rateCards: enrichedRateCards,
        networkPolicy,
        exceptions,
        executiveAnalytics,
      });
    }

    const viewer = await resolvePartnerViewer(req, authz.tenantId);
    if (!viewer.ok) return partnerAuthFailure(viewer);
    if (!viewer.partnerId) return NextResponse.json({ partner: null });

    // Partner master data is platform-level; access was decided above.
    const partner = await runAsTenant('*', () => PartnerService.getPartnerProfile(viewer.partnerId as string));
    if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 });

    if (req.nextUrl.searchParams.get('includeConsents') === '1') {
      await NetworkPolicyService.hydrateFromDatabaseIfStale(true);
      const sharingConsents = NetworkPolicyService.getPartnerSharingConsents(viewer.partnerId as string);
      return NextResponse.json({ partner, sharingConsents });
    }

    return NextResponse.json({ partner });
  } catch (err) {
    if (isExchangeNotProvisioned(err)) return exchangeNotProvisionedResponse();
    console.error('[exchange/partner/profile GET]', err);
    return NextResponse.json({ error: 'Failed to load partner profile' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req, { roles: PROFILE_ROLES, allowPending: true });
  if (!auth.ok) return partnerAuthFailure(auth);

  try {
    const rawBody = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(rawBody);

    if (body.consortiumSharingConsent && typeof body.consortiumSharingConsent === 'object') {
      const consentInput = body.consortiumSharingConsent as {
        consortiumId?: string;
        allowQualificationDiscovery?: boolean;
      };
      const consortiumId =
        typeof consentInput.consortiumId === 'string' && consentInput.consortiumId.trim()
          ? consentInput.consortiumId.trim()
          : 'UAE_ENTERPRISE_FLEET_CONSORTIUM';
      const savedConsent = NetworkPolicyService.setPartnerSharingConsent(
        auth.ctx.partnerId,
        consortiumId,
        Boolean(consentInput.allowQualificationDiscovery),
        auth.ctx.userId,
      );
      if (body.consentOnly) {
        return NextResponse.json({
          ok: true,
          consent: savedConsent,
          sharingConsents: NetworkPolicyService.getPartnerSharingConsents(auth.ctx.partnerId),
        });
      }
    }

    const { legalName, tradeName, address, city, primaryContactName, primaryContactEmail, primaryContactPhone } = body;
    // The emirate decides which permits are mandatory, so it is fixed once
    // the partner has been activated.
    const { emirate } = body as { emirate?: unknown };
    if (emirate !== undefined && emirate !== null && !isEmirate(emirate)) {
      return NextResponse.json({ error: `emirate must be one of ${EMIRATES.join(', ')}` }, { status: 400 });
    }
    if (isEmirate(emirate) && isActivated(auth.ctx) && emirate !== auth.ctx.emirate) {
      return NextResponse.json({ error: 'Your emirate can\'t be changed after activation; contact your onboarding company.' }, { status: 409 });
    }

    const updated = await withPlatformAdmin(prisma, async (tx) => {
      if (Array.isArray(body.serviceAreas)) {
        await tx.partnerServiceArea.deleteMany({
          where: { partnerId: auth.ctx.partnerId },
        });
        const cleanAreas = body.serviceAreas
          .filter((sa: any) => sa && typeof sa.emirate === 'string' && sa.emirate.trim())
          .map((sa: any) => ({
            partnerId: auth.ctx.partnerId,
            emirate: String(sa.emirate).trim(),
            zones: Array.isArray(sa.zones) ? sa.zones.map(String) : [],
          }));
        if (cleanAreas.length > 0) {
          await tx.partnerServiceArea.createMany({ data: cleanAreas });
        }
      }

      return tx.transportPartner.update({
        where: { id: auth.ctx.partnerId },
        data: {
          legalName,
          tradeName,
          address,
          city,
          ...(isEmirate(emirate) ? { emirate } : {}),
          primaryContactName,
          primaryContactEmail,
          primaryContactPhone,
          updatedAt: new Date(),
        },
        include: {
          capabilities: true,
          serviceAreas: true,
        },
      });
    });

    return NextResponse.json({ ok: true, partner: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update partner' }, { status: 500 });
  }
}
