/**
 * tests/unit/exchange-phase4-governance-console.test.ts
 *
 * Phase 4 & Phase 5 Verification Suite:
 * 1. Buyer Partner Directory & Governance API (GET /api/exchange/partner/profile?mode=directory)
 *    - Returns networkPolicy, partner compliance eligibility gates (separated from performance scorecards),
 *      and rate cards with cryptographic SHA-256 snapshot hashes.
 * 2. Buyer Network Governance Actions (POST /api/exchange/scorecard)
 *    - UPDATE_NETWORK_POLICY (CLOSED | PREFERRED | EXTENDED + preferredExclusiveWindowMinutes)
 *    - UPDATE_RELATIONSHIP (PREFERRED | APPROVED | BLOCKED)
 *    - CREATE_RATE_CARD (versioned tariff + deterministic SHA-256 RateCardSnapshot)
 *    - TRIGGER_FAILOVER (delegates to ExceptionService.triggerGovernedFailoverResourcing)
 * 3. Partner Invoice Submission with Structured Ancillary Line Items (POST /api/exchange/invoices)
 * 4. Partner Settlement Statements & Non-Blocking Dispute Registration (GET/POST /api/exchange/invoices)
 * 5. Platform Admin Emergency Kill-Switch & Partner Operational Status Controls (/api/admin/exchange/partners)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockState = vi.hoisted(() => ({
  relationships: [] as any[],
  rateCards: [] as any[],
  existingRelationship: null as any,
  createdRateCard: null as any,
  failoverResult: null as any,
  submittedInvoiceInput: null as any,
  raisedDisputeInput: null as any,
  statements: [] as any[],
  invoices: [] as any[],
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async () => undefined),
  logAuditInTx: vi.fn(async () => undefined),
}));

vi.mock('@/lib/audited-action', () => ({
  withAuditedAction: (fn: any) => fn,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tenantPartnerRelationship: {
      findMany: vi.fn(async () => mockState.relationships),
      findFirst: vi.fn(async () => mockState.existingRelationship),
      update: vi.fn(async ({ data }: any) => ({ id: 'rel-1', ...data })),
      create: vi.fn(async ({ data }: any) => ({ id: 'rel-new', ...data })),
    },
    partnerRateCard: {
      findMany: vi.fn(async () => mockState.rateCards),
      create: vi.fn(async ({ data }: any) => {
        const created = {
          id: 'rc-101',
          createdAt: new Date('2026-11-07T10:00:00Z'),
          ...data,
        };
        mockState.createdRateCard = created;
        return created;
      }),
    },
    outsourceAward: {
      findFirst: vi.fn(async () => ({ id: 'aw-1', tenantId: 'tenant-buyer-1' })),
    },
    partnerInvoice: {
      findMany: vi.fn(async () => mockState.invoices),
      findFirst: vi.fn(async () => ({ id: 'inv-1', tenantId: 'tenant-buyer-1' })),
    },
    partnerSettlementStatement: {
      findMany: vi.fn(async () => mockState.statements),
    },
    transportPartner: {
      findMany: vi.fn(async () => []),
      update: vi.fn(async ({ where, data }: any) => ({
        id: where.id,
        legalName: 'Al Futtaim Logistics LLC',
        partnerCode: 'AFL-DXB',
        operationalStatus: data.operationalStatus,
      })),
    },
    tenant: {
      findMany: vi.fn(async () => []),
    },
    partnerUser: {
      findMany: vi.fn(async () => [
        {
          role: 'PARTNER_FINANCE',
          partner: {
            id: 'partner-1',
            legalName: 'Al Futtaim Logistics LLC',
            marketplaceStatus: 'APPROVED',
            operationalStatus: 'ACTIVE',
            onboardingStatus: 'APPROVED',
            emirate: 'DUBAI',
          },
        },
      ]),
    },
  },
}));

vi.mock('@/lib/rls', async () => {
  const { prisma } = await import('@/lib/prisma');
  return {
    withPlatformAdmin: vi.fn(async (_p: unknown, fn: (tx: unknown) => unknown) => fn(prisma)),
    withTenantRls: vi.fn(async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) => fn(prisma)),
  };
});

vi.mock('@/lib/rls-scope', () => ({
  runAsTenant: vi.fn(async (_t: string, fn: () => unknown) => fn()),
  getRlsTenantId: vi.fn(() => 'tenant-buyer-1'),
}));

vi.mock('@/lib/exchange/exception-service', () => ({
  ExceptionService: {
    triggerGovernedFailoverResourcing: vi.fn(async (input: any) => ({
      outcome: 'PROMOTED_STANDBY_RUNNER_UP',
      awardId: input.awardId,
      defaultingPartnerPenaltyAmount: 450,
      promotedPartnerId: 'partner-standby-2',
    })),
    sweepOverdueNoShowAssignments: vi.fn(async () => ({
      evaluatedCount: 4,
      overdueNoShowCount: 1,
      raisedExceptionIds: ['exc-noshow-1'],
      failoverOutcomes: [
        {
          outcome: 'PROMOTED_STANDBY_RUNNER_UP',
          previousPartnerId: 'partner-default-1',
          defaultingPartnerPenaltyAmount: 300,
          defaultingPartnerPenaltyPct: 25,
          promotedPartnerId: 'partner-standby-2',
          evaluatedRunnerUpCount: 2,
          skippedNonCompliantRunnerUps: [],
        },
      ],
    })),
  },
}));

vi.mock('@/lib/exchange/marketplace-service', () => ({
  MarketplaceService: {
    sweepExpiredOpportunities: vi.fn(async () => ({
      sweptCount: 2,
      expiredOpportunityIds: ['opp-exp-1', 'opp-exp-2'],
      zeroQuoteOpportunityIds: ['opp-exp-2'],
    })),
  },
}));

vi.mock('@/lib/exchange/partner-invoice-service', () => ({
  PartnerInvoiceService: {
    submitInvoice: vi.fn(async (input: any) => {
      mockState.submittedInvoiceInput = input;
      return {
        id: 'inv-1',
        ...input,
        verificationStatus: 'VARIANCE_REVIEW',
      };
    }),
  },
}));

vi.mock('@/lib/exchange/dispute-service', () => ({
  DisputeService: {
    raiseDispute: vi.fn(async (input: any) => {
      mockState.raisedDisputeInput = input;
      return {
        id: 'dsp-1',
        disputeNumber: 'DSP-991002',
        status: 'OPEN',
        ...input,
      };
    }),
  },
}));

import * as profileRoute from '@/app/api/exchange/partner/profile/route';
import * as scorecardRoute from '@/app/api/exchange/scorecard/route';
import * as invoicesRoute from '@/app/api/exchange/invoices/route';
import * as adminPartnersRoute from '@/app/api/admin/exchange/partners/route';
import { NetworkPolicyService } from '@/lib/exchange/network-policy-service';

const makeReq = (
  method: string,
  url: string,
  body?: unknown,
  tenantId = 'tenant-buyer-1',
  role = 'TENANT_ADMIN'
) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-user-id': 'user-ops-1',
      'x-tenant-id': tenantId,
      'x-user-role': role,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

describe('Phase 4 & Phase 5: Enterprise Network Governance, Settlement & Platform Kill-Switch APIs', () => {
  beforeEach(() => {
    NetworkPolicyService._resetForTests();
    mockState.relationships = [];
    mockState.rateCards = [];
    mockState.existingRelationship = null;
    mockState.createdRateCard = null;
    mockState.submittedInvoiceInput = null;
    mockState.raisedDisputeInput = null;
    mockState.statements = [];
    mockState.invoices = [];
  });

  it('GET /api/exchange/partner/profile?mode=directory returns partner compliance eligibility gates, scorecards, rate cards with SHA-256 hashes, and networkPolicy', async () => {
    const futureDate = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();
    mockState.relationships = [
      {
        id: 'rel-1',
        tenantId: 'tenant-buyer-1',
        partnerId: 'partner-1',
        status: 'PREFERRED',
        paymentTerms: 'Net 30',
        commercialNotes: 'Tier-1 Shuttle Partner',
        partner: {
          id: 'partner-1',
          legalName: 'Emirates Luxury Coaches',
          partnerCode: 'ELC-DXB',
          city: 'Dubai',
          onboardingStatus: 'APPROVED',
          operationalStatus: 'ACTIVE',
          capabilities: [{ domain: 'PASSENGER_TRANSPORT', isApproved: true }],
          complianceDocuments: [
            { id: 'doc-1', docType: 'TRADE_LICENSE', status: 'VALID', expiryDate: futureDate },
            { id: 'doc-2', docType: 'INSURANCE_POLICY', status: 'VALID', expiryDate: futureDate },
          ],
          vehicles: [{ id: 'v-1', licensePlate: 'DXB B 88210', vehicleType: '50-Seater Coach' }],
          drivers: [{ id: 'd-1', fullName: 'Tariq Mahmood', mobileNumber: '+971501112233' }],
          scorecard: {
            overallScore: 94.5,
            tier: 'PLATINUM',
            onTimeRate: 97.2,
            quoteResponseRate: 92.0,
            cancellationRate: 0.5,
          },
        },
      },
    ];

    mockState.rateCards = [
      {
        id: 'rc-1',
        tenantId: 'tenant-buyer-1',
        partnerId: 'partner-1',
        title: 'Dubai-Abu Dhabi Staff Shuttle v1',
        domain: 'PASSENGER_TRANSPORT',
        vehicleType: '50-Seater Coach',
        originZone: 'Dubai',
        destinationZone: 'Abu Dhabi',
        rateAmount: 1850,
        currency: 'AED',
        unitType: 'PER_TRIP',
        createdAt: new Date('2026-10-01T00:00:00Z'),
        partner: { id: 'partner-1', legalName: 'Emirates Luxury Coaches', partnerCode: 'ELC-DXB' },
      },
    ];

    const res = await profileRoute.GET(makeReq('GET', '/api/exchange/partner/profile?mode=directory'));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.networkPolicy.networkMode).toBe('CLOSED');
    expect(json.partners).toHaveLength(1);
    expect(json.partners[0]).toMatchObject({
      id: 'partner-1',
      relationshipStatus: 'PREFERRED',
      isPreferred: true,
      complianceEligible: true,
      validDocsCount: 2,
      expiredDocsCount: 0,
      latestScorecard: expect.objectContaining({ tier: 'PLATINUM', overallScore: 94.5 }),
    });

    expect(json.rateCards).toHaveLength(1);
    expect(json.rateCards[0].snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(json.rateCards[0].ancillaryCharges).toMatchObject({
      freeWaitingMinutes: 30,
      waitingFeePerHour: 100,
      cancellationFeePct: 25,
    });
  });

  it('POST /api/exchange/scorecard handles UPDATE_NETWORK_POLICY, UPDATE_RELATIONSHIP, CREATE_RATE_CARD, and TRIGGER_FAILOVER', async () => {
    // 1. UPDATE_NETWORK_POLICY
    const policyRes = await scorecardRoute.POST(
      makeReq('POST', '/api/exchange/scorecard', {
        action: 'UPDATE_NETWORK_POLICY',
        networkMode: 'PREFERRED',
        preferredExclusiveWindowMinutes: 45,
        allowExtendedPartnerInvites: false,
        requireConsortiumSharingConsent: true,
      })
    );
    expect(policyRes.status).toBe(200);
    const policyJson = await policyRes.json();
    expect(policyJson.networkPolicy).toMatchObject({
      accessMode: 'PREFERRED',
      networkMode: 'PREFERRED',
      preferredExclusiveWindowMinutes: 45,
      requireConsortiumSharingConsent: true,
    });

    // 2. UPDATE_RELATIONSHIP
    const relRes = await scorecardRoute.POST(
      makeReq('POST', '/api/exchange/scorecard', {
        action: 'UPDATE_RELATIONSHIP',
        partnerId: 'partner-1',
        status: 'PREFERRED',
      })
    );
    expect(relRes.status).toBe(200);
    const relJson = await relRes.json();
    expect(relJson.relationship.status).toBe('PREFERRED');

    // 3. CREATE_RATE_CARD
    const rcRes = await scorecardRoute.POST(
      makeReq('POST', '/api/exchange/scorecard', {
        action: 'CREATE_RATE_CARD',
        partnerId: 'partner-1',
        title: 'Executive Limo Airport Transfer v2',
        domain: 'LIMOUSINE',
        vehicleType: 'Mercedes S-Class',
        originZone: 'DXB Airport',
        destinationZone: 'DIFC',
        rateAmount: 650,
        unitType: 'PER_TRIP',
        freeWaitingMinutes: 45,
        waitingFeePerHour: 150,
        cancellationFeePct: 30,
      })
    );
    expect(rcRes.status).toBe(200);
    const rcJson = await rcRes.json();
    expect(rcJson.rateCard.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(rcJson.rateCard.ancillaryCharges).toMatchObject({
      freeWaitingMinutes: 45,
      waitingFeePerHour: 150,
      cancellationFeePct: 30,
    });

    // 4. TRIGGER_FAILOVER
    const failoverRes = await scorecardRoute.POST(
      makeReq('POST', '/api/exchange/scorecard', {
        action: 'TRIGGER_FAILOVER',
        awardId: 'award-failover-99',
        reasonCode: 'SLA_NO_SHOW',
        severity: 'CRITICAL',
      })
    );
    expect(failoverRes.status).toBe(200);
    const failoverJson = await failoverRes.json();
    expect(failoverJson.failover).toMatchObject({
      outcome: 'PROMOTED_STANDBY_RUNNER_UP',
      awardId: 'award-failover-99',
      defaultingPartnerPenaltyAmount: 450,
    });

    // 5. RUN_SLA_SWEEPER (Phase 16 ARCH-2)
    const sweeperRes = await scorecardRoute.POST(
      makeReq('POST', '/api/exchange/scorecard', {
        action: 'RUN_SLA_SWEEPER',
        graceMinutes: 30,
        autoTriggerFailover: true,
      })
    );
    expect(sweeperRes.status).toBe(200);
    const sweeperJson = await sweeperRes.json();
    expect(sweeperJson.sweeper.expiredOpportunities.sweptCount).toBe(2);
    expect(sweeperJson.sweeper.overdueNoShows.overdueNoShowCount).toBe(1);
    expect(sweeperJson.sweeper.overdueNoShows.failoverOutcomes).toHaveLength(1);
  });

  it('POST /api/exchange/invoices forwards structured ancillary line items (WAITING_TIME, TOLL_PARKING) for 3-way reconciliation', async () => {
    const invRes = await invoicesRoute.POST(
      makeReq('POST', '/api/exchange/invoices', {
        awardId: 'aw-1',
        invoiceNumber: 'INV-AFL-2026-009',
        subtotalAmount: 2150,
        vatAmount: 107.5,
        items: [
          { description: 'Base Trip', varianceReason: 'BASE_RATE', quantity: 1, unitPrice: 1850 },
          { description: 'Waiting 2h beyond 30m allowance', varianceReason: 'WAITING_TIME', quantity: 1, unitPrice: 200 },
          { description: 'Salik & Darb Tolls', varianceReason: 'TOLL_PARKING', quantity: 1, unitPrice: 100 },
        ],
      })
    );

    expect(invRes.status).toBe(200);
    expect(mockState.submittedInvoiceInput).toMatchObject({
      partnerId: 'partner-1',
      awardId: 'aw-1',
      invoiceNumber: 'INV-AFL-2026-009',
      subtotalAmount: 2150,
    });
    expect(mockState.submittedInvoiceInput.items).toHaveLength(3);
    expect(mockState.submittedInvoiceInput.items[1].varianceReason).toBe('WAITING_TIME');
  });

  it('Phase 5.1: GET /api/exchange/invoices?includeStatements=1 returns partner settlement statements and POST action=RAISE_DISPUTE registers a non-blocking commercial dispute', async () => {
    mockState.statements = [
      {
        id: 'stmt-1',
        statementNumber: 'STMT-2026-11-001',
        grossAmount: 18500,
        vatAmount: 925,
        totalDeductions: 450,
        netPayable: 18975,
        status: 'ISSUED',
      },
    ];

    const getRes = await invoicesRoute.GET(
      makeReq('GET', '/api/exchange/invoices?includeStatements=1')
    );
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json();
    expect(getJson.statements).toHaveLength(1);
    expect(getJson.statements[0].statementNumber).toBe('STMT-2026-11-001');

    const dspRes = await invoicesRoute.POST(
      makeReq('POST', '/api/exchange/invoices', {
        action: 'RAISE_DISPUTE',
        invoiceId: 'inv-1',
        disputedAmount: 200,
        reason: 'Gate log confirms 2.5h detention at Jebel Ali Terminal 2',
      })
    );
    expect(dspRes.status).toBe(200);
    const dspJson = await dspRes.json();
    expect(dspJson.dispute).toMatchObject({
      disputeNumber: 'DSP-991002',
      disputedAmount: 200,
      status: 'OPEN',
    });
    expect(mockState.raisedDisputeInput).toMatchObject({
      tenantId: 'tenant-buyer-1',
      partnerId: 'partner-1',
      invoiceId: 'inv-1',
      disputedAmount: 200,
    });
  });

  it('Phase 5.3: Platform Admin can toggle Emergency Kill Switch and update Partner Operational Status via /api/admin/exchange/partners', async () => {
    // 1. Activate Kill Switch
    const activateRes = await adminPartnersRoute.POST(
      makeReq(
        'POST',
        '/api/admin/exchange/partners',
        { action: 'SET_KILL_SWITCH', active: true, reason: 'FTA Regulatory Audit Hold' },
        'platform',
        'SUPER_ADMIN'
      )
    );
    expect(activateRes.status).toBe(200);
    const activateJson = await activateRes.json();
    expect(activateJson.killSwitch).toMatchObject({
      active: true,
      reason: 'FTA Regulatory Audit Hold',
    });

    // 2. Verify GET ?includeKillSwitch=1 reflects active kill switch
    const listRes = await adminPartnersRoute.GET(
      makeReq('GET', '/api/admin/exchange/partners?includeKillSwitch=1', undefined, 'platform', 'SUPER_ADMIN')
    );
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.killSwitch.active).toBe(true);

    // 3. Suspend Partner Operational Status
    const statusRes = await adminPartnersRoute.POST(
      makeReq(
        'POST',
        '/api/admin/exchange/partners',
        { action: 'SET_PARTNER_OPERATIONAL_STATUS', partnerId: 'partner-1', operationalStatus: 'SUSPENDED' },
        'platform',
        'SUPER_ADMIN'
      )
    );
    expect(statusRes.status).toBe(200);
    const statusJson = await statusRes.json();
    expect(statusJson.partner.operationalStatus).toBe('SUSPENDED');
  });
});
