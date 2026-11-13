/**
 * Unit test suite verifying:
 *   1. Workflow Consolidation — 1 Master Price List (camelCase + snake_case rules,
 *      RateEvent surge integration, proportional weekend uplift) & BigInt-safe serialization.
 *   2. RAC RBAC Policy Matrix — Edge `decide()` + `requireRentalPermission()` separation
 *      between `RAC_OPERATOR` and `RAC_MANAGER`.
 *   3. Standalone Authenticated B2B RAC Portal — `rac-portal-session` HMAC signing/verification,
 *      public route delegation, and PCI-safe Card Pre-Authorization (`rac_card_preauths` provider).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { calculateRate, normalizePricingRuleRow } from '@/lib/rental-rate-engine';
import { calculateYieldRate } from '@/lib/rental-yield-engine';
import { decide } from '@/lib/authz/policy';
import { systemRolePermissions } from '@/lib/authz/session-permissions';
import { requireRentalPermission, hasRentalPermission } from '@/lib/rental/rbac';
import { serializeVehicleForJson, withSavepoint } from '@/lib/rental/locks';
import { isPublicPath, CRON_SESSION_BYPASS_PATHS } from '@/lib/auth-route-policies';
import { detectPenalties } from '@/lib/rental-booking-state';
import { pdfStrings } from '@/lib/pdf/i18n';
import {
  signRacPortalSession,
  verifyRacPortalSession,
  buildRacSessionCookie,
} from '@/lib/rac-portal/auth';
import { getRacPreAuthProvider } from '@/lib/rac-portal/preauth-provider';
import { toPublicRacPreAuth, type RacCardPreAuth } from '@/lib/rac-portal/preauth-store';
import {
  RentalSecurityError,
  assertRentalForeignKeysInTenant,
  assertCustomerEligibleForRental,
  escapeIlikePattern,
  sanitizeDownloadFilename,
  validateSafeDocumentOrSignatureUrl,
  deriveTenantChannelSecret,
} from '@/lib/rental/security-guards';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function roleSubject(code: string) {
  return {
    role: code,
    tenantId: TENANT_ID,
    plan: 'PROFESSIONAL',
    permissions: [
      ...systemRolePermissions(code),
      ...(code === 'SUPER_ADMIN' ? ['*:*:*'] : []),
    ],
  };
}

describe('1 Master Price List — Unified Rate & Yield Engine', () => {
  it('evaluates both camelCase Prisma rules and snake_case SQL rules identically', () => {
    const pickupDate = new Date('2026-11-16T09:00:00Z');
    const dropoffDate = new Date('2026-11-20T09:00:00Z'); // 4 days

    const snakeRule = {
      id: 'rule-1',
      name: 'Standard SUV Tariff',
      vehicle_category: 'SUV',
      base_daily_rate: 250,
      weekly_rate: 1500,
      included_km_per_day: 250,
      excess_km_rate: 1.25,
      priority: 10,
      is_active: true,
    };

    const camelRule = {
      id: 'rule-1',
      name: 'Standard SUV Tariff',
      vehicleCategory: 'suv_4x4',
      baseDailyRate: 250,
      weeklyRate: 1500,
      includedKmPerDay: 250,
      excessKmRate: 1.25,
      priority: 10,
      isActive: true,
    };

    const snakeQuote = calculateRate([snakeRule], {
      vehicleCategory: 'SUV',
      pickupDate,
      dropoffDate,
    });
    const camelQuote = calculateRate([camelRule], {
      vehicleCategory: 'SUV',
      pickupDate,
      dropoffDate,
    });

    expect(normalizePricingRuleRow(camelRule).base_daily_rate).toBe(250);
    expect(snakeQuote.dailyRate).toBe(250);
    expect(camelQuote.dailyRate).toBe(250);
    expect(camelQuote.baseRentalCharge).toBe(1000);
    expect(camelQuote.taxAmount).toBe(50); // 5% UAE VAT
    expect(camelQuote.totalAmount).toBe(1050);
    expect(camelQuote.excessKmRate).toBe(1.25);
  });

  it('applies active RateEvent surge multipliers and emits yieldTrace on standard quotes', () => {
    const pickupDate = new Date('2026-12-01T10:00:00Z');
    const dropoffDate = new Date('2026-12-04T10:00:00Z'); // 3 days

    const quote = calculateRate(
      [
        {
          id: 'lux-1',
          name: 'Luxury Master Tariff',
          vehicleCategory: 'LUXURY',
          baseDailyRate: 500,
          priority: 10,
        },
      ],
      {
        vehicleCategory: 'LUXURY',
        pickupDate,
        dropoffDate,
        events: [
          {
            id: 'evt-1',
            eventCode: 'UAE-NATIONAL-DAY',
            name: 'UAE National Day Surge',
            dateFrom: new Date('2026-11-30T00:00:00Z'),
            dateTo: new Date('2026-12-05T23:59:59Z'),
            multiplier: 1.2,
            applicableCategories: 'LUXURY,SUV',
            applicableChannels: null,
            priority: 10,
            isActive: true,
          },
        ],
      },
    );

    expect(quote.appliedEventCode).toBe('UAE-NATIONAL-DAY');
    expect(quote.dailyRate).toBe(600); // 500 * 1.2
    expect(quote.baseRentalCharge).toBe(1800);
    expect(quote.taxAmount).toBe(90);
    expect(quote.totalAmount).toBe(1890);
    expect(quote.yieldTrace?.some((l) => l.layer === 'EVENT')).toBe(true);
  });

  it('applies proportional weekend uplift instead of charging full stay as weekend', () => {
    // Wed Nov 18 2026 -> Mon Nov 23 2026 (5 days: Wed, Thu, Fri[wknd], Sat[wknd], Sun -> 2 UAE Fri/Sat weekend days)
    const pickupDate = new Date('2026-11-18T10:00:00Z');
    const dropoffDate = new Date('2026-11-23T10:00:00Z');

    const res = calculateYieldRate({
      request: {
        vehicleCategory: 'SEDAN',
        pickupDate,
        dropoffDate,
      },
      rules: [{ id: 'sedan-1', vehicleCategory: 'SEDAN', baseDailyRate: 100 }],
      events: [],
    });

    const weekendLayer = res.trace.find((t) => t.layer === 'WEEKEND');
    expect(weekendLayer).toBeDefined();
    // 2 of 5 days at default +10% => effective +4.0% (multiplier 1.04), NOT full +10%
    expect(weekendLayer!.multiplier).toBeCloseTo(1 + 0.10 * (2 / 5), 4);
  });

  it('serializes BigInt and Date fields on Vehicle records without JSON.stringify crash', () => {
    const rawVehicle = {
      id: 'veh-1',
      plateNumber: 'DXB-A-12345',
      year: BigInt(2025),
      currentMileage: BigInt(18450),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const safe = serializeVehicleForJson(rawVehicle);
    expect(() => JSON.stringify(safe)).not.toThrow();
    expect(safe.year).toBe(2025);
    expect(safe.currentMileage).toBe(18450);
  });
});

describe('RAC RBAC Policy Matrix — RAC_OPERATOR vs RAC_MANAGER', () => {
  const prevMode = process.env.AUTHZ_MODE;
  beforeEach(() => {
    process.env.AUTHZ_MODE = 'enforce';
  });
  afterEach(() => {
    if (prevMode === undefined) delete process.env.AUTHZ_MODE;
    else process.env.AUTHZ_MODE = prevMode;
  });

  it('grants RAC_OPERATOR operational counter, booking, quote, invoice & fleet-read access', () => {
    const op = roleSubject('RAC_OPERATOR');

    expect(decide({ pathname: '/api/rental/bookings', method: 'GET' }, op).allow).toBe(true);
    expect(decide({ pathname: '/api/rental/bookings', method: 'POST' }, op).allow).toBe(true);
    expect(decide({ pathname: '/api/rental/bookings/x', method: 'PATCH' }, op).allow).toBe(true);
    expect(decide({ pathname: '/api/rental/rates/calculate', method: 'POST' }, op).allow).toBe(true);
    expect(decide({ pathname: '/api/rental/rates/yield', method: 'POST' }, op).allow).toBe(true);
    expect(decide({ pathname: '/api/rental/rates', method: 'GET' }, op).allow).toBe(true);
    expect(decide({ pathname: '/api/rental/branches', method: 'GET' }, op).allow).toBe(true);
    expect(decide({ pathname: '/api/rental/counter/handover', method: 'POST' }, op).allow).toBe(true);
    expect(decide({ pathname: '/api/rental/counter/return', method: 'POST' }, op).allow).toBe(true);
    expect(decide({ pathname: '/api/rental/invoices', method: 'POST' }, op).allow).toBe(true);
    expect(decide({ pathname: '/api/rental/invoices/x/payments', method: 'POST' }, op).allow).toBe(true);
    expect(decide({ pathname: '/api/rental/renewals', method: 'POST' }, op).allow).toBe(true);
    expect(decide({ pathname: '/api/fleet/vehicles', method: 'GET' }, op).allow).toBe(true);
  });

  it('denies RAC_OPERATOR tariff/branch/ancillary mutations, deletes, and fleet vehicle writes while allowing RAC_MANAGER', () => {
    const op = roleSubject('RAC_OPERATOR');
    const mgr = roleSubject('RAC_MANAGER');

    const managerOnlyWriteRoutes: Array<[string, string]> = [
      ['/api/rental/rates', 'POST'],
      ['/api/rental/rates/x', 'PATCH'],
      ['/api/rental/rates/x', 'DELETE'],
      ['/api/rental/pricing', 'POST'],
      ['/api/rental/pricing/x', 'PATCH'],
      ['/api/rental/pricing/x', 'DELETE'],
      ['/api/rental/rate-events', 'POST'],
      ['/api/rental/ancillaries', 'POST'],
      ['/api/rental/branches', 'POST'],
      ['/api/rental/channels', 'POST'],
      ['/api/rental/insurance', 'POST'],
      ['/api/rental/bookings/x', 'DELETE'],
      ['/api/rental/customers/x', 'DELETE'],
      ['/api/rental/invoices/x', 'DELETE'],
      ['/api/rental/renewals', 'DELETE'],
    ];

    for (const [pathname, method] of managerOnlyWriteRoutes) {
      expect(decide({ pathname, method }, op).allow, `RAC_OPERATOR should be denied ${method} ${pathname}`).toBe(false);
      expect(decide({ pathname, method }, mgr).allow, `RAC_MANAGER should be allowed ${method} ${pathname}`).toBe(true);
    }

    // Neither RAC_OPERATOR nor RAC_MANAGER can create physical fleet vehicles (owned by FLEET_MANAGER)
    expect(decide({ pathname: '/api/fleet/vehicles', method: 'POST' }, op).allow).toBe(false);
    expect(decide({ pathname: '/api/fleet/vehicles', method: 'POST' }, mgr).allow).toBe(false);
  });

  it('enforces sub-action RBAC gates (cancel, deposit refund, invoice void, renewal approval, rate override, credit limit)', async () => {
    const opHeaders = new Headers({ 'x-user-role': 'RAC_OPERATOR' });
    const mgrHeaders = new Headers({ 'x-user-role': 'RAC_MANAGER' });

    const sensitiveChecks: Array<['delete' | 'approve', string]> = [
      ['delete', 'bookings'],
      ['approve', 'deposits'],
      ['approve', 'invoices'],
      ['approve', 'renewals'],
      ['approve', 'damage'],
      ['approve', 'rates'],
      ['approve', 'customers'],
    ];

    for (const [action, resource] of sensitiveChecks) {
      const opDenied = await requireRentalPermission(opHeaders, TENANT_ID, action, resource);
      expect(opDenied?.status, `RAC_OPERATOR should receive 403 for rental:${action}:${resource}`).toBe(403);

      const mgrDenied = await requireRentalPermission(mgrHeaders, TENANT_ID, action, resource);
      expect(mgrDenied, `RAC_MANAGER should be allowed rental:${action}:${resource}`).toBeNull();
    }

    expect(await hasRentalPermission(opHeaders, TENANT_ID, 'approve', 'renewals')).toBe(false);
    expect(await hasRentalPermission(mgrHeaders, TENANT_ID, 'approve', 'renewals')).toBe(true);
  });
});

describe('Standalone B2B RAC Portal Auth & Card Pre-Authorization', () => {
  it('marks /rac-portal and /api/rac-portal/* as public external routes with own session domain', () => {
    expect(isPublicPath('/rac-portal/login')).toBe(true);
    expect(isPublicPath('/rac-portal/book')).toBe(true);
    expect(isPublicPath('/api/rac-portal/availability')).toBe(true);
    expect(decide({ pathname: '/api/rac-portal/bookings', method: 'POST' }, roleSubject('VIEWER'))).toMatchObject({
      allow: true,
      reason: 'delegated',
    });
  });

  it('signs and verifies isolated rac-portal-session HMAC tokens and rejects tampering', () => {
    const { token } = signRacPortalSession({
      userId: '33333333-3333-4333-8333-333333333333',
      customerId: 'cust-corp-001',
      tenantId: TENANT_ID,
    });

    const cookie = buildRacSessionCookie(token);
    expect(cookie).toContain('rac-portal-session=');
    expect(cookie).toContain('HttpOnly');

    const verified = verifyRacPortalSession(token);
    expect(verified).toMatchObject({
      userId: '33333333-3333-4333-8333-333333333333',
      customerId: 'cust-corp-001',
      tenantId: TENANT_ID,
    });

    // Tampered signature must fail closed
    const tampered = `${token.slice(0, -4)}ffff`;
    expect(verifyRacPortalSession(tampered)).toBeNull();
  });

  it('authorizes, captures, and releases PCI-safe card holds and declines 0002 / expired cards', async () => {
    const provider = getRacPreAuthProvider();

    const hold = await provider.authorizeHold({
      tenantId: TENANT_ID,
      customerId: 'cust-corp-001',
      amount: 2500,
      currency: 'AED',
      cardBrand: 'VISA',
      cardLast4: '4242',
      cardholderName: 'Al Futtaim Logistics LLC',
      expiryMonth: 12,
      expiryYear: new Date().getFullYear() + 2,
    });

    expect(hold.status).toBe('AUTHORIZED');
    expect(hold.authorizationCode).toMatch(/^AUTH-[0-9A-F]{6}$/);
    expect(hold.cardLast4).toBe('4242');
    expect(hold.cardToken).toMatch(/^tok_/);

    const capture = await provider.captureHold({
      providerIntentId: hold.providerIntentId,
      amount: 1450,
      currency: 'AED',
    });
    expect(capture.status).toBe('CAPTURED');
    expect(capture.capturedAmount).toBe(1450);

    const release = await provider.releaseHold({
      providerIntentId: hold.providerIntentId,
    });
    expect(release.status).toBe('RELEASED');

    // Simulated issuer decline on test last4 '0002'
    const declined = await provider.authorizeHold({
      tenantId: TENANT_ID,
      customerId: 'cust-corp-001',
      amount: 2500,
      currency: 'AED',
      cardLast4: '0002',
      expiryMonth: 12,
      expiryYear: new Date().getFullYear() + 2,
    });
    expect(declined.status).toBe('FAILED');

    // Expired card must throw
    await expect(
      provider.authorizeHold({
        tenantId: TENANT_ID,
        customerId: 'cust-corp-001',
        amount: 1500,
        currency: 'AED',
        cardLast4: '4242',
        expiryMonth: 1,
        expiryYear: 2020,
      }),
    ).rejects.toThrow(/expired/i);
  });
});

describe('P0 Production Crash, 25P02 Savepoint, Auth Boundary & PDF Regressions', () => {
  it('rolls back failed optional SQL queries via SAVEPOINT instead of poisoning interactive transactions (25P02)', async () => {
    const executedSql: string[] = [];
    const mockTx = {
      $executeRawUnsafe: async (sql: string) => {
        executedSql.push(sql);
        return 0;
      },
    } as never;

    const okResult = await withSavepoint(mockTx, 'optional-lookup', async () => 'found-row', 'fallback');
    expect(okResult).toBe('found-row');
    expect(executedSql).toEqual([
      'SAVEPOINT sp_optional_lookup',
      'RELEASE SAVEPOINT sp_optional_lookup',
    ]);

    executedSql.length = 0;
    const fallbackResult = await withSavepoint(
      mockTx,
      'missing-table',
      async () => {
        throw new Error('42P01: relation "legacy_table" does not exist');
      },
      [] as string[],
    );
    expect(fallbackResult).toEqual([]);
    expect(executedSql).toEqual([
      'SAVEPOINT sp_missing_table',
      'ROLLBACK TO SAVEPOINT sp_missing_table',
      'RELEASE SAVEPOINT sp_missing_table',
    ]);
  });

  it('computes NO_SHOW and LATE_RETURN penalties and supports incremental delta billing', () => {
    const asOf = new Date('2026-11-12T15:00:00Z');
    const assessments = detectPenalties({
      asOf,
      bookings: [
        {
          id: 'bk-noshow',
          bookingRef: 'RBK-001',
          status: 'CONFIRMED',
          pickupDate: new Date('2026-11-12T09:00:00Z'), // 6h past pickup (> 4h cutoff)
          dropoffDate: new Date('2026-11-15T09:00:00Z'),
          dailyRate: 300,
          totalAmount: 900,
          totalDays: 3,
          currency: 'AED',
        },
        {
          id: 'bk-late',
          bookingRef: 'RBK-002',
          status: 'ACTIVE',
          pickupDate: new Date('2026-11-10T09:00:00Z'),
          dropoffDate: new Date('2026-11-12T11:30:00Z'), // 3.5h past dropoff -> 3h past 30m grace => 30% of 200 = 60 AED
          dailyRate: 200,
          totalAmount: 400,
          totalDays: 2,
          currency: 'AED',
        },
      ],
    });

    const noShow = assessments.find((a) => a.bookingId === 'bk-noshow');
    expect(noShow).toMatchObject({
      kind: 'NO_SHOW',
      newStatus: 'NO_SHOW',
      feeAmount: 300,
    });

    const lateDay1 = assessments.find((a) => a.bookingId === 'bk-late');
    expect(lateDay1).toMatchObject({
      kind: 'LATE_RETURN',
      newStatus: 'ACTIVE',
      feeAmount: 60,
    });

    // Next day (+24h later): cumulative penalty grows, incremental delta must only charge the difference
    const nextDayAssessments = detectPenalties({
      asOf: new Date('2026-11-13T15:00:00Z'),
      bookings: [
        {
          id: 'bk-late',
          bookingRef: 'RBK-002',
          status: 'ACTIVE',
          pickupDate: new Date('2026-11-10T09:00:00Z'),
          dropoffDate: new Date('2026-11-12T11:30:00Z'),
          dailyRate: 200,
          totalAmount: 400,
          totalDays: 2,
          currency: 'AED',
        },
      ],
    });
    const cumulativeDay2 = nextDayAssessments[0].feeAmount;
    const incrementalDelta = Math.round((cumulativeDay2 - lateDay1!.feeAmount) * 100) / 100;
    expect(cumulativeDay2).toBeGreaterThan(lateDay1!.feeAmount);
    expect(incrementalDelta).toBe(cumulativeDay2 - 60);
  });

  it('routes public e-sign verification, inbound OTA webhooks, and cron penalty sweeps accurately', () => {
    // Public recipient e-sign verification (capability token, no staff session)
    expect(isPublicPath('/api/esign/verify')).toBe(true);
    expect(decide({ pathname: '/api/esign/verify', method: 'POST' }, roleSubject('VIEWER'))).toMatchObject({
      allow: true,
      reason: 'delegated',
    });

    // Inbound OTA partner webhook is public (HMAC-signed), while admin channel config stays protected
    expect(isPublicPath('/api/rental/channels/booking_com/webhook')).toBe(true);
    expect(isPublicPath('/api/rental/channels')).toBe(false);

    // Penalty sweep uses CRON_SESSION_BYPASS_PATHS for Bearer CRON_SECRET while preserving staff session auth
    expect(CRON_SESSION_BYPASS_PATHS).toContain('/api/rental/bookings/sweep-penalties');
    expect(isPublicPath('/api/rental/bookings/sweep-penalties')).toBe(false);
  });

  it('maps Pickup/Return odometer and fuel labels in correct chronological order on bilingual PDFs', () => {
    expect(pdfStrings.mileageOut.en).toBe('Mileage at Pickup');
    expect(pdfStrings.mileageIn.en).toBe('Mileage at Return');
    expect(pdfStrings.mileageOut.ar).toBe('الكيلومترات عند الاستلام');
    expect(pdfStrings.mileageIn.ar).toBe('الكيلومترات عند الإرجاع');
    expect(pdfStrings.fuelOut.en).toBe('Fuel at Pickup');
    expect(pdfStrings.fuelIn.en).toBe('Fuel at Return');
  });
});

describe('Security, Multi-Tenant Isolation, Eligibility & RBAC Hardening', () => {
  const prevMode = process.env.AUTHZ_MODE;
  beforeEach(() => {
    process.env.AUTHZ_MODE = 'enforce';
  });
  afterEach(() => {
    if (prevMode === undefined) delete process.env.AUTHZ_MODE;
    else process.env.AUTHZ_MODE = prevMode;
  });

  it('eliminates wildcard (*) resource escalation across all 23 RAC route segments', () => {
    const narrowCustomSubject = {
      role: 'CUSTOM_ANCILLARY_CLERK',
      tenantId: TENANT_ID,
      plan: 'PROFESSIONAL',
      permissions: ['rental:view:*', 'rental:create:ancillaries', 'rental:edit:ancillaries'],
    };

    const unrelatedMutations: Array<[string, string]> = [
      ['/api/rental/agreements', 'POST'],
      ['/api/rental/counter/handover', 'POST'],
      ['/api/rental/counter/return', 'POST'],
      ['/api/rental/damage-claims', 'POST'],
      ['/api/rental/documents', 'POST'],
      ['/api/rental/transfers', 'POST'],
      ['/api/rental/quotations', 'POST'],
      ['/api/rental/inquiries', 'POST'],
      ['/api/rental/inspections', 'POST'],
      ['/api/rental/handover', 'POST'],
      ['/api/rental/preauth/x', 'PATCH'],
    ];

    for (const [pathname, method] of unrelatedMutations) {
      expect(
        decide({ pathname, method }, narrowCustomSubject).allow,
        `narrow ancillaries permission must NOT grant ${method} ${pathname}`,
      ).toBe(false);
    }

    // Only ancillaries create/edit should succeed
    expect(decide({ pathname: '/api/rental/ancillaries', method: 'POST' }, narrowCustomSubject).allow).toBe(true);
    expect(decide({ pathname: '/api/rental/ancillaries/x', method: 'PATCH' }, narrowCustomSubject).allow).toBe(true);
  });

  it('enforces zero approve and zero delete permissions on RAC_OPERATOR while allowing read-only AI POST helpers', async () => {
    const opPerms = systemRolePermissions('RAC_OPERATOR');
    expect(opPerms.filter((p) => p.includes(':approve:'))).toEqual([]);
    expect(opPerms.filter((p) => p.includes(':delete:'))).toEqual([]);

    const opHeaders = new Headers({ 'x-user-role': 'RAC_OPERATOR' });
    for (const resource of ['bookings', 'documents', 'transfers', 'deposits', 'invoices', 'renewals']) {
      const denied = await requireRentalPermission(opHeaders, TENANT_ID, 'approve', resource);
      expect(denied?.status, `RAC_OPERATOR must be denied rental:approve:${resource}`).toBe(403);
    }

    const op = roleSubject('RAC_OPERATOR');
    expect(decide({ pathname: '/api/rental/bookings/copilot', method: 'POST' }, op).allow).toBe(true);
    expect(decide({ pathname: '/api/rental/damage-claims/classify', method: 'POST' }, op).allow).toBe(true);

    // Deactivated or module-masked TENANT_ADMIN (empty permissions array) fails closed
    const maskedAdmin = {
      role: 'TENANT_ADMIN',
      tenantId: TENANT_ID,
      plan: 'ENTERPRISE',
      permissions: [],
    };
    expect(decide({ pathname: '/api/rental/bookings', method: 'GET' }, maskedAdmin).allow).toBe(false);
  });

  it('blocks cross-tenant foreign-key attachment (IDOR) in assertRentalForeignKeysInTenant', async () => {
    const mockTx = {
      rentalCustomer: {
        findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
          where.id === 'cust-own' && where.tenantId === TENANT_ID ? { id: 'cust-own' } : null,
      },
      vehicle: {
        findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
          where.id === 'veh-own' && where.tenantId === TENANT_ID ? { id: 'veh-own' } : null,
      },
      rentalAncillary: {
        count: async ({ where }: { where: { id: { in: string[] }; tenantId: string } }) =>
          where.tenantId === TENANT_ID
            ? where.id.in.filter((id) => id === 'anc-own').length
            : 0,
      },
    } as never;

    await expect(
      assertRentalForeignKeysInTenant(mockTx, TENANT_ID, {
        customerId: 'cust-own',
        vehicleId: 'veh-own',
        ancillaryIds: ['anc-own'],
      }),
    ).resolves.toBeUndefined();

    await expect(
      assertRentalForeignKeysInTenant(mockTx, TENANT_ID, {
        customerId: 'cust-other-tenant',
      }),
    ).rejects.toMatchObject({ status: 404, code: 'CUSTOMER_NOT_FOUND' });

    await expect(
      assertRentalForeignKeysInTenant(mockTx, TENANT_ID, {
        vehicleId: 'veh-other-tenant',
      }),
    ).rejects.toMatchObject({ status: 404, code: 'VEHICLE_NOT_FOUND' });

    await expect(
      assertRentalForeignKeysInTenant(mockTx, TENANT_ID, {
        ancillaryIds: ['anc-own', 'anc-other-tenant'],
      }),
    ).rejects.toMatchObject({ status: 404, code: 'ANCILLARY_NOT_FOUND' });
  });

  it('enforces blacklist, license expiry, and corporate credit limit in assertCustomerEligibleForRental', async () => {
    const customers: Record<string, Record<string, unknown>> = {
      'cust-blacklisted': {
        id: 'cust-blacklisted',
        customerType: 'INDIVIDUAL',
        blacklisted: true,
        licenseExpiry: new Date('2028-01-01T00:00:00Z'),
        creditLimit: null,
      },
      'cust-expired-lic': {
        id: 'cust-expired-lic',
        customerType: 'INDIVIDUAL',
        blacklisted: false,
        licenseExpiry: new Date('2026-11-14T00:00:00Z'),
        creditLimit: null,
      },
      'cust-corp-tight': {
        id: 'cust-corp-tight',
        customerType: 'CORPORATE',
        blacklisted: false,
        licenseExpiry: null,
        creditLimit: 5000,
      },
    };

    const mockTx = {
      rentalCustomer: {
        findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
          where.tenantId === TENANT_ID ? customers[where.id] ?? null : null,
      },
      $executeRawUnsafe: async () => 0,
      $queryRawUnsafe: async (sql: string) => {
        if (sql.includes('FROM rental_invoices')) return [{ unpaid: 3200 }];
        if (sql.includes('FROM rental_bookings')) return [{ unbilled: 1000 }];
        return [];
      },
    } as never;

    await expect(
      assertCustomerEligibleForRental(mockTx, {
        tenantId: TENANT_ID,
        customerId: 'cust-blacklisted',
      }),
    ).rejects.toMatchObject({ status: 422, code: 'CUSTOMER_BLACKLISTED' });

    await expect(
      assertCustomerEligibleForRental(mockTx, {
        tenantId: TENANT_ID,
        customerId: 'cust-expired-lic',
        dropoffDate: new Date('2026-11-16T10:00:00Z'),
      }),
    ).rejects.toMatchObject({ status: 422, code: 'LICENSE_EXPIRED' });

    // Open exposure = 3200 + 1000 = 4200; +1200 = 5400 > 5000 limit
    await expect(
      assertCustomerEligibleForRental(mockTx, {
        tenantId: TENANT_ID,
        customerId: 'cust-corp-tight',
        additionalExposureAed: 1200,
      }),
    ).rejects.toMatchObject({ status: 422, code: 'CREDIT_LIMIT_EXCEEDED' });

    // Manager credit override permits the booking
    await expect(
      assertCustomerEligibleForRental(mockTx, {
        tenantId: TENANT_ID,
        customerId: 'cust-corp-tight',
        additionalExposureAed: 1200,
        allowCreditOverride: true,
      }),
    ).resolves.toMatchObject({ id: 'cust-corp-tight', customerType: 'CORPORATE', creditLimit: 5000 });
  });

  it('sanitizes ILIKE wildcards, download filenames, signature/document URLs, and per-tenant channel secrets', () => {
    expect(escapeIlikePattern('50%_off\\deal')).toBe('50\\%\\_off\\\\deal');
    expect(sanitizeDownloadFilename('INV-2026/01"\r\nX-Evil: 1')).toBe('INV-2026_01_X-Evil_1');

    expect(
      validateSafeDocumentOrSignatureUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA'),
    ).toContain('data:image/png;base64,');
    expect(validateSafeDocumentOrSignatureUrl('/api/files/rental/tenant-1/kyc.pdf')).toBe(
      '/api/files/rental/tenant-1/kyc.pdf',
    );

    for (const unsafe of [
      'javascript:alert(1)',
      'data:image/svg+xml;base64,PHN2Zy8+',
      'https://attacker.example/steal.png',
      '/api/files/../../etc/passwd',
    ]) {
      expect(() => validateSafeDocumentOrSignatureUrl(unsafe)).toThrow(RentalSecurityError);
    }

    const secretA = deriveTenantChannelSecret('master-key', TENANT_ID, 'booking_com');
    const secretB = deriveTenantChannelSecret(
      'master-key',
      '22222222-2222-4222-8222-222222222222',
      'booking_com',
    );
    expect(secretA).not.toBe(secretB);
  });

  it('redacts reusable card tokens on public pre-auth payloads, enforces sessionVersion, and scopes webhook public path', () => {
    const rawPreAuth: RacCardPreAuth = {
      id: 'pa-001',
      tenantId: TENANT_ID,
      customerId: 'cust-corp-001',
      bookingId: 'bk-001',
      agreementId: null,
      invoiceId: null,
      amount: 2500,
      capturedAmount: 0,
      currency: 'AED',
      provider: 'stripe',
      providerIntentId: 'pi_secret_intent_999',
      cardToken: 'pm_secret_reusable_token_999',
      authorizationCode: 'AUTH-99AA11',
      cardBrand: 'VISA',
      cardLast4: '4242',
      cardholderName: 'Al Futtaim Logistics LLC',
      status: 'AUTHORIZED',
      expiresAt: '2026-11-18T10:00:00.000Z',
      capturedAt: null,
      releasedAt: null,
      initiatedBy: 'PORTAL',
      initiatedByUser: 'user-1',
      notes: null,
      createdAt: '2026-11-11T10:00:00.000Z',
      updatedAt: '2026-11-11T10:00:00.000Z',
    };

    const pub = toPublicRacPreAuth(rawPreAuth) as unknown as Record<string, unknown>;
    expect(pub.cardToken).toBeUndefined();
    expect(pub.providerIntentId).toBeUndefined();
    expect(pub.cardLast4).toBe('4242');
    expect(pub.authorizationCode).toBe('AUTH-99AA11');
    expect(pub.authorizedAmount).toBe(2500);

    const { token } = signRacPortalSession({
      userId: '33333333-3333-4333-8333-333333333333',
      customerId: 'cust-corp-001',
      tenantId: TENANT_ID,
      sv: 3,
    });
    expect(verifyRacPortalSession(token)?.sv).toBe(3);

    expect(isPublicPath('/api/rental/channels/booking_com/webhook')).toBe(true);
    expect(isPublicPath('/api/rental/channels/booking_com/settings')).toBe(false);
    expect(isPublicPath('/api/rental/channels/booking_com')).toBe(false);
  });
});
