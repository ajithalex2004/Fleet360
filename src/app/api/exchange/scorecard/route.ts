export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { PartnerServiceDomain } from '@prisma/client';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { runAsTenant } from '@/lib/rls-scope';
import { ScorecardService } from '@/lib/exchange/scorecard-service';
import { NetworkPolicyService, type NetworkAccessMode } from '@/lib/exchange/network-policy-service';
import { RateCardService } from '@/lib/exchange/rate-card-service';
import { ExceptionService } from '@/lib/exchange/exception-service';
import { MarketplaceService } from '@/lib/exchange/marketplace-service';
import { partnerAuthFailure, resolvePartnerViewer } from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * GET  /api/exchange/scorecard?partnerId=... — a partner's performance scorecard
 * POST /api/exchange/scorecard { partnerId?, action? } — recalculate it or execute
 *      governed buyer-network actions (UPDATE_NETWORK_POLICY, UPDATE_RELATIONSHIP,
 *      CREATE_RATE_CARD, TRIGGER_FAILOVER).
 *
 * A partner member sees its own partner; buyer staff see partners in their
 * tenant's partner network (the first one when none is named).
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  try {
    const viewer = await resolvePartnerViewer(req, authz.tenantId);
    if (!viewer.ok) return partnerAuthFailure(viewer);
    if (!viewer.partnerId) return NextResponse.json({ scorecard: null, exceptions: [] });

    const [scorecard, exceptions] = await runAsTenant('*', async () => {
      const sc = await ScorecardService.getPartnerScorecard(viewer.partnerId as string);
      const exList = prisma.outsourceException?.findMany
        ? await prisma.outsourceException
            .findMany({
              where: { partnerId: viewer.partnerId as string },
              include: {
                award: {
                  include: {
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
              take: 10,
            })
            .catch(() => [])
        : [];
      return [sc, exList] as const;
    });
    return NextResponse.json({ scorecard, exceptions });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch partner scorecard' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  try {
    const rawBody = await req.json().catch(() => ({}));
    const action = typeof rawBody.action === 'string' ? rawBody.action : 'EVALUATE';

    if (action === 'UPDATE_NETWORK_POLICY') {
      const validModes: NetworkAccessMode[] = ['CLOSED', 'PREFERRED', 'EXTENDED'];
      const requestedMode = rawBody.networkMode || rawBody.accessMode;
      const mode: NetworkAccessMode = validModes.includes(requestedMode)
        ? requestedMode
        : 'PREFERRED';
      const updated = await NetworkPolicyService.setTenantPolicy({
        tenantId: authz.tenantId,
        accessMode: mode,
        preferredExclusiveWindowMinutes:
          rawBody.preferredExclusiveWindowMinutes != null
            ? Math.max(0, Number(rawBody.preferredExclusiveWindowMinutes))
            : 30,
        allowAutoAwardPreferred: Boolean(rawBody.allowAutoAwardPreferred),
        actorUserId: req.headers.get('x-user-id') || undefined,
      });
      const networkPolicy = {
        ...updated,
        networkMode: updated.accessMode,
        allowExtendedPartnerInvites: Boolean(rawBody.allowExtendedPartnerInvites),
        requireConsortiumSharingConsent:
          rawBody.requireConsortiumSharingConsent != null
            ? Boolean(rawBody.requireConsortiumSharingConsent)
            : true,
      };
      return NextResponse.json({ ok: true, networkPolicy });
    }

    if (action === 'UPDATE_RELATIONSHIP') {
      const partnerId = typeof rawBody.partnerId === 'string' ? rawBody.partnerId.trim() : '';
      const status = typeof rawBody.status === 'string' ? rawBody.status.trim().toUpperCase() : 'APPROVED';
      if (!partnerId) {
        return NextResponse.json({ error: 'partnerId is required' }, { status: 400 });
      }
      if (!['APPROVED', 'PREFERRED', 'BLOCKED', 'SUSPENDED'].includes(status)) {
        return NextResponse.json({ error: 'Invalid relationship status' }, { status: 400 });
      }

      const relationship = await withPlatformAdmin(prisma, async (tx) => {
        const existing = await tx.tenantPartnerRelationship.findFirst({
          where: { tenantId: authz.tenantId, partnerId },
        });
        if (existing) {
          return tx.tenantPartnerRelationship.update({
            where: { id: existing.id },
            data: {
              status,
              paymentTerms: typeof rawBody.paymentTerms === 'string' ? rawBody.paymentTerms : existing.paymentTerms,
              commercialNotes:
                typeof rawBody.commercialNotes === 'string' ? rawBody.commercialNotes : existing.commercialNotes,
            },
          });
        }
        return tx.tenantPartnerRelationship.create({
          data: {
            tenantId: authz.tenantId,
            partnerId,
            status,
            paymentTerms: typeof rawBody.paymentTerms === 'string' ? rawBody.paymentTerms : 'Net 30',
            commercialNotes: typeof rawBody.commercialNotes === 'string' ? rawBody.commercialNotes : null,
          },
        });
      });

      return NextResponse.json({ ok: true, relationship });
    }

    if (action === 'CREATE_RATE_CARD') {
      const partnerId = typeof rawBody.partnerId === 'string' ? rawBody.partnerId.trim() : '';
      const title = typeof rawBody.title === 'string' ? rawBody.title.trim() : '';
      const vehicleType = typeof rawBody.vehicleType === 'string' ? rawBody.vehicleType.trim() : '50-Seater Coach';
      const rateAmount = Number(rawBody.rateAmount);

      if (!partnerId || !title || !Number.isFinite(rateAmount) || rateAmount <= 0) {
        return NextResponse.json(
          { error: 'partnerId, title, and a positive rateAmount are required' },
          { status: 400 }
        );
      }

      const domain = (Object.values(PartnerServiceDomain) as string[]).includes(String(rawBody.domain))
        ? (rawBody.domain as PartnerServiceDomain)
        : PartnerServiceDomain.PASSENGER_TRANSPORT;

      const created = await runAsTenant(authz.tenantId, () =>
        RateCardService.createRateCard({
          tenantId: authz.tenantId,
          partnerId,
          title,
          domain,
          vehicleType,
          originZone: typeof rawBody.originZone === 'string' && rawBody.originZone.trim() ? rawBody.originZone.trim() : undefined,
          destinationZone:
            typeof rawBody.destinationZone === 'string' && rawBody.destinationZone.trim()
              ? rawBody.destinationZone.trim()
              : undefined,
          rateAmount,
          currency: typeof rawBody.currency === 'string' ? rawBody.currency : 'AED',
          unitType: typeof rawBody.unitType === 'string' ? rawBody.unitType : 'PER_TRIP',
        }),
      );

      const snapshot = RateCardService.buildImmutableRateCardSnapshot({
        rateCardId: created.id,
        version: Number(rawBody.version) || 1,
        effectiveFrom: created.createdAt,
        pricingUnit: created.unitType || 'PER_TRIP',
        baseRate: Number(created.rateAmount),
        currency: created.currency || 'AED',
        originZone: created.originZone,
        destinationZone: created.destinationZone,
        vehicleType: created.vehicleType,
        ancillaryCharges: {
          freeWaitingMinutes: rawBody.freeWaitingMinutes != null ? Number(rawBody.freeWaitingMinutes) : 30,
          waitingFeePerHour: rawBody.waitingFeePerHour != null ? Number(rawBody.waitingFeePerHour) : 100,
          cancellationFeePct: rawBody.cancellationFeePct != null ? Number(rawBody.cancellationFeePct) : 25,
          tollTreatment: rawBody.tollTreatment === 'INCLUDED' ? 'INCLUDED' : 'ACTUAL',
          fuelSurchargePct: rawBody.fuelSurchargePct != null ? Number(rawBody.fuelSurchargePct) : 0,
        },
      });

      return NextResponse.json({
        ok: true,
        rateCard: {
          ...created,
          rateAmount: Number(created.rateAmount),
          snapshotHash: snapshot.snapshotHash,
          ancillaryCharges: snapshot.ancillaryCharges,
        },
        snapshot,
      });
    }

    if (action === 'TRIGGER_FAILOVER') {
      const awardId =
        typeof rawBody.awardId === 'string' && rawBody.awardId.trim()
          ? rawBody.awardId.trim()
          : typeof rawBody.requestId === 'string' && rawBody.requestId.trim()
          ? rawBody.requestId.trim()
          : '';
      if (!awardId) {
        return NextResponse.json({ error: 'awardId or requestId is required for failover re-sourcing' }, { status: 400 });
      }
      const failoverResult = await runAsTenant(authz.tenantId, () =>
        ExceptionService.triggerGovernedFailoverResourcing({
          tenantId: authz.tenantId,
          awardId,
          reason:
            typeof rawBody.description === 'string' && rawBody.description.trim()
              ? rawBody.description.trim()
              : typeof rawBody.reason === 'string' && rawBody.reason.trim()
              ? rawBody.reason.trim()
              : 'Partner defaulted on SLA; operator triggered governed failover re-sourcing.',
          triggeredByUserId: req.headers.get('x-user-id') || 'OPERATOR',
        }),
      );
      return NextResponse.json({ ok: true, failover: failoverResult });
    }

    if (action === 'RUN_SLA_SWEEPER') {
      const actorUserId = req.headers.get('x-user-id') || 'SYSTEM_SLA_SWEEPER';
      const graceMinutes =
        rawBody.graceMinutes != null ? Math.max(5, Number(rawBody.graceMinutes)) : 30;
      const autoTriggerFailover = Boolean(rawBody.autoTriggerFailover);

      const [expiredOpportunities, overdueNoShows] = await runAsTenant(authz.tenantId, async () => {
        const expRes = MarketplaceService.sweepExpiredOpportunities
          ? await MarketplaceService.sweepExpiredOpportunities({
              tenantId: authz.tenantId,
              actorUserId,
            })
          : { sweptCount: 0, expiredOpportunityIds: [], zeroQuoteOpportunityIds: [] };
        const noShowRes = ExceptionService.sweepOverdueNoShowAssignments
          ? await ExceptionService.sweepOverdueNoShowAssignments({
              tenantId: authz.tenantId,
              graceMinutes,
              autoTriggerFailover,
              actorUserId,
            })
          : {
              evaluatedCount: 0,
              overdueNoShowCount: 0,
              raisedExceptionIds: [],
              failoverOutcomes: [],
            };
        return [expRes, noShowRes] as const;
      });

      return NextResponse.json({
        ok: true,
        sweeper: {
          expiredOpportunities,
          overdueNoShows,
          sweptAt: new Date().toISOString(),
        },
      });
    }

    const requested = typeof rawBody.partnerId === 'string' ? rawBody.partnerId : null;

    const viewer = await resolvePartnerViewer(req, authz.tenantId, { requested });
    if (!viewer.ok) return partnerAuthFailure(viewer);
    if (!viewer.partnerId) return NextResponse.json({ error: 'No transport partner to evaluate' }, { status: 404 });

    const evaluation = await runAsTenant('*', () =>
      ScorecardService.evaluatePartnerScorecard(viewer.partnerId as string),
    );
    return NextResponse.json({ ok: true, evaluation });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to recalculate scorecard' },
      { status: 500 }
    );
  }
}
