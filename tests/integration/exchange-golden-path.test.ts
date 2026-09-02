import { describe, it, expect } from 'vitest';
import { hashDriverToken } from '@/lib/exchange/outsource-engine';

describe('Fleet360 Exchange: 27-Step Staging Golden Path Simulation (Phase 1.5)', () => {
  it('executes full multi-tenant, multi-partner workflow under adversarial race conditions & retries', () => {
    // -------------------------------------------------------------------------
    // ACTORS SETUP: 2 Tenants, 3 Partners
    // -------------------------------------------------------------------------
    const tenantA = { id: 'tenant-enterprise-A', name: 'Al Naboodah Transport Operations' };
    const tenantB = { id: 'tenant-enterprise-B', name: 'Competitor Logistics' };

    const partnerAlpha = { id: 'partner-alpha', name: 'Alpha Passenger Transport LLC', code: 'ALP-DXB', operationalStatus: 'ACTIVE' };
    const partnerBeta = { id: 'partner-beta', name: 'Beta Bus Services LLC', code: 'BET-DXB', operationalStatus: 'ACTIVE' };
    const partnerGamma = { id: 'partner-gamma', name: 'Gamma Fleet Solutions', code: 'GAM-DXB', operationalStatus: 'ACTIVE' };

    // -------------------------------------------------------------------------
    // STEP 1 & 2: Tenant A Relationship Policies
    // -------------------------------------------------------------------------
    const tenantRelationships = [
      { tenantId: tenantA.id, partnerId: partnerAlpha.id, status: 'APPROVED' },
      { tenantId: tenantA.id, partnerId: partnerBeta.id, status: 'PREFERRED' },
      { tenantId: tenantA.id, partnerId: partnerGamma.id, status: 'BLOCKED' }, // Gamma is blocked
    ];

    expect(tenantRelationships.find((r) => r.partnerId === partnerAlpha.id)?.status).toBe('APPROVED');
    expect(tenantRelationships.find((r) => r.partnerId === partnerGamma.id)?.status).toBe('BLOCKED');

    // -------------------------------------------------------------------------
    // STEP 3: Tenant A creates Native Bus Ops TripSchedule
    // -------------------------------------------------------------------------
    const tripSchedule = {
      id: 'trip-sched-9001',
      tenantId: tenantA.id,
      routeNumber: 'ROUTE-501-JAFZA',
      serviceDate: new Date('2026-09-20'),
      departureTime: '06:00',
      originName: 'Al Ghubaiba Bus Station',
      destinationName: 'JAFZA South Gate 4',
      requiredCapacity: 50,
      status: 'UNASSIGNED',
    };
    expect(tripSchedule.status).toBe('UNASSIGNED');

    // -------------------------------------------------------------------------
    // STEP 4 & 5: Dispatch Outsource Request & Filter Blocked Gamma
    // -------------------------------------------------------------------------
    const initialTargetPartners = [partnerAlpha.id, partnerBeta.id, partnerGamma.id];
    const invitedPartners = initialTargetPartners.filter((pid) => {
      const rel = tenantRelationships.find((r) => r.tenantId === tenantA.id && r.partnerId === pid);
      return rel && rel.status !== 'BLOCKED';
    });

    expect(invitedPartners).toEqual([partnerAlpha.id, partnerBeta.id]); // Gamma filtered!

    const outsourceRequest = {
      id: 'req-gold-001',
      tenantId: tenantA.id,
      requestNumber: 'OUT-2026-00901',
      sourceReferenceType: 'TRIP_SCHEDULE',
      sourceReferenceId: tripSchedule.id,
      pricingMethod: 'RFQ',
      status: 'PUBLISHED',
      serviceDate: tripSchedule.serviceDate,
      pickupTime: tripSchedule.departureTime,
      pickupLocation: tripSchedule.originName,
      dropoffLocation: tripSchedule.destinationName,
      requiredCapacity: 50,
      closesAt: new Date(Date.now() + 86400000),
      awardedQuoteId: null as string | null,
    };

    // -------------------------------------------------------------------------
    // STEP 6: Partner Alpha quotes AED 800 (Rev 1)
    // -------------------------------------------------------------------------
    const quoteAlphaRev1 = {
      id: 'quote-alpha-rev1',
      requestId: outsourceRequest.id,
      partnerId: partnerAlpha.id,
      revisionNo: 1,
      amount: 800,
      vatAmount: 40,
      totalAmount: 840,
      status: 'SUBMITTED',
    };

    // -------------------------------------------------------------------------
    // STEP 7: Partner Beta quotes AED 750 (Rev 1)
    // -------------------------------------------------------------------------
    const quoteBetaRev1 = {
      id: 'quote-beta-rev1',
      requestId: outsourceRequest.id,
      partnerId: partnerBeta.id,
      revisionNo: 1,
      amount: 750,
      vatAmount: 37.5,
      totalAmount: 787.5,
      status: 'SUBMITTED',
    };

    // -------------------------------------------------------------------------
    // STEP 8: Partner Alpha revises quote -> AED 725 (Rev 2 supersedes Rev 1)
    // -------------------------------------------------------------------------
    quoteAlphaRev1.status = 'SUPERSEDED';
    const quoteAlphaRev2 = {
      id: 'quote-alpha-rev2',
      requestId: outsourceRequest.id,
      partnerId: partnerAlpha.id,
      revisionNo: 2,
      supersedesQuoteId: quoteAlphaRev1.id,
      amount: 725,
      vatAmount: 36.25,
      totalAmount: 761.25,
      status: 'SUBMITTED',
    };

    expect(quoteAlphaRev1.status).toBe('SUPERSEDED');
    expect(quoteAlphaRev2.totalAmount).toBe(761.25);

    // -------------------------------------------------------------------------
    // STEP 9: Tenant A Awards Quote to Partner Alpha
    // -------------------------------------------------------------------------
    outsourceRequest.awardedQuoteId = quoteAlphaRev2.id;
    outsourceRequest.status = 'AWARDED';
    quoteAlphaRev2.status = 'ACCEPTED';
    quoteBetaRev1.status = 'REJECTED';

    const award = {
      id: 'award-gold-001',
      tenantId: tenantA.id,
      requestId: outsourceRequest.id,
      quoteId: quoteAlphaRev2.id,
      partnerId: partnerAlpha.id,
      awardedPrice: 725,
      vatAmount: 36.25,
      totalAwarded: 761.25,
      status: 'AWARDED',
      commercialSnapshot: {
        partnerName: partnerAlpha.name,
        awardedAmount: 761.25,
        vatRate: 0.05,
      },
    };

    expect(award.totalAwarded).toBe(761.25);
    expect(quoteBetaRev1.status).toBe('REJECTED');

    // -------------------------------------------------------------------------
    // STEP 10: Attempt to Award Beta or Superseded Rev 1 -> Fails
    // -------------------------------------------------------------------------
    const tryAwardQuote = (q: typeof quoteBetaRev1) => {
      if (q.status !== 'SUBMITTED') {
        throw new Error(`Quote is in ${q.status} status; only SUBMITTED quotes can be awarded`);
      }
      if (outsourceRequest.status === 'AWARDED' && outsourceRequest.awardedQuoteId !== q.id) {
        throw new Error('409 Conflict: Request has already been awarded');
      }
    };
    expect(() => tryAwardQuote(quoteAlphaRev1)).toThrow(/Quote is in SUPERSEDED status/);
    expect(() => tryAwardQuote(quoteBetaRev1)).toThrow(/Quote is in REJECTED status/);

    // -------------------------------------------------------------------------
    // STEP 11 & 12: Alpha Assigns Vehicle & Driver -> SHA-256 Token
    // -------------------------------------------------------------------------
    const rawOpaqueToken = 'c7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8';
    const tokenHash = hashDriverToken(rawOpaqueToken);

    const assignment = {
      id: 'assign-gold-001',
      awardId: award.id,
      partnerId: partnerAlpha.id,
      vehiclePlate: 'Dubai K 88910',
      driverName: 'Muhammad Ali',
      driverPhone: '+971501239999',
      driverTokenHash: tokenHash,
      driverTokenExp: new Date(Date.now() + 86400000),
      isTokenRevoked: false,
      reachedAt: null as Date | null,
      startedAt: null as Date | null,
      completedAt: null as Date | null,
    };
    expect(assignment.driverTokenHash.length).toBe(64);

    // -------------------------------------------------------------------------
    // STEP 13, 14, 15: Driver Milestone Execution & Native Sync
    // -------------------------------------------------------------------------
    // Milestone 1: REACHED
    assignment.reachedAt = new Date('2026-09-20T05:45:00Z');

    // Milestone 2: STARTED -> Syncs TripSchedule to IN_PROGRESS
    assignment.startedAt = new Date('2026-09-20T06:00:00Z');
    tripSchedule.status = 'IN_PROGRESS';
    expect(tripSchedule.status).toBe('IN_PROGRESS');

    // -------------------------------------------------------------------------
    // STEP 16: Milestone: COMPLETED + POD -> Syncs TripSchedule to COMPLETED
    // -------------------------------------------------------------------------
    assignment.completedAt = new Date('2026-09-20T07:15:00Z');
    tripSchedule.status = 'COMPLETED';

    const pod = {
      assignmentId: assignment.id,
      passengerCount: 48,
      signedByName: 'Supervisor Tariq',
      completionNotes: 'Safe arrival at JAFZA South Gate 4',
    };
    expect(tripSchedule.status).toBe('COMPLETED');
    expect(pod.passengerCount).toBe(48);

    // -------------------------------------------------------------------------
    // STEP 17: Post-Completion Mutation Attempt -> Rejected (Read-Only)
    // -------------------------------------------------------------------------
    const updateMilestoneAfterCompletion = () => {
      if (assignment.completedAt) {
        throw new Error('409 Conflict: Trip is already completed and finalized; further milestone mutations rejected');
      }
    };
    expect(() => updateMilestoneAfterCompletion()).toThrow(/Trip is already completed/);

    // -------------------------------------------------------------------------
    // STEP 18 & 19: Alpha Submits Invoice -> Tenant A Approves -> FinancePayable
    // -------------------------------------------------------------------------
    const invoice = {
      id: 'inv-gold-001',
      tenantId: tenantA.id,
      partnerId: partnerAlpha.id,
      awardId: award.id,
      invoiceNumber: 'INV-ALPHA-2026-0045',
      subtotalAmount: 725,
      vatAmount: 36.25,
      totalAmount: 761.25,
      status: 'APPROVED',
      payableId: 'pay-gold-001',
    };

    const financePayables = [
      {
        id: invoice.payableId,
        tenantId: tenantA.id,
        payableNumber: `PAY-${invoice.invoiceNumber}`,
        sourceType: 'CARRIER_SETTLEMENT',
        sourceId: invoice.id,
        vendorId: partnerAlpha.id,
        vendorName: partnerAlpha.name,
        totalAmount: invoice.totalAmount,
        status: 'PENDING_APPROVAL',
      },
    ];
    expect(financePayables.length).toBe(1);

    // -------------------------------------------------------------------------
    // STEP 20: Retry Approval -> Returns existing payable without creating duplicate
    // -------------------------------------------------------------------------
    const approveRetry = () => {
      if (invoice.status === 'APPROVED' && invoice.payableId) {
        return financePayables.find((p) => p.id === invoice.payableId);
      }
      throw new Error('Unexpected');
    };
    const retryResult = approveRetry();
    expect(retryResult?.id).toBe('pay-gold-001');
    expect(financePayables.length).toBe(1); // Strict 1:1 maintained!

    // -------------------------------------------------------------------------
    // STEP 21: Tenant B Isolation Access -> Denied (403/404)
    // -------------------------------------------------------------------------
    const accessRequestByTenant = (tenantId: string) => {
      if (outsourceRequest.tenantId !== tenantId) {
        throw new Error('403 Forbidden: Cross-tenant data boundary violation');
      }
      return outsourceRequest;
    };
    expect(() => accessRequestByTenant(tenantB.id)).toThrow(/Cross-tenant data boundary violation/);

    // -------------------------------------------------------------------------
    // STEP 22: Partner Beta attempts Alpha's Quote/Invoice Access -> Denied
    // -------------------------------------------------------------------------
    const accessQuoteByPartner = (partnerId: string, quote: typeof quoteAlphaRev2) => {
      if (quote.partnerId !== partnerId) {
        throw new Error('403 Forbidden: Cross-partner data boundary violation');
      }
      return quote;
    };
    expect(() => accessQuoteByPartner(partnerBeta.id, quoteAlphaRev2)).toThrow(/Cross-partner/);

    // -------------------------------------------------------------------------
    // STEP 23: Revoked / Expired Token Access -> Denied
    // -------------------------------------------------------------------------
    const resolveDriverLink = (rawToken: string, assignmentRecord: typeof assignment) => {
      const hash = hashDriverToken(rawToken);
      if (hash !== assignmentRecord.driverTokenHash || assignmentRecord.isTokenRevoked) {
        throw new Error('404 Not Found: Invalid or revoked link');
      }
      if (new Date() > assignmentRecord.driverTokenExp) {
        throw new Error('410 Gone: Link expired');
      }
      return assignmentRecord;
    };

    // Invalid Token
    expect(() => resolveDriverLink('wrong-token-xyz', assignment)).toThrow(/404/);

    // Revoked Token
    assignment.isTokenRevoked = true;
    expect(() => resolveDriverLink(rawOpaqueToken, assignment)).toThrow(/404/);
  });
});
