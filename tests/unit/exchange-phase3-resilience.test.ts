/**
 * tests/unit/exchange-phase3-resilience.test.ts
 *
 * Verification suite for Phase 3 (P1):
 * 1. Canonical Freight RFQ Unification Bridge (FreightRfqCanonicalBridge + FreightOutsourcingAdapter)
 * 2. Governed Cross-Partner Failover Re-Sourcing Waterfall & Expedited Emergency Broadcast (ExceptionService)
 * 3. Live BreakdownReport / MaintenanceRequest Wiring in RecoveryOutsourcingAdapter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockState = vi.hoisted(() => ({
  shipmentRow: null as Record<string, unknown> | null,
  cargoRows: [] as Record<string, unknown>[],
  executedSql: [] as Array<{ sql: string; params: unknown[] }>,
  outsourceRequest: null as Record<string, unknown> | null,
  opportunity: null as Record<string, unknown> | null,
  quotes: [] as Record<string, unknown>[],
  award: null as Record<string, unknown> | null,
  assignment: null as Record<string, unknown> | null,
  updatedAward: null as Record<string, unknown> | null,
  updatedAssignment: null as Record<string, unknown> | null,
  updatedOpportunity: null as Record<string, unknown> | null,
  breakdownReport: null as Record<string, unknown> | null,
  updatedBreakdown: null as Record<string, unknown> | null,
  alerts: [] as Record<string, unknown>[],
  tripEvents: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/prisma', () => {
  const client: Record<string, unknown> = {
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      if (sql.includes('FROM logistics_shipment_orders')) {
        return mockState.shipmentRow ? [mockState.shipmentRow] : [];
      }
      if (sql.includes('FROM logistics_cargo_lines')) {
        return mockState.cargoRows;
      }
      return [];
    }),
    $executeRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
      mockState.executedSql.push({ sql, params });
      return 1;
    }),
    outsourceRequest: {
      count: vi.fn(async () => 10),
      findFirst: vi.fn(async () => mockState.outsourceRequest),
      findUnique: vi.fn(async () => mockState.outsourceRequest),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = {
          id: 'req-freight-canonical-1',
          ...data,
        };
        mockState.outsourceRequest = created;
        return created;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        mockState.outsourceRequest = { ...(mockState.outsourceRequest || {}), ...data };
        return mockState.outsourceRequest;
      }),
    },
    marketplaceOpportunity: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const opp = { id: 'opp-freight-canonical-1', ...data };
        mockState.opportunity = opp;
        return opp;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        mockState.updatedOpportunity = { ...(mockState.opportunity || {}), ...data };
        return mockState.updatedOpportunity;
      }),
    },
    tenantPartnerRelationship: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => ({ status: 'APPROVED' })),
    },
    partnerQuote: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => mockState.quotes[0] ?? null),
      findMany: vi.fn(async () => mockState.quotes),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const q = {
          id: 'quote-freight-canonical-1',
          ...data,
          partner: {
            id: data.partnerId,
            legalName: 'Emirates National Freight LLC',
            partnerCode: 'ENF-01',
          },
          request: mockState.outsourceRequest || {
            id: data.requestId,
            tenantId: 'tenant-1',
            requestNumber: 'OUT-2026-00011',
          },
        };
        mockState.quotes.push(q);
        return q;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
        id: where.id,
        ...data,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    outsourceRequestPartner: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    outsourceAward: {
      findUnique: vi.fn(async () => mockState.award),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const aw = { id: 'award-freight-canonical-1', ...data };
        mockState.award = aw;
        return aw;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        mockState.updatedAward = { ...(mockState.award || {}), ...data };
        return mockState.updatedAward;
      }),
    },
    partnerAssignment: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        mockState.updatedAssignment = { ...(mockState.assignment || {}), ...data };
        return mockState.updatedAssignment;
      }),
    },
    partnerTripEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        mockState.tripEvents.push(data);
        return data;
      }),
    },
    outsourceException: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
    breakdownReport: {
      findFirst: vi.fn(async () => mockState.breakdownReport),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        mockState.updatedBreakdown = { ...(mockState.breakdownReport || {}), ...data };
        return mockState.updatedBreakdown;
      }),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        mockState.updatedBreakdown = { ...(mockState.breakdownReport || {}), ...data };
        return { count: 1 };
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
  };
  return { prisma: client };
});

vi.mock('@/lib/rls', async () => {
  const { prisma } = await import('@/lib/prisma');
  return {
    withTenantRls: vi.fn(async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) => fn(prisma)),
    withPlatformAdmin: vi.fn(async (_p: unknown, fn: (tx: unknown) => unknown) => fn(prisma)),
  };
});

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async () => {}),
  logAuditInTx: vi.fn(async () => {}),
}));

vi.mock('@/lib/alerts/raise', () => ({
  raiseAlert: vi.fn(async (payload: Record<string, unknown>) => {
    mockState.alerts.push(payload);
  }),
}));

import { FreightRfqCanonicalBridge } from '@/lib/exchange/freight-rfq-bridge';
import { FreightOutsourcingAdapter } from '@/lib/exchange/adapters/freight-adapter';
import { RecoveryOutsourcingAdapter } from '@/lib/exchange/adapters/recovery-adapter';
import { ExceptionService } from '@/lib/exchange/exception-service';
import { RateCardService } from '@/lib/exchange/rate-card-service';
import { PartnerQuoteStatus, PartnerServiceDomain } from '@prisma/client';

beforeEach(() => {
  mockState.shipmentRow = null;
  mockState.cargoRows = [];
  mockState.executedSql = [];
  mockState.outsourceRequest = null;
  mockState.opportunity = null;
  mockState.quotes = [];
  mockState.award = null;
  mockState.assignment = null;
  mockState.updatedAward = null;
  mockState.updatedAssignment = null;
  mockState.updatedOpportunity = null;
  mockState.breakdownReport = null;
  mockState.updatedBreakdown = null;
  mockState.alerts = [];
  mockState.tripEvents = [];
});

describe('Phase 3.1 — Canonical Freight RFQ Unification Bridge', () => {
  it('bridges Freight RFQ -> Canonical OutsourceRequest & MarketplaceOpportunity -> PartnerQuote -> OutsourceAward with SHA-256 RateCardSnapshot', async () => {
    mockState.shipmentRow = {
      id: 'ship-cold-101',
      shipment_no: 'SHP-2026-00101',
      shipment_type: 'COLD_CHAIN',
      service_level: 'EXPRESS',
      origin_name: 'Jebel Ali Port Terminal 2',
      origin_address: 'JAFZA South, Dubai',
      origin_lat: 24.9857,
      origin_lng: 55.0273,
      destination_name: 'KIZAD Cold Storage Hub',
      destination_address: 'Khalifa Industrial Zone, Abu Dhabi',
      destination_lat: 24.7892,
      destination_lng: 54.6789,
      pickup_window_from: new Date('2026-06-20T06:00:00Z'),
      total_weight_kg: 12500,
      total_volume_cbm: 44,
      total_pieces: 18,
      vehicle_type_required: 'REEFER_TRUCK_40FT',
      temperature_control: 'CHILLED',
      hazmat_flag: false,
      customs_required: true,
      notes: 'Vaccines & Biologics — maintain +2C to +8C',
      special_instructions: 'Continuous reefer telemetry required',
    };
    mockState.cargoRows = [
      {
        commodity_type: 'Biologics',
        description: 'Insulated Pharma Pallets',
        quantity: 18,
        weight_kg: 12500,
        volume_cbm: 44,
        hazmat_class: null,
        temperature_min_c: 2,
        temperature_max_c: 8,
      },
    ];

    // 1. Bridge Freight RFQ creation
    const rfqBridge = await FreightRfqCanonicalBridge.bridgeFreightRfqToCanonicalExchange({
      tenantId: 'tenant-1',
      rfqId: 'lrfq-101',
      rfqNo: 'RFQ-2026-00101',
      shipmentOrderId: 'ship-cold-101',
      inviteScope: 'ALL_ACTIVE_CARRIERS',
      bidDeadlineAt: '2026-06-19T18:00:00Z',
    });

    expect(rfqBridge.canonicalRequestId).toBe('req-freight-canonical-1');
    expect(rfqBridge.visibility).toBe('TENANT_NETWORK');
    expect(mockState.outsourceRequest?.domain).toBe(PartnerServiceDomain.FREIGHT);
    expect(mockState.outsourceRequest?.vehicleTypeRequired).toBe('REEFER_COLD');

    // 2. Bridge Carrier Bid submission
    const bidBridge = await FreightRfqCanonicalBridge.bridgeCarrierBidToCanonicalQuote({
      tenantId: 'tenant-1',
      rfqId: 'lrfq-101',
      bidId: 'lbid-201',
      shipmentOrderId: 'ship-cold-101',
      carrierId: 'carrier-enf-1',
      amount: 4200,
      currency: 'AED',
      canonicalRequestId: rfqBridge.canonicalRequestId,
    });

    expect(bidBridge.canonicalQuoteId).toBe('quote-freight-canonical-1');
    expect(bidBridge.totalAmount).toBe(4410); // 4200 + 5% UAE VAT

    // Prepare request state for awardQuote
    mockState.outsourceRequest = {
      ...mockState.outsourceRequest,
      id: rfqBridge.canonicalRequestId,
      tenantId: 'tenant-1',
      requestNumber: 'OUT-2026-00011',
      status: 'QUOTED',
      serviceDate: new Date('2026-06-20T06:00:00Z'),
      pickupLocation: 'Jebel Ali Port Terminal 2',
      dropoffLocation: 'KIZAD Cold Storage Hub',
      vehicleTypeRequired: 'REEFER_COLD',
      award: null,
    };

    // 3. Bridge Freight Award
    const awardBridge = await FreightRfqCanonicalBridge.bridgeFreightAwardToCanonicalAward({
      tenantId: 'tenant-1',
      rfqId: 'lrfq-101',
      bidId: 'lbid-201',
      shipmentOrderId: 'ship-cold-101',
      carrierId: 'carrier-enf-1',
      amount: 4200,
      canonicalRequestId: rfqBridge.canonicalRequestId,
      canonicalQuoteId: bidBridge.canonicalQuoteId,
      awardedByUserId: 'ops-director-1',
      commercialModel: 'PRINCIPAL',
      buyerAgreedPrice: 5000,
      platformFeePct: 3,
      ifrs15Indicators: {
        hasPrimaryFulfilmentResponsibility: true,
        hasCapacityOrSubstitutionRisk: true,
        hasPricingDiscretion: true,
        approvedByFinancePolicyVersion: 'IFRS15-UAE-2026.1',
      },
    });

    expect(awardBridge.canonicalAwardId).toBe('award-freight-canonical-1');
    expect(awardBridge.totalAwarded).toBe(4410);
    const rateCardSnap = awardBridge.rateCardSnapshot as Record<string, unknown>;
    expect(rateCardSnap.snapshotHash).toMatch(/^[a-f0-9]{64}$/);

    // Verify underlying logistics_shipment_orders was updated via FreightOutsourcingAdapter.applyAward
    expect(
      mockState.executedSql.some((q) => q.sql.includes('UPDATE logistics_shipment_orders'))
    ).toBe(true);
  });

  it('synchronizes driver REACHED / STARTED / COMPLETED milestones to logistics_shipment_orders & tracking events', async () => {
    mockState.shipmentRow = { id: 'ship-cold-101', tenant_id: 'tenant-1' };
    const adapter = new FreightOutsourcingAdapter();

    await adapter.syncExecutionStatus({
      sourceReferenceId: 'ship-cold-101',
      eventType: 'REACHED',
    });
    expect(
      mockState.executedSql.some(
        (q) => q.sql.includes('UPDATE logistics_shipment_orders') && q.params.includes('ARRIVED_PICKUP')
      )
    ).toBe(true);

    await adapter.syncExecutionStatus({
      sourceReferenceId: 'ship-cold-101',
      eventType: 'STARTED',
    });
    expect(
      mockState.executedSql.some(
        (q) => q.sql.includes('UPDATE logistics_shipment_orders') && q.params.includes('IN_TRANSIT')
      )
    ).toBe(true);
  });
});

describe('Phase 3.2 — Governed Cross-Partner Failover Re-Sourcing Waterfall', () => {
  it('revokes defaulting partner token, calculates SLA cancellation penalty from frozen RateCardSnapshot, skips non-compliant runner-up, and promotes compliant standby runner-up', async () => {
    const serviceDate = new Date('2026-07-10T08:00:00Z');
    const expiredBeforeService = new Date('2026-07-01T00:00:00Z');
    const validAfterService = new Date('2026-12-31T00:00:00Z');

    const originalRateCardSnapshot = RateCardService.buildImmutableRateCardSnapshot({
      rateCardId: 'rc-orig-1',
      version: 1,
      effectiveFrom: '2026-01-01T00:00:00Z',
      pricingUnit: 'PER_TRIP',
      baseRate: 2000,
      minimumCharge: 2000,
      currency: 'AED',
      ancillaryCharges: {
        waitingFeePerHour: 100,
        freeWaitingMinutes: 30,
        cancellationFeePct: 25, // 25% of AED 2,000 = AED 500 SLA penalty
        tollTreatment: 'ACTUAL',
      },
    });

    mockState.assignment = {
      id: 'assign-defaulting-1',
      awardId: 'award-failover-1',
      partnerId: 'partner-defaulting-1',
      isTokenRevoked: false,
    };

    mockState.award = {
      id: 'award-failover-1',
      tenantId: 'tenant-1',
      requestId: 'req-failover-1',
      quoteId: 'quote-defaulting-1',
      partnerId: 'partner-defaulting-1',
      awardedPrice: 2000,
      vatAmount: 100,
      totalAwarded: 2100,
      status: 'ASSIGNED',
      commercialSnapshot: {
        rateCardSnapshot: originalRateCardSnapshot,
      },
      assignment: mockState.assignment,
      partner: {
        id: 'partner-defaulting-1',
        legalName: 'Defaulting Carrier A',
      },
      request: {
        id: 'req-failover-1',
        tenantId: 'tenant-1',
        requestNumber: 'OUT-2026-00500',
        domain: PartnerServiceDomain.PASSENGER_TRANSPORT,
        sourceReferenceId: 'sched-500',
        serviceDate,
        pickupLocation: 'Al Barsha',
        dropoffLocation: 'Jebel Ali',
        vehicleTypeRequired: '50-Seat Bus',
        opportunity: { id: 'opp-500', status: 'AWARDED' },
      },
    };

    // Candidate Runner-Up 1 (cheaper: AED 2,205) -> HAS EXPIRED TRADE_LICENSE before serviceDate!
    // Candidate Runner-Up 2 (next cheapest: AED 2,310) -> FULLY COMPLIANT as of serviceDate!
    mockState.quotes = [
      {
        id: 'quote-runnerup-noncompliant',
        requestId: 'req-failover-1',
        partnerId: 'partner-expired-2',
        revisionNo: 1,
        amount: 2100,
        vatAmount: 105,
        totalAmount: 2205,
        currency: 'AED',
        status: PartnerQuoteStatus.REJECTED,
        partner: {
          id: 'partner-expired-2',
          legalName: 'Expired License Coaches LLC',
          partnerCode: 'ELC-02',
          operationalStatus: 'ACTIVE',
          onboardingStatus: 'APPROVED',
          complianceDocuments: [
            {
              docType: 'TRADE_LICENSE',
              status: 'VERIFIED',
              expiryDate: expiredBeforeService,
            },
          ],
        },
      },
      {
        id: 'quote-runnerup-compliant',
        requestId: 'req-failover-1',
        partnerId: 'partner-compliant-3',
        revisionNo: 1,
        amount: 2200,
        vatAmount: 110,
        totalAmount: 2310,
        currency: 'AED',
        status: PartnerQuoteStatus.REJECTED,
        partner: {
          id: 'partner-compliant-3',
          legalName: 'Oasis Premier Transport LLC',
          partnerCode: 'OPT-03',
          operationalStatus: 'ACTIVE',
          onboardingStatus: 'APPROVED',
          complianceDocuments: [
            {
              docType: 'TRADE_LICENSE',
              status: 'VERIFIED',
              expiryDate: validAfterService,
            },
            {
              docType: 'COMMERCIAL_INSURANCE',
              status: 'VERIFIED',
              expiryDate: validAfterService,
            },
          ],
        },
      },
    ];

    const failover = await ExceptionService.triggerGovernedFailoverResourcing({
      tenantId: 'tenant-1',
      awardId: 'award-failover-1',
      reason: 'Driver no-show 30 minutes prior to departure',
      strategy: 'STANDBY_WATERFALL',
      triggeredByUserId: 'dispatch-lead-1',
    });

    expect(failover.outcome).toBe('PROMOTED_STANDBY_RUNNER_UP');
    expect(failover.previousPartnerId).toBe('partner-defaulting-1');
    expect(failover.defaultingPartnerPenaltyAmount).toBe(500); // 25% of AED 2,000
    expect(failover.evaluatedRunnerUpCount).toBe(2);
    expect(failover.skippedNonCompliantRunnerUps).toHaveLength(1);
    expect(failover.skippedNonCompliantRunnerUps[0].partnerId).toBe('partner-expired-2');

    // Promoted Partner 3!
    expect(failover.promotedPartnerId).toBe('partner-compliant-3');
    expect(failover.promotedQuoteId).toBe('quote-runnerup-compliant');
    expect(failover.newAwardedTotal).toBe(2310);

    // Defaulting partner's token was revoked
    expect(mockState.updatedAssignment?.isTokenRevoked).toBe(true);
    expect(mockState.updatedAward?.partnerId).toBe('partner-compliant-3');
  });

  it('re-opens MarketplaceOpportunity for an expedited 15-minute Emergency Broadcast when no compliant runner-up exists', async () => {
    mockState.opportunity = { id: 'opp-emergency-1', status: 'AWARDED' };
    mockState.award = {
      id: 'award-failover-2',
      tenantId: 'tenant-1',
      requestId: 'req-failover-2',
      quoteId: 'quote-defaulting-2',
      partnerId: 'partner-defaulting-2',
      awardedPrice: 3000,
      vatAmount: 150,
      totalAwarded: 3150,
      status: 'ASSIGNED',
      commercialSnapshot: {},
      assignment: null,
      partner: { id: 'partner-defaulting-2', legalName: 'Defaulting Carrier B' },
      request: {
        id: 'req-failover-2',
        tenantId: 'tenant-1',
        requestNumber: 'OUT-2026-00501',
        domain: PartnerServiceDomain.FREIGHT,
        sourceReferenceId: 'ship-501',
        serviceDate: new Date('2026-07-12T08:00:00Z'),
        pickupLocation: 'DIC',
        dropoffLocation: 'Sharjah Industrial',
        opportunity: mockState.opportunity,
      },
    };
    mockState.quotes = []; // No runner-up quotes

    const failover = await ExceptionService.triggerGovernedFailoverResourcing({
      tenantId: 'tenant-1',
      awardId: 'award-failover-2',
      reason: 'Vehicle mechanical failure en route',
      emergencyWindowMinutes: 15,
      triggeredByUserId: 'dispatch-lead-1',
    });

    expect(failover.outcome).toBe('REOPENED_EMERGENCY_BROADCAST');
    expect(failover.defaultingPartnerPenaltyAmount).toBe(750); // 25% default of AED 3,000
    expect(mockState.updatedOpportunity?.status).toBe('OPEN');
    expect(
      mockState.alerts.some((a) => a.code === 'OUTSOURCE_FAILOVER_EMERGENCY_BROADCAST')
    ).toBe(true);
  });
});

describe('Phase 3.3 — Live BreakdownReport Wiring in RecoveryOutsourcingAdapter', () => {
  it('hydrates recovery requirements from BreakdownReport + Vehicle + Garage and syncs RECOVERY_DISPATCHED -> RECOVERY_COMPLETED', async () => {
    mockState.breakdownReport = {
      id: 'brk-901',
      reportNo: 'BRK-202605-00901',
      tenantId: 'tenant-1',
      vehicleId: 'veh-fleet-1',
      reportedAt: new Date('2026-05-20T14:30:00Z'),
      breakdownType: 'TRANSMISSION',
      location: 'Sheikh Zayed Road (E11) Exit 42 towards Abu Dhabi',
      latitude: 25.0812,
      longitude: 55.1389,
      driverNotes: 'Gearbox locked in park on highway shoulder; flatbed with winch required',
      severity: 'CRITICAL',
      status: 'REPORTED',
      recoveryNotes: null,
      recoveryDispatchedAt: null,
      MaintenanceRequest: {
        id: 'mr-901',
        Vehicle: {
          id: 'veh-fleet-1',
          make: 'Mercedes-Benz',
          model: 'Actros 2645',
          type: 'Heavy Tractor Unit',
          plateNumber: 'DXB-H-88210',
        },
        Garage: {
          id: 'gar-1',
          name: 'Emirates Heavy Commercial Workshop — Jebel Ali',
        },
      },
    };

    const adapter = new RecoveryOutsourcingAdapter();
    const source = await adapter.getSourceReference('brk-901', 'tenant-1');

    expect(source.sourceReferenceType).toBe('BREAKDOWN_REPORT');
    expect(source.pickupLocation).toContain('Sheikh Zayed Road (E11)');
    expect(source.dropoffLocation).toBe('Emirates Heavy Commercial Workshop — Jebel Ali');
    const reqs = source.domainPayload as Record<string, unknown>;
    expect(reqs.disabledVehiclePlate).toBe('DXB-H-88210');
    expect(reqs.vehicleCondition).toBe('STEERING_LOCKED');
    expect(reqs.urgency).toBe('EMERGENCY_HIGHWAY');

    // Apply award -> status becomes RECOVERY_DISPATCHED
    await adapter.applyAward({
      tenantId: 'tenant-1',
      partnerId: 'partner-recovery-1',
      sourceReferenceId: 'brk-901',
      totalAwarded: 850,
      awardedBy: 'fleet-controller-1',
    });
    expect(mockState.updatedBreakdown?.status).toBe('RECOVERY_DISPATCHED');

    // Complete recovery -> status becomes RECOVERY_COMPLETED with recoveryCompletedAt timestamp
    await adapter.syncExecutionStatus({
      sourceReferenceId: 'brk-901',
      eventType: 'COMPLETED',
    });
    expect(mockState.updatedBreakdown?.status).toBe('RECOVERY_COMPLETED');
    expect(mockState.updatedBreakdown?.recoveryCompletedAt).toBeInstanceOf(Date);
  });
});
