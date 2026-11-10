/**
 * tests/unit/exchange-phase1-phase2-governance.test.ts
 *
 * Comprehensive verification suite for the Private Partner Exchange Network:
 * - Phase 1 (P0): Trust & Transaction Integrity
 *   1. 3-Stage Synchronous Pre-Dispatch Compliance Guard (serviceDate cutoff + Stage-3 token revocation)
 *   2. 3-Mode Network Access Policy (CLOSED | PREFERRED | EXTENDED), Preferred Exclusive Window,
 *      Consortium Sharing Consent, Sanitized Discovery & Platform Emergency Kill Switch
 *   3. Immutable Rate-Card Versioning & SHA-256 Commercial Snapshot + Idempotent Award + Multi-Domain Direct Award
 * - Phase 2 (P0): Financial Completeness
 *   1. Spread, Commission & IFRS 15 Commercial Ledger (AGENCY Option 1, AGENCY Option 2 Net-Remit, PRINCIPAL)
 *   2. 3-Way Financial Reconciliation against Frozen Rate-Card Snapshot & Execution Timestamps
 *   3. PartnerInvoiceService & SettlementService GL & Commission Integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => ({
  assignment: null as Record<string, unknown> | null,
  award: null as Record<string, unknown> | null,
  request: null as Record<string, unknown> | null,
  quote: null as Record<string, unknown> | null,
  partner: null as Record<string, unknown> | null,
  vehicle: null as Record<string, unknown> | null,
  driver: null as Record<string, unknown> | null,
  invoice: null as Record<string, unknown> | null,
  updatedAssignment: null as Record<string, unknown> | null,
  tripEvents: [] as Record<string, unknown>[],
  alerts: [] as Record<string, unknown>[],
  draftJournals: [] as Record<string, unknown>[],
  integrationConfigs: [] as Record<string, unknown>[],
  awardsList: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/prisma', () => {
  const client: Record<string, unknown> = {
    partnerAssignment: {
      findUnique: vi.fn(async () => mockDb.assignment),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        mockDb.updatedAssignment = { ...(mockDb.assignment || {}), ...data };
        return mockDb.updatedAssignment;
      }),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => ({
        id: 'assign-1',
        ...create,
      })),
    },
    partnerVehicle: {
      findUnique: vi.fn(async () => mockDb.vehicle),
    },
    partnerDriver: {
      findUnique: vi.fn(async () => mockDb.driver),
    },
    partnerTripEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        mockDb.tripEvents.push(data);
        return data;
      }),
    },
    outsourceRequest: {
      findUnique: vi.fn(async () => mockDb.request),
      findFirst: vi.fn(async () => mockDb.request),
      findMany: vi.fn(async () => (mockDb.request ? [mockDb.request] : [])),
      count: vi.fn(async () => 4),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'req-direct-1',
        ...data,
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
    partnerQuote: {
      findUnique: vi.fn(async () => mockDb.quote),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'quote-direct-1',
        ...data,
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    outsourceRequestPartner: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    tenantPartnerRelationship: {
      findUnique: vi.fn(async () => ({ status: 'APPROVED' })),
    },
    transportPartner: {
      findUnique: vi.fn(async () => mockDb.partner),
    },
    outsourceAward: {
      findUnique: vi.fn(async () => mockDb.award),
      findMany: vi.fn(async () => mockDb.awardsList),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'award-new-1',
        ...data,
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
    integrationConfig: {
      findMany: vi.fn(async () => mockDb.integrationConfigs),
      upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const row = { ...create, ...update };
        mockDb.integrationConfigs.push(row);
        return row;
      }),
    },
    partnerInvoice: {
      findUnique: vi.fn(async () => mockDb.invoice),
      findMany: vi.fn(async () => (mockDb.invoice ? [mockDb.invoice] : [])),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...(mockDb.invoice || {}),
        ...data,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    financePayable: {
      findUnique: vi.fn(async () => ({ id: 'pay-existing-1', status: 'APPROVED' })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'pay-new-1',
        ...data,
      })),
    },
    partnerSettlementStatement: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'stm-1',
        ...data,
      })),
    },
    tenant: {
      findUnique: vi.fn(async () => ({ id: 'tenant-1', trn: '100222333444003' })),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
  };
  return { prisma: client };
});

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async () => {}),
  logAuditInTx: vi.fn(async () => {}),
}));

vi.mock('@/lib/alerts/raise', () => ({
  raiseAlert: vi.fn(async (payload: Record<string, unknown>) => {
    mockDb.alerts.push(payload);
  }),
}));

vi.mock('@/lib/finance/journal-service', () => ({
  createDraftJournalEntry: vi.fn(async (input: Record<string, unknown>) => {
    mockDb.draftJournals.push(input);
    return {
      id: 'je-1',
      entryNumber: 'JE-2026-0001',
      idempotencyKey: input.idempotencyKey,
    };
  }),
}));

import { PreDispatchComplianceGuard } from '@/lib/exchange/compliance-guard';
import { NetworkPolicyService } from '@/lib/exchange/network-policy-service';
import { RateCardService } from '@/lib/exchange/rate-card-service';
import { OutsourceEngine } from '@/lib/exchange/outsource-engine';
import { ExchangeCommercialLedgerService } from '@/lib/exchange/commercial-ledger-service';
import { SettlementReconciliationService } from '@/lib/exchange/reconciliation-service';
import { PartnerInvoiceService } from '@/lib/exchange/partner-invoice-service';
import { SettlementService } from '@/lib/exchange/settlement-service';
import { DeductionType, PartnerServiceDomain } from '@prisma/client';

beforeEach(() => {
  mockDb.assignment = null;
  mockDb.award = null;
  mockDb.request = null;
  mockDb.quote = null;
  mockDb.partner = null;
  mockDb.vehicle = null;
  mockDb.driver = null;
  mockDb.invoice = null;
  mockDb.updatedAssignment = null;
  mockDb.tripEvents = [];
  mockDb.alerts = [];
  mockDb.draftJournals = [];
  NetworkPolicyService._resetForTests();
});

describe('Phase 1.1 — 3-Stage Synchronous Pre-Dispatch Compliance Guard', () => {
  it('Stage 2: rejects vehicle, driver, and company documents that expire BEFORE future serviceDate even if valid today', () => {
    const now = new Date('2026-05-01T08:00:00Z');
    const futureServiceDate = new Date('2026-05-15T08:00:00Z');
    // Expires May 10 (valid today on May 1, but expired by serviceDate May 15!)
    const expiresBetweenNowAndService = new Date('2026-05-10T00:00:00Z');
    const validAfterService = new Date('2026-12-31T00:00:00Z');

    const result = PreDispatchComplianceGuard.evaluate(
      {
        asOfDate: now,
        serviceDate: futureServiceDate,
        partner: {
          id: 'partner-1',
          legalName: 'Al Futtaim Transport',
          operationalStatus: 'ACTIVE',
          marketplaceStatus: 'APPROVED',
          onboardingStatus: 'APPROVED',
          complianceDocuments: [
            {
              docType: 'TRADE_LICENSE',
              status: 'VERIFIED',
              expiryDate: expiresBetweenNowAndService,
            },
            {
              docType: 'COMMERCIAL_INSURANCE',
              status: 'VERIFIED',
              expiryDate: validAfterService,
            },
          ],
        },
        vehicle: {
          id: 'veh-1',
          licensePlate: 'DXB-B-55412',
          isActive: true,
          mulkiyaExpiry: expiresBetweenNowAndService,
        },
        driver: {
          id: 'drv-1',
          fullName: 'Rashid Khan',
          isActive: true,
          licenseExpiry: expiresBetweenNowAndService,
          permitExpiry: validAfterService,
        },
      },
      'ASSIGNMENT'
    );

    expect(result.ok).toBe(false);
    const codes = result.blockers.map((b) => b.code);
    expect(codes).toContain('COMPANY_TRADE_LICENSE_EXPIRED');
    expect(codes).toContain('VEHICLE_MULKIYA_EXPIRED');
    expect(codes).toContain('DRIVER_LICENSE_EXPIRED');
  });

  it('Stage 3: synchronously blocks driver REACHED/STARTED, revokes token, and raises CRITICAL alert when a credential expired prior to execution', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    mockDb.vehicle = {
      id: 'veh-1',
      licensePlate: 'AUH-10992',
      isActive: true,
      mulkiyaExpiry: nextYear,
    };
    mockDb.driver = {
      id: 'drv-1',
      fullName: 'Tariq Mahmood',
      isActive: true,
      licenseExpiry: yesterday, // Expired yesterday!
      permitExpiry: nextYear,
    };
    mockDb.assignment = {
      id: 'assign-stage3',
      awardId: 'award-stage3',
      partnerId: 'partner-1',
      vehicleId: 'veh-1',
      driverId: 'drv-1',
      vehiclePlate: 'AUH-10992',
      driverName: 'Tariq Mahmood',
      isTokenRevoked: false,
      driverTokenExp: nextYear,
      award: {
        id: 'award-stage3',
        tenantId: 'tenant-buyer-1',
        partnerId: 'partner-1',
        status: 'ASSIGNED',
        request: {
          id: 'req-stage3',
          requestNumber: 'OUT-2026-00099',
          serviceDate: new Date(),
        },
        partner: {
          id: 'partner-1',
          legalName: 'Gulf Star Buses',
          operationalStatus: 'ACTIVE',
          marketplaceStatus: 'APPROVED',
          onboardingStatus: 'APPROVED',
          complianceDocuments: [
            { docType: 'TRADE_LICENSE', status: 'VERIFIED', expiryDate: nextYear },
            { docType: 'COMMERCIAL_INSURANCE', status: 'VERIFIED', expiryDate: nextYear },
          ],
        },
      },
    };

    await expect(
      PreDispatchComplianceGuard.enforcePreDispatchForAssignment('assign-stage3')
    ).rejects.toThrow(/Pre-dispatch compliance check failed/);

    // Verify token was revoked immediately and alert raised
    expect(mockDb.updatedAssignment?.isTokenRevoked).toBe(true);
    expect(
      mockDb.alerts.some((a) => a.code === 'OUTSOURCE_PRE_DISPATCH_COMPLIANCE_BLOCKED')
    ).toBe(true);
  });
});

describe('Phase 1.2 — 3-Mode Network Policy (CLOSED | PREFERRED | EXTENDED) & Kill Switch', () => {
  it('enforces PREFERRED exclusive bidding window for non-preferred partners and cascades after window elapses without blind auto-award', async () => {
    const policy = await NetworkPolicyService.setTenantPolicy({
      tenantId: 'tenant-enterprise',
      accessMode: 'PREFERRED',
      preferredExclusiveWindowMinutes: 30,
      actorUserId: 'admin-1',
    });

    expect(policy.allowAutoAwardPreferred).toBe(false);

    const publishedAt = new Date('2026-05-01T10:00:00Z');
    const tenMinutesLater = new Date('2026-05-01T10:10:00Z');
    const fortyMinutesLater = new Date('2026-05-01T10:40:00Z');

    // Preferred partner is NOT held during the first 30m
    expect(
      NetworkPolicyService.isHeldInPreferredExclusiveWindow({
        buyerTenantId: 'tenant-enterprise',
        publishedAt,
        relationshipStatus: 'PREFERRED',
        asOf: tenMinutesLater,
      }).blocked
    ).toBe(false);

    // Non-preferred (APPROVED) partner IS held during the first 30m
    expect(
      NetworkPolicyService.isHeldInPreferredExclusiveWindow({
        buyerTenantId: 'tenant-enterprise',
        publishedAt,
        relationshipStatus: 'APPROVED',
        asOf: tenMinutesLater,
      }).blocked
    ).toBe(true);

    // After 30m window elapses, APPROVED partner can access and quote
    expect(
      NetworkPolicyService.isHeldInPreferredExclusiveWindow({
        buyerTenantId: 'tenant-enterprise',
        publishedAt,
        relationshipStatus: 'APPROVED',
        asOf: fortyMinutesLater,
      }).blocked
    ).toBe(false);
  });

  it('enforces EXTENDED consortium sharing consent and strips confidential commercial fields during discovery', async () => {
    NetworkPolicyService.registerConsortiumMember(
      'consortium-uae-logistics',
      'UAE Logistics Consortium',
      'tenant-consortium-buyer',
      'OWNER'
    );
    NetworkPolicyService.registerConsortiumMember(
      'consortium-uae-logistics',
      'UAE Logistics Consortium',
      'tenant-peer-member',
      'MEMBER'
    );

    await NetworkPolicyService.setTenantPolicy({
      tenantId: 'tenant-consortium-buyer',
      accessMode: 'EXTENDED',
      consortiumIds: ['consortium-uae-logistics'],
      actorUserId: 'admin-1',
    });

    // Without consent: denied
    const deniedCheck = NetworkPolicyService.canPartnerAccessBuyerNetwork({
      buyerTenantId: 'tenant-consortium-buyer',
      partnerId: 'partner-consortium-1',
      partnerRelationships: [{ tenantId: 'tenant-peer-member', status: 'APPROVED' }],
    });
    expect(deniedCheck.allowed).toBe(false);

    // Grant consent: allowed
    NetworkPolicyService.setPartnerSharingConsent(
      'partner-consortium-1',
      'consortium-uae-logistics',
      true,
      'partner-admin-1'
    );

    const allowedCheck = NetworkPolicyService.canPartnerAccessBuyerNetwork({
      buyerTenantId: 'tenant-consortium-buyer',
      partnerId: 'partner-consortium-1',
      partnerRelationships: [{ tenantId: 'tenant-peer-member', status: 'APPROVED' }],
    });
    expect(allowedCheck.allowed).toBe(true);

    // Verify sanitization strips confidential rate cards, quotes, invoices, and contracts
    const sanitized = NetworkPolicyService.sanitizePartnerForConsortiumDiscovery({
      id: 'partner-consortium-1',
      legalName: 'Emirates Heavy Haulage LLC',
      partnerCode: 'EHH-01',
      city: 'Dubai',
      emirate: 'Dubai',
      operationalStatus: 'ACTIVE',
      onboardingStatus: 'APPROVED',
      capabilities: [{ domain: 'FREIGHT' }],
      rateCards: [{ id: 'rc-secret', rateAmount: 4500 }],
      invoices: [{ id: 'inv-secret', totalAmount: 95000 }],
      quotes: [{ id: 'q-secret', amount: 4200 }],
      contracts: [{ id: 'ctr-secret' }],
    });

    expect(sanitized.legalName).toBe('Emirates Heavy Haulage LLC');
    expect(sanitized).not.toHaveProperty('rateCards');
    expect(sanitized).not.toHaveProperty('invoices');
    expect(sanitized).not.toHaveProperty('quotes');
    expect(sanitized).not.toHaveProperty('contracts');
  });

  it('blocks network access immediately when Platform Emergency Kill Switch is engaged', async () => {
    await NetworkPolicyService.setPlatformKillSwitch(true, 'Security drill');
    expect(NetworkPolicyService.isPlatformKillSwitchActive()).toBe(true);

    const access = NetworkPolicyService.canPartnerAccessBuyerNetwork({
      buyerTenantId: 'tenant-1',
      partnerId: 'partner-1',
      partnerRelationships: [{ tenantId: 'tenant-1', status: 'PREFERRED' }],
      isDirectlyInvited: true,
    });
    expect(access.allowed).toBe(false);
    expect(access.reason).toContain('kill switch is active');
  });
});

describe('Phase 1.3 — Immutable SHA-256 Rate-Card Snapshot, Idempotent Award & Multi-Domain Direct Award', () => {
  it('creates deterministic SHA-256 RateCardSnapshot and detects post-award tampering', () => {
    const snapshot = RateCardService.buildImmutableRateCardSnapshot({
      rateCardId: 'rc-dubai-jafza-1',
      version: 3,
      effectiveFrom: '2026-01-01T00:00:00Z',
      effectiveTo: '2026-12-31T23:59:59Z',
      pricingUnit: 'PER_TRIP',
      baseRate: 1800,
      minimumCharge: 1800,
      currency: 'AED',
      originZone: 'Dubai Investment Park',
      destinationZone: 'JAFZA South',
      vehicleType: '50-Seat Bus',
      ancillaryCharges: {
        waitingFeePerHour: 120,
        freeWaitingMinutes: 45,
        tollTreatment: 'INCLUDED',
      },
    });

    expect(snapshot.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(RateCardService.verifySnapshotIntegrity(snapshot)).toBe(true);

    // Tamper with waitingFeePerHour after award
    const tampered: typeof snapshot = {
      ...snapshot,
      ancillaryCharges: {
        ...snapshot.ancillaryCharges,
        waitingFeePerHour: 250,
      },
    };
    expect(RateCardService.verifySnapshotIntegrity(tampered)).toBe(false);
  });

  it('makes OutsourceEngine.awardQuote idempotent when retried with the same quoteId and rejects a different quoteId', async () => {
    mockDb.request = {
      id: 'req-1',
      tenantId: 'tenant-1',
      requestNumber: 'OUT-2026-00001',
      status: 'AWARDED',
      serviceDate: new Date('2026-06-01T08:00:00Z'),
      pickupLocation: 'Dubai Marina',
      dropoffLocation: 'DIFC',
      award: {
        id: 'award-existing-1',
        quoteId: 'quote-winning-1',
        partnerId: 'partner-1',
        totalAwarded: 2100,
      },
    };

    // Same quoteId -> idempotent return
    const idempotentAward = await OutsourceEngine.awardQuote({
      tenantId: 'tenant-1',
      requestId: 'req-1',
      quoteId: 'quote-winning-1',
      awardedByUserId: 'user-1',
    });
    expect(idempotentAward.id).toBe('award-existing-1');

    // Different quoteId -> throws
    await expect(
      OutsourceEngine.awardQuote({
        tenantId: 'tenant-1',
        requestId: 'req-1',
        quoteId: 'quote-other-2',
        awardedByUserId: 'user-1',
      })
    ).rejects.toThrow('Request has already been awarded');
  });

  it('supports multi-domain createContractDirectAward (FREIGHT / LIMOUSINE / RECOVERY) with embedded SHA-256 rateCardSnapshot', async () => {
    mockDb.partner = {
      id: 'partner-limo-1',
      legalName: 'Mayfair Chauffeur Limousine LLC',
      partnerCode: 'MCL-01',
    };

    const award = await OutsourceEngine.createContractDirectAward({
      tenantId: 'tenant-1',
      sourceReferenceId: 'booking-vip-101',
      domain: PartnerServiceDomain.LIMOUSINE,
      partnerId: 'partner-limo-1',
      serviceDate: '2026-06-15T18:00:00Z',
      pickupTime: '18:00',
      pickupLocation: 'Atlantis The Royal',
      dropoffLocation: 'DXB VIP Terminal',
      agreedPrice: 1500,
      awardedByUserId: 'dispatcher-1',
    });

    const snap = award.commercialSnapshot as unknown as Record<string, unknown>;
    expect(snap.domain).toBe('LIMOUSINE');
    expect(snap.sourceReferenceType).toBe('LIMO_BOOKING');
    const rateCardSnap = snap.rateCardSnapshot as Record<string, unknown>;
    expect(rateCardSnap.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Phase 2.1 — Spread, Commission & IFRS 15 Commercial Ledger Engine', () => {
  it('calculates Mode A Option 1 (AGENCY + BUYER_DIRECT_TO_SUPPLIER) with balanced GL journal lines', () => {
    const breakdown = ExchangeCommercialLedgerService.calculateTransactionEconomics({
      commercialModel: 'AGENCY',
      agencySettlementFlow: 'BUYER_DIRECT_TO_SUPPLIER',
      buyerAgreedAmount: 9000,
      supplierAwardedAmount: 9000,
      platformFeeBasis: 'PERCENTAGE',
      platformFeeValue: 3, // AED 270 + AED 13.50 VAT
    });

    expect(breakdown.platformFeeExclVat).toBe(270);
    expect(breakdown.platformFeeVatAmount).toBe(13.5);
    expect(breakdown.isBalanced).toBe(true);
    expect(breakdown.totalDebits).toBe(breakdown.totalCredits);
  });

  it('calculates Mode A Option 2 (AGENCY + PLATFORM_COLLECT_AND_NET_REMIT) with AED 9,000 gross, AED 270 commission, and balanced clearing GL lines', () => {
    const breakdown = ExchangeCommercialLedgerService.calculateTransactionEconomics({
      commercialModel: 'AGENCY',
      agencySettlementFlow: 'PLATFORM_COLLECT_AND_NET_REMIT',
      buyerAgreedAmount: 9000,
      supplierAwardedAmount: 9000,
      platformFeeBasis: 'PERCENTAGE',
      platformFeeValue: 3, // AED 270 commission + AED 13.50 VAT = AED 283.50 deducted from AED 9,450 gross incl. VAT
    });

    expect(breakdown.supplierCostExclVat).toBe(9000);
    expect(breakdown.supplierVatAmount).toBe(450);
    expect(breakdown.platformFeeExclVat).toBe(270);
    expect(breakdown.platformFeeVatAmount).toBe(13.5);
    expect(breakdown.supplierNetSettlementPayable).toBe(9166.5); // 9450 - 283.50
    expect(breakdown.isBalanced).toBe(true);
    expect(breakdown.totalDebits).toBe(9450);
    expect(breakdown.totalCredits).toBe(9450);
  });

  it('enforces IFRS 15 B34-B38 control indicators for Mode B (PRINCIPAL) and prevents double-counting commission on top of spread', () => {
    // Rejects PRINCIPAL when no IFRS 15 control indicator is met
    expect(() =>
      ExchangeCommercialLedgerService.calculateTransactionEconomics({
        commercialModel: 'PRINCIPAL',
        buyerAgreedAmount: 10000,
        supplierAwardedAmount: 9000,
        principalIndicators: {
          hasPrimaryFulfilmentResponsibility: false,
          hasCapacityOrSubstitutionRisk: false,
          hasPricingDiscretion: false,
          approvedByFinancePolicyVersion: 'IFRS15-UAE-2026.1',
        },
      })
    ).toThrow(/IFRS 15 Principal classification requires/);

    // Valid PRINCIPAL with buyer invoice AED 10,000 (+500 VAT) and supplier cost AED 9,000 (+450 VAT) -> AED 1,000 spread
    const breakdown = ExchangeCommercialLedgerService.calculateTransactionEconomics({
      commercialModel: 'PRINCIPAL',
      buyerAgreedAmount: 10000,
      supplierAwardedAmount: 9000,
      platformFeeBasis: 'PERCENTAGE',
      platformFeeValue: 3, // Allocated inside spread (AED 270), NOT deducted from supplier's AED 9,450!
      principalIndicators: {
        hasPrimaryFulfilmentResponsibility: true,
        hasCapacityOrSubstitutionRisk: false,
        hasPricingDiscretion: true,
        approvedByFinancePolicyVersion: 'IFRS15-UAE-2026.1',
      },
    });

    expect(breakdown.grossSpreadExclVat).toBe(1000);
    expect(breakdown.platformFeeExclVat).toBe(270); // Internal allocation within AED 1,000 spread
    expect(breakdown.grossContributionAfterFeeExclVat).toBe(730);
    expect(breakdown.supplierNetSettlementPayable).toBe(9450); // Full AED 9,000 + 450 VAT owed to supplier
    expect(breakdown.isBalanced).toBe(true);
    expect(breakdown.totalDebits).toBe(breakdown.totalCredits);
  });
});

describe('Phase 2.2 & 2.3 — 3-Way Financial Reconciliation, Invoice GL Approval & Settlement Commission', () => {
  it('validates WAITING_TIME against actual (startedAt - reachedAt) minus freeWaitingMinutes and rejects INCLUDED tolls', async () => {
    const rateCardSnapshot = RateCardService.buildImmutableRateCardSnapshot({
      rateCardId: 'rc-reconcile-1',
      version: 1,
      effectiveFrom: '2026-01-01T00:00:00Z',
      pricingUnit: 'PER_TRIP',
      baseRate: 2000,
      minimumCharge: 2000,
      currency: 'AED',
      ancillaryCharges: {
        waitingFeePerHour: 100,
        freeWaitingMinutes: 30,
        tollTreatment: 'INCLUDED',
      },
    });

    // Driver arrived at 07:00 and started at 07:45 -> 45m wait -> 15m billable (AED 25 + 5% VAT = AED 26.25 max allowed)
    // Supplier billed AED 105.00 waiting time + AED 52.50 Salik toll (even though tollTreatment=INCLUDED)
    mockDb.invoice = {
      id: 'inv-reconcile-1',
      totalAmount: 2257.5,
      award: {
        id: 'award-reconcile-1',
        totalAwarded: 2100, // 2000 + 100 VAT
        commercialSnapshot: {
          rateCardSnapshot,
        },
        request: {
          domain: 'FREIGHT',
          requiredCapacity: 1,
          serviceDate: new Date('2026-05-10T07:00:00Z'),
          pickupTime: '07:00',
        },
        assignment: {
          reachedAt: new Date('2026-05-10T07:00:00Z'),
          startedAt: new Date('2026-05-10T07:45:00Z'),
          completedAt: new Date('2026-05-10T10:00:00Z'),
          pod: null,
        },
      },
      items: [
        {
          description: 'Waiting time charge (1 hour)',
          varianceReason: 'WAITING_TIME',
          amount: 100,
          vatAmount: 5,
          totalAmount: 105,
        },
        {
          description: 'Salik Toll Gates',
          varianceReason: 'TOLL',
          amount: 50,
          vatAmount: 2.5,
          totalAmount: 52.5,
        },
      ],
    };

    const match = await SettlementReconciliationService.performThreeWayMatch('inv-reconcile-1');
    expect(match.matchStatus).toBe('VARIANCE_DETECTED');
    expect(match.snapshotIntegrityVerified).toBe(true);

    // Waiting time overcharge: 105.00 billed - 26.25 allowed = 78.75 suggested deduction
    const waitingDeduction = match.suggestedDeductions.find((d) =>
      d.description.includes('Waiting time overcharge')
    );
    expect(waitingDeduction?.amount).toBe(78.75);

    // Disallowed toll: 52.50 suggested deduction because tollTreatment=INCLUDED
    const tollDeduction = match.suggestedDeductions.find((d) =>
      d.description.includes('tollTreatment=INCLUDED')
    );
    expect(tollDeduction?.amount).toBe(52.5);
  });

  it('posts balanced double-entry GL journal via PartnerInvoiceService.approveInvoice and deducts commission in SettlementService', async () => {
    mockDb.invoice = {
      id: 'inv-approve-1',
      tenantId: 'tenant-1',
      partnerId: 'partner-1',
      awardId: 'award-approve-1',
      invoiceNumber: 'INV-9001',
      invoiceDate: new Date('2026-05-12T00:00:00Z'),
      subtotalAmount: 9000,
      vatAmount: 450,
      totalAmount: 9450,
      currency: 'AED',
      status: 'SUBMITTED',
      verificationStatus: 'MATCHED',
      partner: {
        id: 'partner-1',
        legalName: 'Alwatani Transit Partners',
        partnerCode: 'ATP-01',
      },
      award: {
        id: 'award-approve-1',
        commercialSnapshot: {
          commercialModel: 'AGENCY',
          agencySettlementMode: 'PLATFORM_COLLECT_AND_NET_REMIT',
          buyerAgreedPrice: 9000,
          platformFeePct: 3,
        },
      },
      items: [],
    };

    const approval = await PartnerInvoiceService.approveInvoice({
      tenantId: 'tenant-1',
      invoiceId: 'inv-approve-1',
      approvedByUserId: 'finance-mgr-1',
    });

    expect(approval.isRetry).toBe(false);
    expect(approval.economics?.platformFeeExclVat).toBe(270);
    expect(approval.economics?.isBalanced).toBe(true);
    expect(approval.glEntries?.length).toBeGreaterThanOrEqual(2);
    expect(mockDb.draftJournals).toHaveLength(2);

    // Now generate settlement statement with platform commission deduction
    mockDb.partner = {
      id: 'partner-1',
      legalName: 'Alwatani Transit Partners',
      partnerCode: 'ATP-01',
      taxRegistrationNumber: '100555666777003',
    };

    const settlement = await SettlementService.generateSettlementStatement({
      tenantId: 'tenant-1',
      partnerId: 'partner-1',
      periodStart: '2026-05-01T00:00:00Z',
      periodEnd: '2026-05-31T23:59:59Z',
      appliedDeductions: [
        {
          invoiceId: 'inv-approve-1',
          type: DeductionType.LATE_ARRIVAL_PENALTY,
          description: 'Late arrival SLA penalty',
          amount: 100,
        },
      ],
      commercialModel: 'AGENCY',
      agencySettlementMode: 'PLATFORM_COLLECT_AND_NET_REMIT',
      platformFeePct: 3,
      deductPlatformCommission: true,
      createdByUserId: 'finance-mgr-1',
    });

    expect(settlement.grossAmount).toBe(9000);
    expect(settlement.vatAmount).toBe(450);
    expect(settlement.platformCommission).toBe(270);
    expect(settlement.platformCommissionVat).toBe(13.5);
    // Total deductions = 100 (late penalty) + 283.50 (commission + VAT) = 383.50
    expect(settlement.totalDeductions).toBe(383.5);
    // Net payable = 9450 - 383.50 = 9066.50
    expect(settlement.netPayable).toBe(9066.5);
  });

  it('validates multi-vertical structured POD evidence (FREIGHT broken seal & weight shortage, LIMOUSINE VIP sign-off, RECOVERY hookup photo)', async () => {
    // 1. FREIGHT: sealIntact=false + weight shortage (delivered 18,000 kg vs required 25,000 kg)
    mockDb.invoice = {
      id: 'inv-freight-pod-1',
      totalAmount: 5250,
      award: {
        id: 'award-freight-pod-1',
        totalAwarded: 5250,
        commercialSnapshot: {},
        request: {
          domain: 'FREIGHT',
          requiredCapacity: 25000,
          serviceDate: new Date('2026-05-15T08:00:00Z'),
          pickupTime: '08:00',
        },
        assignment: {
          reachedAt: new Date('2026-05-15T07:55:00Z'),
          startedAt: new Date('2026-05-15T08:10:00Z'),
          completedAt: new Date('2026-05-15T11:30:00Z'),
          pod: {
            passengerCount: 18000,
            signedByName: 'Warehouse Gate 2',
            completionNotes: JSON.stringify({
              notes: 'Seal broken during inspection',
              podMetadata: {
                domain: 'FREIGHT',
                deliveredWeightKg: 18000,
                sealIntact: false,
              },
            }),
          },
        },
      },
      items: [],
    };

    const freightMatch = await SettlementReconciliationService.performThreeWayMatch('inv-freight-pod-1');
    expect(freightMatch.matchStatus).toBe('VARIANCE_DETECTED');
    expect(freightMatch.discrepancies).toContain(
      'Freight POD violation: Container/trailer seal broken at delivery'
    );
    expect(freightMatch.discrepancies).toContain(
      'Cargo weight shortage: 18000 kg / 25000 kg'
    );

    // 2. RECOVERY: hookupPhotoVerified=false
    mockDb.invoice = {
      id: 'inv-recovery-pod-1',
      totalAmount: 1050,
      award: {
        id: 'award-recovery-pod-1',
        totalAwarded: 1050,
        commercialSnapshot: {},
        request: {
          domain: 'RECOVERY',
          requiredCapacity: 1,
          serviceDate: new Date('2026-05-15T09:00:00Z'),
          pickupTime: '09:00',
        },
        assignment: {
          reachedAt: new Date('2026-05-15T09:05:00Z'),
          startedAt: new Date('2026-05-15T09:15:00Z'),
          completedAt: new Date('2026-05-15T10:00:00Z'),
          pod: {
            passengerCount: 1,
            signedByName: 'Advisor Rami',
            completionNotes: JSON.stringify({
              notes: 'Delivered to Al Quoz workshop',
              podMetadata: {
                domain: 'RECOVERY',
                hookupPhotoVerified: false,
                towDestinationWorkshop: 'Al Quoz Workshop',
              },
            }),
          },
        },
      },
      items: [],
    };

    const recoveryMatch = await SettlementReconciliationService.performThreeWayMatch('inv-recovery-pod-1');
    expect(recoveryMatch.matchStatus).toBe('VARIANCE_DETECTED');
    expect(recoveryMatch.discrepancies).toContain(
      'Recovery POD violation: Missing 4-corner pre-tow condition / hookup photo'
    );
  });

  it('Phase 7 — generates multi-vertical ePOD PDF with structured 3-way match metadata and UAE FTA Tax Invoice PDF with commercial ledger summary', async () => {
    const { PdfDocumentService } = await import('@/lib/exchange/pdf-service');

    const podPdf = PdfDocumentService.generatePodReceiptPdf({
      tripNumber: 'OUT-2026-00088',
      domain: 'FREIGHT',
      vehiclePlate: 'DXB-TRK-9910',
      driverName: 'Tariq Al Mansoori',
      driverPhone: '+971501234567',
      pickupLocation: 'Jebel Ali Port Terminal 2',
      dropoffLocation: 'KIZAD Logistics Hub',
      completedAt: '2026-05-15T14:30:00Z',
      recipientName: 'Hassan Warehouse Mgr',
      passengerOrPackageCount: 24,
      notes: JSON.stringify({
        notes: 'Unloaded at Bay 4 without delay',
        podMetadata: {
          domain: 'FREIGHT',
          sealNumber: 'SEAL-778899',
          sealIntact: true,
          deliveredWeightKg: 24500,
          packagesDelivered: 24,
        },
      }),
      hasSignature: true,
      signatureChecksum: 'SHA256:9f86d081884c7d659a2feaa0c55ad015',
    });

    const podText = Buffer.from(podPdf).toString('latin1');
    expect(podText).toContain('DOMAIN-SPECIFIC 3-WAY MATCH EVIDENCE:');
    expect(podText).toContain('SEAL-778899');
    expect(podText).toContain('INTACT & VERIFIED');
    expect(podText).toContain('24500 kg');

    const taxPdf = PdfDocumentService.generateTaxInvoicePdf({
      statementNumber: 'STMT-202605-0001',
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      issueDate: '2026-05-31',
      tenantName: 'Fleet360 Enterprise Logistics LLC',
      tenantTrn: '100223344500003',
      partnerName: 'Al Futtaim Heavy Transport LLC',
      partnerTrn: '100998877600003',
      items: [
        {
          tripNumber: 'INV-2026-088',
          date: '2026-05-15',
          description: 'FREIGHT Outsource Service (OUT-2026-00088)',
          amountAed: 4000,
          vatAed: 200,
          totalAed: 4200,
          verificationStatus: 'MATCHED',
          commercialModel: 'AGENCY',
          rateCardHash: 'a1b2c3d4e5f60123456789abcdef',
        },
      ],
      grossAmountAed: 4000,
      vatAmountAed: 200,
      totalDeductionsAed: 0,
      netPayableAed: 4200,
      commercialModelSummary: {
        agencyCount: 1,
        principalCount: 0,
        totalPlatformFeeAed: 120,
      },
    });

    const taxText = Buffer.from(taxPdf).toString('latin1');
    expect(taxText).toContain('[MATCHED]');
    expect(taxText).toContain('[AGENCY]');
    expect(taxText).toContain('RateHash: #a1b2c3d4');
    expect(taxText).toContain('1 Agency / 0 Principal');
    expect(taxText).toContain('Platform Exchange Fee:      AED 120.00');
  });

  it('Phase 16 (FUNC-5) — auto-approves Fuel Surcharge Indexation within contracted fuelSurchargePct and flags overcharges in 3-Way Match', async () => {
    const rateCardWithFuel = RateCardService.buildImmutableRateCardSnapshot({
      rateCardId: 'rc-fuel-5pct',
      version: 2,
      effectiveFrom: '2026-01-01T00:00:00Z',
      pricingUnit: 'PER_TRIP',
      baseRate: 2000,
      minimumCharge: 2000,
      currency: 'AED',
      ancillaryCharges: {
        waitingFeePerHour: 100,
        freeWaitingMinutes: 30,
        tollTreatment: 'ACTUAL',
        fuelSurchargePct: 5, // 5% of AED 2,000 = AED 100 + AED 5 VAT = AED 105 max allowed
      },
    });

    // 1. Within contracted 5% fuel indexation (AED 2,100 base + AED 105 fuel surcharge = AED 2,205) -> MATCHED
    mockDb.invoice = {
      id: 'inv-fuel-matched',
      totalAmount: 2205,
      award: {
        id: 'award-fuel-1',
        totalAwarded: 2100,
        commercialSnapshot: { rateCardSnapshot: rateCardWithFuel },
        request: {
          domain: 'FREIGHT',
          requiredCapacity: 1,
          serviceDate: new Date(2026, 4, 20, 8, 0, 0),
          pickupTime: '08:00',
        },
        assignment: {
          reachedAt: new Date(2026, 4, 20, 7, 55, 0),
          startedAt: new Date(2026, 4, 20, 8, 5, 0),
          completedAt: new Date(2026, 4, 20, 11, 0, 0),
          pod: null,
        },
      },
      items: [
        {
          description: 'Monthly Diesel Fuel Surcharge (5% Index)',
          varianceReason: 'OTHER',
          amount: 100,
          vatAmount: 5,
          totalAmount: 105,
        },
      ],
    };

    const matchedFuel = await SettlementReconciliationService.performThreeWayMatch('inv-fuel-matched');
    expect(matchedFuel.matchStatus).toBe('MATCHED');
    expect(matchedFuel.suggestedDeductions).toHaveLength(0);

    // 2. Exceeds contracted 5% fuel indexation (billed AED 210 incl. VAT vs allowed AED 105) -> VARIANCE_DETECTED with AED 105 deduction
    mockDb.invoice = {
      ...mockDb.invoice,
      id: 'inv-fuel-overcharge',
      totalAmount: 2310,
      items: [
        {
          description: 'Fuel Surcharge (10% billed vs 5% contracted)',
          varianceReason: 'OTHER',
          amount: 200,
          vatAmount: 10,
          totalAmount: 210,
        },
      ],
    };

    const overchargedFuel = await SettlementReconciliationService.performThreeWayMatch('inv-fuel-overcharge');
    expect(overchargedFuel.matchStatus).toBe('VARIANCE_DETECTED');
    expect(overchargedFuel.suggestedDeductions[0]?.amount).toBe(105);
    expect(overchargedFuel.discrepancies[0]).toContain('Fuel surcharge overcharge');
  });

  it('Phase 18 (ARCH-1, ARCH-2 & ARCH-4) — persists NetworkPolicy to DB, raises proactive T-30m pickup SLA warnings, and projects canonical PartnerQuotes into Freight Load Board bids', async () => {
    const { ExceptionService } = await import('@/lib/exchange/exception-service');
    const { FreightRfqCanonicalBridge } = await import('@/lib/exchange/freight-rfq-bridge');

    // 1. ARCH-1: NetworkPolicyService write-through persistence to prisma.integrationConfig
    mockDb.integrationConfigs = [];
    await NetworkPolicyService.setTenantPolicy({
      tenantId: 'tenant-arch1',
      accessMode: 'EXTENDED',
      preferredExclusiveWindowMinutes: 45,
      consortiumIds: ['consortium-uae-1'],
      actorUserId: 'admin-arch1',
    });
    NetworkPolicyService.setPartnerSharingConsent(
      'partner-arch1',
      'consortium-uae-1',
      true,
      'partner-admin-1',
    );
    await NetworkPolicyService.setPlatformKillSwitch(
      true,
      'Emergency compliance suspension',
      'super-admin',
    );

    // Wait microtask tick for fire-and-forget DB persistence
    await new Promise((r) => setTimeout(r, 10));
    expect(mockDb.integrationConfigs.length).toBeGreaterThanOrEqual(3);
    const savedTypes = mockDb.integrationConfigs.map((c) => c.type);
    expect(savedTypes).toContain('EXCHANGE_POLICY_tenant-arch1');
    expect(savedTypes).toContain('EXCHANGE_CONSENT_partner-arch1');
    expect(savedTypes).toContain('EXCHANGE_PLATFORM_KILL_SWITCH');

    // Reset kill switch
    await NetworkPolicyService.setPlatformKillSwitch(false, 'Cleared', 'super-admin');

    // 2. ARCH-2: Proactive T-30m pickup SLA warning when reachedAt === null within 30m of pickup
    const now = new Date('2026-05-20T07:40:00Z'); // 20 minutes before 08:00Z pickup -> T-20m
    mockDb.alerts = [];
    mockDb.awardsList = [
      {
        id: 'award-upcoming-t20m',
        tenantId: 'tenant-1',
        partnerId: 'partner-1',
        status: 'AWARDED',
        request: {
          id: 'req-upcoming-1',
          requestNumber: 'OUT-2026-00901',
          serviceDate: new Date('2026-05-20T08:00:00Z'),
          pickupTime: '08:00',
        },
        assignment: {
          id: 'assign-upcoming-1',
          reachedAt: null,
          startedAt: null,
          completedAt: null,
          isTokenRevoked: false,
        },
      },
    ];

    const sweepRes = await ExceptionService.sweepOverdueNoShowAssignments({
      tenantId: 'tenant-1',
      graceMinutes: 30,
      warningLeadMinutes: 30,
      now,
    });
    expect(sweepRes.proactiveWarningCount).toBe(1);
    expect(sweepRes.proactiveWarningAwardIds).toContain('award-upcoming-t20m');
    expect(sweepRes.overdueNoShowCount).toBe(0);

    // 3. ARCH-4: FreightRfqCanonicalBridge projects canonical PartnerQuotes into Freight Bids without duplicates
    mockDb.request = {
      id: 'out-req-freight-1',
      requestNumber: 'OUT-2026-00999',
      sourceReferenceId: 'rfq-legacy-1',
      quotes: [
        {
          id: 'pq-1',
          partnerId: 'partner-existing',
          revisionNo: 1,
          amount: 3200,
          vatAmount: 160,
          totalAmount: 3360,
          currency: 'AED',
          status: 'SUBMITTED',
          validUntil: new Date('2026-05-25T12:00:00Z'),
          notes: 'Already in legacy bids',
          submittedAt: new Date('2026-05-20T06:00:00Z'),
          partner: { id: 'partner-existing', legalName: 'Existing Carrier LLC', partnerCode: 'EX-01' },
        },
        {
          id: 'pq-2',
          partnerId: 'partner-exchange-only',
          revisionNo: 2,
          amount: 2950,
          vatAmount: 147.5,
          totalAmount: 3097.5,
          currency: 'AED',
          status: 'SUBMITTED',
          validUntil: new Date('2026-05-25T12:00:00Z'),
          notes: 'Submitted via /exchange/marketplace',
          submittedAt: new Date('2026-05-20T06:15:00Z'),
          partner: { id: 'partner-exchange-only', legalName: 'Gulf Exchange Carrier LLC', partnerCode: 'GEC-02' },
        },
      ],
    };

    const mergedBids = await FreightRfqCanonicalBridge.mergeCanonicalQuotesIntoFreightBids({
      tenantId: 'tenant-1',
      rfqId: 'rfq-legacy-1',
      legacyBids: [
        {
          id: 'bid-legacy-1',
          rfqId: 'rfq-legacy-1',
          carrierId: 'partner-existing',
          carrierName: 'Existing Carrier LLC',
          bidNo: 'BID-001',
          amount: 3200,
          currency: 'AED',
          transitTimeHours: 6,
          validityUntil: '2026-05-25T12:00:00Z',
          status: 'SUBMITTED',
          notes: 'Legacy bid',
          submittedAt: '2026-05-20T06:00:00Z',
        },
      ],
    });

    expect(mergedBids).toHaveLength(2);
    // Sorted ascending by amount: 2950 (canonical PartnerQuote) first, 3200 second
    expect(mergedBids[0].carrierId).toBe('partner-exchange-only');
    expect(mergedBids[0].amount).toBe(2950);
    expect(mergedBids[0].bidNo).toContain('EXQ-PQ-2-R2');
    expect(mergedBids[1].carrierId).toBe('partner-existing');
  });
});
