import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockTxState = vi.hoisted(() => ({
  currentTx: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/tenant-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tenant-context')>(
    '@/lib/tenant-context',
  );
  return {
    ...actual,
    requireAuthorizedTenant: vi.fn(() => ({
      ok: true,
      tenantId: 'tenant-uae-rac-1',
      userId: 'user-counter-mgr-1',
      role: 'MANAGER',
    })),
  };
});

vi.mock('@/lib/rental/rbac', () => ({
  requireRentalPermission: vi.fn(async () => null),
  hasRentalPermission: vi.fn(async () => true),
}));

vi.mock('@/lib/workflow/approvals', () => ({
  approvalRequired: vi.fn(async () => false),
  withApprovalStart: vi.fn(),
}));

vi.mock('@/lib/session-user', () => ({
  sessionUser: vi.fn(async () => ({ email: 'manager@fleet360.ae' })),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async () => undefined),
}));

vi.mock('@/lib/rls', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rls')>('@/lib/rls');
  return {
    ...actual,
    withTenantRls: vi.fn(async (_prisma: unknown, _tenantId: string, fn: (tx: any) => unknown) =>
      fn(mockTxState.currentTx),
    ),
  };
});

import { POST as activateBookingPost } from '@/app/api/rental/bookings/[id]/activate/route';
import { POST as refundDepositPost } from '@/app/api/rental/agreements/[id]/refund-deposit/route';
import {
  NGeniusPreAuthProvider,
  SandboxPreAuthProvider,
  StripeManualCaptureProvider,
  TelrPreAuthProvider,
} from '@/lib/rac-portal/preauth-provider';
import {
  RAC_GL_ACCOUNTS,
  buildRacInvoiceCreditBuckets,
  classifyRacLineCreditAccount,
} from '@/lib/finance/rac-gl-posting';
import { calculateUaeTollTariff } from '@/lib/fines/toll-reconciliation';
import {
  RentalSecurityError,
  assertAdditionalDriversEligible,
  assertCustomerEligibleForRental,
  isValidEmiratesIdNumber,
} from '@/lib/rental/security-guards';
import { scanKycDocumentMultimodal } from '@/lib/digital-kyc-engine';
import {
  determineUaeRegulatoryAuthority,
  queueUaeRegulatoryReportInTx,
} from '@/lib/rental/uae-regulatory-reporting';
import {
  buildChannelWebhookUrl,
  buildOutboundAriPayload,
  normalizeChannelWebhookEvent,
  signOutboundAriPayload,
  validateOutboundWebhookUrl,
  verifyChannelSignature,
} from '@/lib/rental-channels';
import {
  evaluateCrossBorderGeofenceInTx,
  executeSafeImmobilizerCommandInTx,
} from '@/lib/rental/telematics-service';
import {
  buildGroundedRentalQuoteInTx,
  parseRentalIntentDeterministic,
} from '@/lib/agents/rental-copilot/agent';
import type { TxClient } from '@/lib/rls';

describe('Section 6.1 & 6.2 — Booking Activation Guards & Additional Drivers KYC', () => {
  beforeEach(() => {
    mockTxState.currentTx = null;
  });

  it('rejects activating a PENDING booking with 422 BOOKING_NOT_CONFIRMED', async () => {
    mockTxState.currentTx = {
      rentalBooking: {
        findFirst: vi.fn(async () => ({
          id: 'bk-pending-1',
          tenantId: 'tenant-uae-rac-1',
          status: 'PENDING',
          customerId: 'cust-1',
          vehicleId: 'veh-1',
          pickupDate: new Date('2026-12-01T08:00:00Z'),
          dropoffDate: new Date('2026-12-05T08:00:00Z'),
          agreement: null,
          customer: { id: 'cust-1' },
        })),
      },
    };

    const req = new NextRequest('http://localhost:3000/api/rental/bookings/bk-pending-1/activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mileageOut: 12000, fuelOutPct: 100 }),
    });

    const res = await activateBookingPost(req, { params: Promise.resolve({ id: 'bk-pending-1' }) });
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.code).toBe('BOOKING_NOT_CONFIRMED');
  });

  it('rejects activating a CONFIRMED booking that lacks an assigned vehicleId with 422 VEHICLE_REQUIRED', async () => {
    mockTxState.currentTx = {
      rentalBooking: {
        findFirst: vi.fn(async () => ({
          id: 'bk-no-veh-1',
          tenantId: 'tenant-uae-rac-1',
          status: 'CONFIRMED',
          customerId: 'cust-1',
          vehicleId: null,
          pickupDate: new Date('2026-12-01T08:00:00Z'),
          dropoffDate: new Date('2026-12-05T08:00:00Z'),
          agreement: null,
          customer: { id: 'cust-1' },
        })),
      },
    };

    const req = new NextRequest('http://localhost:3000/api/rental/bookings/bk-no-veh-1/activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mileageOut: 12000, fuelOutPct: 100 }),
    });

    const res = await activateBookingPost(req, { params: Promise.resolve({ id: 'bk-no-veh-1' }) });
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.code).toBe('VEHICLE_REQUIRED');
  });

  it('validates additional drivers KYC, age (21 vs 25 Luxury), Tourist IDP, and computes daily fees', () => {
    const dropoff = new Date('2027-06-15T10:00:00Z');

    const valid = assertAdditionalDriversEligible(
      [
        {
          fullName: 'Omar Al Mansoori',
          emiratesId: '784-1992-1234567-1',
          drivingLicenseNo: 'DXB-DL-998811',
          licenseIssuingCountry: 'AE',
          licenseExpiry: '2029-12-31',
          dateOfBirth: '1992-04-10',
          dailyFee: 40,
        },
      ],
      { dropoffDate: dropoff, rentalDays: 4, vehicleCategory: 'FULL_SIZE_SUV' },
    );
    expect(valid).toHaveLength(1);
    expect(valid[0]?.totalFee).toBe(160);

    // Expired license before dropoff
    expect(() =>
      assertAdditionalDriversEligible(
        [
          {
            fullName: 'Expired Driver',
            drivingLicenseNo: 'DXB-DL-0001',
            licenseExpiry: '2027-01-01',
          },
        ],
        { dropoffDate: dropoff, rentalDays: 3 },
      ),
    ).toThrowError(/expires/i);

    // Underage (23 years old) for LUXURY vehicle (requires 25+)
    const twentyThreeYearsAgo = new Date();
    twentyThreeYearsAgo.setUTCFullYear(twentyThreeYearsAgo.getUTCFullYear() - 23);
    expect(() =>
      assertAdditionalDriversEligible(
        [
          {
            fullName: 'Young Luxury Driver',
            drivingLicenseNo: 'DXB-DL-777',
            licenseExpiry: '2030-01-01',
            dateOfBirth: twentyThreeYearsAgo.toISOString().slice(0, 10),
          },
        ],
        { dropoffDate: dropoff, rentalDays: 2, vehicleCategory: 'LUXURY' },
      ),
    ).toThrowError(/minimum 25 years/i);

    // Non-exempt foreign tourist (e.g., Brazil) without IDP -> rejected with IDP_REQUIRED
    expect(() =>
      assertAdditionalDriversEligible(
        [
          {
            fullName: 'Carlos Silva',
            drivingLicenseNo: 'BR-SP-99112',
            licenseIssuingCountry: 'BRAZIL',
            licenseExpiry: '2030-01-01',
          },
        ],
        { dropoffDate: dropoff, rentalDays: 3 },
      ),
    ).toThrowError(/International Driving Permit/i);
  });
});

describe('Section 6.3 — Pre-Auth Gateways (Stripe, Telr, N-Genius, Sandbox), Incremental Holds & Deposit Refund Guard', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('supports authorizeHold, incrementHold, captureHold, releaseHold, and 0002 declines in SandboxPreAuthProvider', async () => {
    const sandbox = new SandboxPreAuthProvider();

    const auth = await sandbox.authorizeHold({
      tenantId: 'tenant-1',
      customerId: 'cust-1',
      amount: 1500,
      currency: 'AED',
      cardLast4: '4242',
      cardBrand: 'VISA',
    });
    expect(auth.status).toBe('AUTHORIZED');
    expect(auth.authorizationCode).toMatch(/^AUTH-[0-9A-F]{6}$/);

    const inc = await sandbox.incrementHold({
      providerIntentId: auth.providerIntentId,
      authorizationCode: auth.authorizationCode,
      additionalAmount: 500,
      newTotalAmount: 2000,
      currency: 'AED',
      reason: '3-day rental extension',
    });
    expect(inc.status).toBe('INCREMENTED');
    expect(inc.newTotalAmount).toBe(2000);

    const cap = await sandbox.captureHold({
      providerIntentId: auth.providerIntentId,
      amount: 1850,
      currency: 'AED',
    });
    expect(cap.status).toBe('CAPTURED');
    expect(cap.capturedAmount).toBe(1850);

    const rel = await sandbox.releaseHold({ providerIntentId: auth.providerIntentId });
    expect(rel.status).toBe('RELEASED');

    const declined = await sandbox.authorizeHold({
      tenantId: 'tenant-1',
      customerId: 'cust-1',
      amount: 1000,
      currency: 'AED',
      cardLast4: '0002',
    });
    expect(declined.status).toBe('FAILED');
  });

  it('executes Stripe manual capture, incremental authorization, capture, and cancel via REST', async () => {
    const fetchMock = vi.fn()
      // 1. authorizeHold -> POST /v1/payment_intents
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'pi_live_123', status: 'requires_capture', payment_method: 'pm_card_visa' }), {
          status: 200,
        }),
      )
      // 2. incrementHold -> POST /v1/payment_intents/pi_live_123/increment_authorization
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'pi_live_123', status: 'requires_capture', amount: 250000 }), {
          status: 200,
        }),
      )
      // 3. captureHold -> POST /v1/payment_intents/pi_live_123/capture
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'pi_live_123', status: 'succeeded', amount_received: 210000 }), {
          status: 200,
        }),
      )
      // 4. releaseHold -> POST /v1/payment_intents/pi_live_123/cancel
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'pi_live_123', status: 'canceled' }), {
          status: 200,
        }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const stripe = new StripeManualCaptureProvider('sk_test_mock_123');
    const auth = await stripe.authorizeHold({
      tenantId: 'tenant-1',
      customerId: 'cust-1',
      amount: 2000,
      currency: 'AED',
      cardToken: 'pm_card_visa',
      cardLast4: '4242',
    });
    expect(auth.status).toBe('AUTHORIZED');
    expect(auth.providerIntentId).toBe('pi_live_123');

    const inc = await stripe.incrementHold({
      providerIntentId: 'pi_live_123',
      additionalAmount: 500,
      newTotalAmount: 2500,
      currency: 'AED',
    });
    expect(inc.status).toBe('INCREMENTED');
    expect(inc.newTotalAmount).toBe(2500);

    const cap = await stripe.captureHold({
      providerIntentId: 'pi_live_123',
      amount: 2100,
      currency: 'AED',
    });
    expect(cap.status).toBe('CAPTURED');

    const rel = await stripe.releaseHold({ providerIntentId: 'pi_live_123' });
    expect(rel.status).toBe('RELEASED');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('executes UAE Telr auth, continuous-authority incremental hold, capture, and release', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ transaction: { status: 'A', ref: '040029182211', code: 'TLR889' } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ transaction: { status: 'A', ref: '040029182299', code: 'TLR990' } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ transaction: { status: 'A', ref: '040029182299' } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ transaction: { status: 'A', ref: '040029182299' } }), {
          status: 200,
        }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const telr = new TelrPreAuthProvider('store_991', 'auth_key_secret', { testMode: '1' });
    const auth = await telr.authorizeHold({
      tenantId: 'tenant-1',
      customerId: 'cust-1',
      amount: 1500,
      currency: 'AED',
      cardToken: '030011223344',
    });
    expect(auth.status).toBe('AUTHORIZED');
    expect(auth.authorizationCode).toBe('TLR889');

    const inc = await telr.incrementHold({
      providerIntentId: auth.providerIntentId,
      additionalAmount: 400,
      newTotalAmount: 1900,
      currency: 'AED',
    });
    expect(inc.status).toBe('INCREMENTED');

    const cap = await telr.captureHold({
      providerIntentId: inc.providerRef,
      amount: 1650,
      currency: 'AED',
    });
    expect(cap.status).toBe('CAPTURED');

    const rel = await telr.releaseHold({ providerIntentId: inc.providerRef });
    expect(rel.status).toBe('RELEASED');
  });

  it('executes UAE Network International N-Genius OAuth, AUTH order, incremental auth, capture, and cancel', async () => {
    const fetchMock = vi.fn()
      // authorizeHold: token + order
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'ni_tok_1' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            reference: 'ord_ni_100',
            _embedded: {
              payment: [
                {
                  _id: 'urn:payment:pay_ni_200',
                  state: 'AUTHORISED',
                  authResponse: { authorizationCode: 'NI7744' },
                },
              ],
            },
          }),
          { status: 201 },
        ),
      )
      // incrementHold: token + /authorizations
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'ni_tok_2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'AUTHORISED' }), { status: 200 }))
      // captureHold: token + /captures
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'ni_tok_3' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'CAPTURED' }), { status: 201 }))
      // releaseHold: token + /cancel
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'ni_tok_4' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'REVERSED' }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const ngenius = new NGeniusPreAuthProvider('ni_api_key', 'outlet_dxb_01', 'https://api-gateway.sandbox.ngenius-payments.com');
    const auth = await ngenius.authorizeHold({
      tenantId: 'tenant-1',
      customerId: 'cust-1',
      amount: 3000,
      currency: 'AED',
    });
    expect(auth.status).toBe('AUTHORIZED');
    expect(auth.providerIntentId).toBe('ord_ni_100:pay_ni_200');
    expect(auth.authorizationCode).toBe('NI7744');

    const inc = await ngenius.incrementHold({
      providerIntentId: auth.providerIntentId,
      additionalAmount: 750,
      newTotalAmount: 3750,
      currency: 'AED',
    });
    expect(inc.status).toBe('INCREMENTED');

    const cap = await ngenius.captureHold({
      providerIntentId: auth.providerIntentId,
      amount: 3200,
      currency: 'AED',
    });
    expect(cap.status).toBe('CAPTURED');

    const rel = await ngenius.releaseHold({ providerIntentId: auth.providerIntentId });
    expect(rel.status).toBe('RELEASED');
  });

  it('blocks deposit refund on COMPLETED (un-closed) agreements and on CLOSED agreements with unbilled traffic fines', async () => {
    // Case A: Agreement is COMPLETED (vehicle returned, closing invoice not yet finalized)
    mockTxState.currentTx = {
      rentalAgreement: {
        findFirst: vi.fn(async () => ({
          id: 'agr-completed-1',
          tenantId: 'tenant-uae-rac-1',
          status: 'COMPLETED',
          depositStatus: 'PAID',
          securityDeposit: 1500,
        })),
      },
    };

    const reqCompleted = new NextRequest(
      'http://localhost:3000/api/rental/agreements/agr-completed-1/refund-deposit',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
    );
    const resCompleted = await refundDepositPost(reqCompleted, {
      params: Promise.resolve({ id: 'agr-completed-1' }),
    });
    const jsonCompleted = await resCompleted.json();
    expect(resCompleted.status).toBe(422);
    expect(jsonCompleted.code).toBe('AGREEMENT_NOT_CLOSED');

    // Case B: Agreement is CLOSED, but has 1 unbilled RTA traffic fine (AED 620)
    mockTxState.currentTx = {
      rentalAgreement: {
        findFirst: vi.fn(async () => ({
          id: 'agr-closed-fines-1',
          tenantId: 'tenant-uae-rac-1',
          bookingId: 'bk-1',
          status: 'CLOSED',
          depositStatus: 'PAID',
          securityDeposit: 1500,
        })),
      },
      $executeRawUnsafe: vi.fn(async () => 0),
      $queryRawUnsafe: vi.fn(async (sql: string) => {
        if (sql.includes('FROM rental_invoices')) return [{ cnt: 0, due: 0 }];
        if (sql.includes('FROM traffic_fines')) return [{ cnt: 1, amt: 620 }];
        if (sql.includes('FROM toll_transactions')) return [{ cnt: 2, amt: 12 }];
        if (sql.includes('FROM damage_claims')) return [{ cnt: 0, amt: 0 }];
        return [];
      }),
    };

    const reqUnsettled = new NextRequest(
      'http://localhost:3000/api/rental/agreements/agr-closed-fines-1/refund-deposit',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
    );
    const resUnsettled = await refundDepositPost(reqUnsettled, {
      params: Promise.resolve({ id: 'agr-closed-fines-1' }),
    });
    const jsonUnsettled = await resUnsettled.json();
    expect(resUnsettled.status).toBe(422);
    expect(jsonUnsettled.code).toBe('UNSETTLED_LIABILITIES');
    expect(jsonUnsettled.liabilities.unbilledTrafficFines.amount).toBe(620);
    expect(jsonUnsettled.liabilities.unbilledTolls.amount).toBe(12);
    expect(jsonUnsettled.liabilities.totalUnsettledAed).toBe(632);
  });
});

describe('Section 6.4 — UAE Regulatory Compliance, Knowledge Dirham (0% VAT), Dynamic Salik/Darb, UAE KYC & OCR', () => {
  it('separates 0% Out-of-Scope UAE Knowledge & Innovation Dirham (AED 20) into 2160 Clearing while keeping Admin Fee on 4140', () => {
    const finePrincipal = classifyRacLineCreditAccount({
      lineType: 'FINE',
      description: 'Dubai Police Speeding Fine #99812 (Statutory Principal)',
      amount: 600,
      taxable: false,
    });
    expect(finePrincipal.code).toBe(RAC_GL_ACCOUNTS.FINES_CLEARING.code); // 2160

    const knowledgeDirham = classifyRacLineCreditAccount({
      lineType: 'KNOWLEDGE_FEE',
      description: 'UAE Knowledge & Innovation Dirham (Statutory Out-of-Scope)',
      amount: 20,
      taxable: false,
    });
    expect(knowledgeDirham.code).toBe(RAC_GL_ACCOUNTS.FINES_CLEARING.code); // 2160

    const adminSurcharge = classifyRacLineCreditAccount({
      lineType: 'ADMIN_FEE',
      description: 'Traffic Fine Administrative Handling Surcharge (5% VAT)',
      amount: 50,
      taxable: true,
    });
    expect(adminSurcharge.code).toBe(RAC_GL_ACCOUNTS.REV_ADMIN_SURCHARGE.code); // 4140

    // Verify full credit bucket decomposition balances to 0.01 AED
    // Net = 300 (Rental) + 600 (Fine) + 20 (Knowledge Dirham) + 50 (Admin Fee) = 970
    // VAT (5% on 300 + 50 = 350) = 17.50 -> Total = 987.50
    const buckets = buildRacInvoiceCreditBuckets({
      subtotal: 970,
      taxAmount: 17.5,
      totalAmount: 987.5,
      rentalDaysHint: 3,
      lines: [
        { lineType: 'RENTAL', description: '3-Day Rental', amount: 300, taxable: true },
        { lineType: 'FINE', description: 'RTA Fine Principal', amount: 600, taxable: false },
        { lineType: 'KNOWLEDGE_FEE', description: 'Knowledge & Innovation Dirham', amount: 20, taxable: false },
        { lineType: 'ADMIN_FEE', description: 'Fine Admin Fee', amount: 50, taxable: true },
      ],
    });
    const byCode = Object.fromEntries(buckets.map((b) => [b.code, b.amount]));
    expect(byCode['4110']).toBe(300);
    expect(byCode['2160']).toBe(620); // 600 Fine + 20 Knowledge & Innovation Dirham
    expect(byCode['4140']).toBe(50);
  });

  it('computes 2025/2026 Dubai Salik dynamic Peak (AED 6), Off-Peak (AED 4), Night Free (AED 0), and Abu Dhabi Darb (AED 4) tariffs in UAE GST', () => {
    // Monday 2026-11-16:
    // 04:30 UTC = 08:30 UAE GST (Mon Morning Peak -> AED 6)
    const salikMorningPeak = calculateUaeTollTariff({
      tollSystem: 'SALIK',
      occurredAt: '2026-11-16T04:30:00Z',
    });
    expect(salikMorningPeak.tariffBand).toBe('PEAK');
    expect(salikMorningPeak.tollAmountAed).toBe(6);

    // 08:30 UTC = 12:30 UAE GST (Mon Midday Off-Peak -> AED 4)
    const salikMiddayOffPeak = calculateUaeTollTariff({
      tollSystem: 'SALIK',
      occurredAt: '2026-11-16T08:30:00Z',
    });
    expect(salikMiddayOffPeak.tariffBand).toBe('OFF_PEAK');
    expect(salikMiddayOffPeak.tollAmountAed).toBe(4);

    // 22:30 UTC (Sun) = 02:30 UAE GST (Mon Night Free 01:00–05:59 -> AED 0, adminFee 0)
    const salikNightFree = calculateUaeTollTariff({
      tollSystem: 'SALIK',
      occurredAt: '2026-11-15T22:30:00Z',
    });
    expect(salikNightFree.tariffBand).toBe('NIGHT_FREE');
    expect(salikNightFree.tollAmountAed).toBe(0);
    expect(salikNightFree.adminFeeAed).toBe(0);

    // Sunday 2026-11-15 04:30 UTC = 08:30 UAE GST (Sunday all-day Off-Peak -> AED 4)
    const salikSunday = calculateUaeTollTariff({
      tollSystem: 'SALIK',
      occurredAt: '2026-11-15T04:30:00Z',
    });
    expect(salikSunday.tariffBand).toBe('OFF_PEAK');
    expect(salikSunday.tollAmountAed).toBe(4);

    // Abu Dhabi Darb Peak: Monday 03:30 UTC = 07:30 UAE GST -> AED 4
    const darbPeak = calculateUaeTollTariff({
      tollSystem: 'DARB',
      occurredAt: '2026-11-16T03:30:00Z',
      strictDarbWindow: true,
    });
    expect(darbPeak.tariffBand).toBe('PEAK');
    expect(darbPeak.tollAmountAed).toBe(4);
  });

  it('enforces UAE Resident local license rule, Tourist IDP rule, Emirates ID format, and Luxury 25+ age in assertCustomerEligibleForRental', async () => {
    expect(isValidEmiratesIdNumber('784-1990-1234567-1')).toBe(true);
    expect(isValidEmiratesIdNumber('123-1990-1234567-1')).toBe(false);

    const makeCustomerTx = (kycRow: Record<string, unknown>, baseOverrides: Record<string, unknown> = {}) =>
      ({
        rentalCustomer: {
          findFirst: vi.fn(async () => ({
            id: 'cust-kyc-1',
            customerType: 'INDIVIDUAL',
            blacklisted: false,
            drivingLicenseNo: 'DL-998877',
            licenseExpiry: new Date('2029-12-31T00:00:00Z'),
            creditLimit: null,
            ...baseOverrides,
          })),
        },
        $executeRawUnsafe: vi.fn(async () => 0),
        $queryRawUnsafe: vi.fn(async () => [kycRow]),
      }) as unknown as TxClient;

    // 1. Missing license when requireLicenseOnFile: true -> LICENSE_REQUIRED
    await expect(
      assertCustomerEligibleForRental(
        makeCustomerTx({}, { drivingLicenseNo: null, licenseExpiry: null }),
        {
          tenantId: 'tenant-1',
          customerId: 'cust-kyc-1',
          requireLicenseOnFile: true,
        },
      ),
    ).rejects.toMatchObject({ code: 'LICENSE_REQUIRED', status: 422 });

    // 2. UAE Resident presenting foreign (non-UAE) driving license at handover -> UAE_RESIDENT_FOREIGN_LICENSE
    await expect(
      assertCustomerEligibleForRental(
        makeCustomerTx({
          emirates_id: '784-1988-7654321-2',
          emirates_id_expiry: '2029-05-01',
          passport_expiry: '2030-05-01',
          visa_type: 'RESIDENT',
          international_permit_no: null,
          international_permit_expiry: null,
          license_issuing_country: 'GB',
          date_of_birth: '1988-06-15',
        }),
        {
          tenantId: 'tenant-1',
          customerId: 'cust-kyc-1',
          dropoffDate: new Date('2027-02-01T00:00:00Z'),
          requireLicenseOnFile: true,
        },
      ),
    ).rejects.toMatchObject({ code: 'UAE_RESIDENT_FOREIGN_LICENSE', status: 422 });

    // 3. Tourist from non-exempt country (INDIA) without IDP -> IDP_REQUIRED
    await expect(
      assertCustomerEligibleForRental(
        makeCustomerTx({
          emirates_id: null,
          emirates_id_expiry: null,
          passport_expiry: '2030-05-01',
          visa_type: 'TOURIST',
          international_permit_no: null,
          international_permit_expiry: null,
          license_issuing_country: 'INDIA',
          date_of_birth: '1990-03-10',
        }),
        {
          tenantId: 'tenant-1',
          customerId: 'cust-kyc-1',
          dropoffDate: new Date('2027-02-01T00:00:00Z'),
          requireLicenseOnFile: true,
        },
      ),
    ).rejects.toMatchObject({ code: 'IDP_REQUIRED', status: 422 });

    // 4. Tourist from bilateral IDP-exempt country (GB) without IDP -> passes!
    const exemptTourist = await assertCustomerEligibleForRental(
      makeCustomerTx({
        emirates_id: null,
        emirates_id_expiry: null,
        passport_expiry: '2030-05-01',
        visa_type: 'TOURIST',
        international_permit_no: null,
        international_permit_expiry: null,
        license_issuing_country: 'GB',
        date_of_birth: '1990-03-10',
      }),
      {
        tenantId: 'tenant-1',
        customerId: 'cust-kyc-1',
        dropoffDate: new Date('2027-02-01T00:00:00Z'),
        requireLicenseOnFile: true,
      },
    );
    expect(exemptTourist.id).toBe('cust-kyc-1');
  });

  it('parses ICAO-9303 UAE Emirates ID TD1 MRZ & Passport TD3 MRZ via scanKycDocumentMultimodal', async () => {
    const td1EmiratesIdMrz = [
      'IDARE1234567890784199012345671',
      '9005158M3012316ARE<<<<<<<<<<<4',
      'AL<MANSOORI<<KHALID<AHMED<<<<<',
    ].join('\n');

    const eidScan = await scanKycDocumentMultimodal({
      documentType: 'EMIRATES_ID',
      mrzText: td1EmiratesIdMrz,
    });
    expect(eidScan.provider).toBe('mrz-parser');
    expect(eidScan.emiratesId).toBe('784-1990-1234567-1');
    expect(eidScan.emiratesIdValid).toBe(true);
    expect(eidScan.fullName).toBe('Khalid Ahmed Al Mansoori');
    expect(eidScan.dateOfBirth).toBe('1990-05-15');
    expect(eidScan.expiryDate).toBe('2030-12-31');

    const td3PassportMrz = [
      'P<GBRWILSON<<EMMA<LOUISE<<<<<<<<<<<<<<<<<<<<',
      '5599221104GBR9108222F3106305<<<<<<<<<<<<<<02',
    ].join('\n');

    const ppScan = await scanKycDocumentMultimodal({
      documentType: 'PASSPORT',
      mrzText: td3PassportMrz,
    });
    expect(ppScan.provider).toBe('mrz-parser');
    expect(ppScan.fullName).toBe('Emma Louise Wilson');
    expect(ppScan.documentNumber).toContain('559922110');
    expect(ppScan.visaTypeHint).toBe('TOURIST');
  });

  it('routes regulatory renter manifests to RTA_TARRASHUD vs ABU_DHABI_ITC and queues inside savepoint', async () => {
    expect(determineUaeRegulatoryAuthority('Dubai International Airport T3')).toBe('RTA_TARRASHUD');
    expect(determineUaeRegulatoryAuthority('Abu Dhabi Yas Island Desk')).toBe('ABU_DHABI_ITC');
    expect(determineUaeRegulatoryAuthority('Al Ain Downtown Branch')).toBe('ABU_DHABI_ITC');
    expect(determineUaeRegulatoryAuthority('DXB', 'DUBAI_POLICE')).toBe('DUBAI_POLICE');

    const tx = {
      $executeRawUnsafe: vi.fn(async () => 0),
      $queryRawUnsafe: vi.fn(async (sql: string) => {
        if (sql.includes('FROM rental_agreements')) {
          return [
            {
              id: 'agr-trd-1',
              agreement_no: 'RA-000901',
              customer_id: 'cust-1',
              customer_name: 'Tariq Al Nahyan',
              vehicle_id: 'veh-auh-1',
              start_date: '2026-12-01T08:00:00Z',
              end_date: '2026-12-04T08:00:00Z',
              actual_return_date: null,
              pickup_location_code: 'Abu Dhabi Corniche Branch',
              dropoff_location_code: 'Abu Dhabi Corniche Branch',
            },
          ];
        }
        if (sql.includes('FROM rental_customers')) {
          return [
            {
              full_name: 'Tariq Al Nahyan',
              nationality: 'AE',
              visa_type: 'CITIZEN',
              emirates_id: '784-1985-1122334-5',
              passport_no: null,
              driving_license_no: 'AUH-99210',
              license_issuing_country: 'AE',
              license_expiry: '2031-01-01',
              international_permit_no: null,
              phone: '+971501112233',
            },
          ];
        }
        if (sql.includes('FROM vehicles')) {
          return [
            {
              plate_number: 'AUH-5-44910',
              make: 'Nissan',
              model: 'Patrol',
              vin: 'JN1TBNY62Z0011223',
            },
          ];
        }
        if (sql.includes('INSERT INTO rental_regulatory_reports')) {
          return [{ id: 'rep-auh-1', created_at: '2026-12-01T08:01:00Z' }];
        }
        return [];
      }),
    } as unknown as TxClient;

    const report = await queueUaeRegulatoryReportInTx(tx, {
      tenantId: 'tenant-uae-rac-1',
      agreementId: 'agr-trd-1',
      eventType: 'HANDOVER',
      submittedBy: 'staff-1',
    });

    expect(report).not.toBeNull();
    expect(report?.authority).toBe('ABU_DHABI_ITC');
    expect(report?.manifestPayload.schemaVersion).toBe('UAE-RAC-MANIFEST-2026.1');
    expect(report?.manifestPayload.vehicle.plateNumber).toBe('AUH-5-44910');
  });
});

describe('Section 6.5 — OTA Channels & ARI Sync, Cross-Border Geofence + Safe Immobilizer, & Grounded AI Copilot', () => {
  it('builds tenant-scoped OTA webhook URLs, signs ARI feeds with markup, blocks SSRF URLs, and normalizes booking lifecycle events', () => {
    const webhookUrl = buildChannelWebhookUrl(
      'https://app.fleet360.ae/',
      'YANGO_DRIVE',
      'tenant-dxb-01',
    );
    expect(webhookUrl).toBe(
      'https://app.fleet360.ae/api/rental/channels/yango_drive/webhook?tenantId=tenant-dxb-01',
    );

    const ari = buildOutboundAriPayload({
      tenantId: 'tenant-dxb-01',
      channelKey: 'RENTALCARS_COM',
      markupPct: 12,
      categories: [
        {
          category: 'ECONOMY',
          availableUnits: 4,
          totalUnits: 10,
          baseDailyRate: 100,
          weeklyRate: 600,
          monthlyRate: 2100,
          currency: 'AED',
        },
        {
          category: 'LUXURY',
          availableUnits: 0,
          totalUnits: 2,
          baseDailyRate: 900,
          weeklyRate: null,
          monthlyRate: null,
          currency: 'AED',
        },
      ],
    });

    expect(ari.summary.openCategories).toBe(1);
    expect(ari.summary.stopSellCategories).toBe(1);
    expect(ari.categories[0]?.channelDailyRate).toBe(112);
    expect(ari.categories[0]?.channelWeeklyRate).toBe(672);
    expect(ari.categories[1]?.status).toBe('STOP_SELL');

    const rawJson = JSON.stringify(ari);
    const sig = signOutboundAriPayload(rawJson, 'ota-hmac-secret-1');
    expect(verifyChannelSignature('ota-hmac-secret-1', rawJson, `sha256=${sig}`)).toBe(true);
    expect(verifyChannelSignature('wrong-secret', rawJson, sig)).toBe(false);

    // SSRF protection on outboundWebhookUrl
    expect(validateOutboundWebhookUrl('https://partner.yango.com/rac/ari')).toBe(
      'https://partner.yango.com/rac/ari',
    );
    expect(() => validateOutboundWebhookUrl('http://partner.yango.com/rac/ari')).toThrow(/https/i);
    expect(() => validateOutboundWebhookUrl('https://127.0.0.1/internal')).toThrow();
    expect(() => validateOutboundWebhookUrl('https://169.254.169.254/latest/meta-data')).toThrow();
    expect(() => validateOutboundWebhookUrl('https://192.168.1.25/hook')).toThrow();

    // Lifecycle normalization: BOOKING_MODIFIED & BOOKING_CANCELLED
    const modEv = normalizeChannelWebhookEvent('SELFDRIVE_AE', {
      eventType: 'BOOKING_MODIFIED',
      bookingId: '99812',
      customer: { fullName: 'Nadia Al Suwaidi', phone: '+971553334455' },
      vehicleCategory: 'COMPACT_SUV',
      pickupDate: '2026-12-10T09:00:00Z',
      dropoffDate: '2026-12-15T09:00:00Z',
      dailyRate: 185,
      totalAmount: 925,
    });
    expect(modEv.eventType).toBe('BOOKING_MODIFIED');
    expect(modEv.externalRef).toMatch(/-99812$/);

    const cancelEv = normalizeChannelWebhookEvent('RENTALCARS_COM', {
      event: 'RESERVATION_CANCELLED',
      reservation_id: '774102',
      cancellation_reason: 'Flight delayed',
    });
    expect(cancelEv.eventType).toBe('BOOKING_CANCELLED');
    expect(cancelEv.externalRef).toBe('RC-774102');
    expect(cancelEv.cancellationReason).toBe('Flight delayed');
  });

  it('detects unauthorized UAE–Oman cross-border geofence breaches and authorizes trips covered by an active NOC permit', async () => {
    // 1. Inside Dubai mainland (Downtown Dubai: 25.1972, 55.2744) -> INSIDE_UAE, authorized
    const baseFkTx = (permitRows: unknown[]) =>
      ({
        vehicle: { findFirst: vi.fn(async () => ({ id: 'veh-gps-1' })) },
        rentalAgreement: { findFirst: vi.fn(async () => ({ id: 'agr-gps-1' })) },
        $executeRawUnsafe: vi.fn(async () => 0),
        $queryRawUnsafe: vi.fn(async (sql: string) => {
          if (sql.includes('FROM rental_cross_border_permits')) return permitRows;
          if (sql.includes('INSERT INTO alerts')) return [{ id: 'alert-oman-breach-1' }];
          return [];
        }),
      }) as unknown as TxClient;

    const insideDubai = await evaluateCrossBorderGeofenceInTx(baseFkTx([]), 'tenant-1', {
      vehicleId: 'veh-gps-1',
      agreementId: 'agr-gps-1',
      latitude: 25.1972,
      longitude: 55.2744,
      speedKmh: 80,
    });
    expect(insideDubai.zoneStatus).toBe('INSIDE_UAE');
    expect(insideDubai.breachDetected).toBe(false);

    // 2. Deep inside Oman (Muscat highway east of Hatta/Wajajah: 24.55, 56.55) WITHOUT NOC -> CRITICAL breach + alert
    const omanBreach = await evaluateCrossBorderGeofenceInTx(baseFkTx([]), 'tenant-1', {
      vehicleId: 'veh-gps-1',
      agreementId: 'agr-gps-1',
      latitude: 24.55,
      longitude: 56.55,
      speedKmh: 110,
    });
    expect(omanBreach.breachDetected).toBe(true);
    expect(omanBreach.authorized).toBe(false);
    expect(omanBreach.detectedCountry).toBe('OMAN');
    expect(omanBreach.alertId).toBe('alert-oman-breach-1');

    // 3. Same Oman coordinates WITH active ISSUED Cross-Border NOC Permit -> authorized, 0 breach
    const omanAuthorized = await evaluateCrossBorderGeofenceInTx(
      baseFkTx([
        {
          permit_no: 'NOC-OMN-2026-0041',
          destination_country: 'OMAN',
          return_date: '2026-12-25T23:59:59Z',
        },
      ]),
      'tenant-1',
      {
        vehicleId: 'veh-gps-1',
        agreementId: 'agr-gps-1',
        latitude: 24.55,
        longitude: 56.55,
        speedKmh: 110,
      },
    );
    expect(omanAuthorized.authorized).toBe(true);
    expect(omanAuthorized.breachDetected).toBe(false);
    expect(omanAuthorized.permitNo).toBe('NOC-OMN-2026-0041');
  });

  it('enforces mandatory Road-Safety Interlock on remote starter-kill immobilizer commands', async () => {
    const makeImmobTx = (speedKmh: number, ignitionOn: boolean) =>
      ({
        vehicle: { findFirst: vi.fn(async () => ({ id: 'veh-immob-1' })) },
        rentalAgreement: { findFirst: vi.fn(async () => ({ id: 'agr-immob-1' })) },
        $executeRawUnsafe: vi.fn(async () => 0),
        $queryRawUnsafe: vi.fn(async (sql: string) => {
          if (sql.includes('FROM vehicles')) {
            return [
              {
                id: 'veh-immob-1',
                license_plate: 'DXB-A-88210',
                make: 'Toyota',
                model: 'Land Cruiser',
                category: 'FULL_SIZE_SUV',
                status: 'RENTED',
                current_mileage: 34500,
                fuel_level: 75,
                last_speed_kmh: speedKmh,
                ignition_on: ignitionOn,
              },
            ];
          }
          if (sql.includes('INSERT INTO rental_immobilizer_commands')) {
            return [{ id: 'immob-cmd-1', created_at: '2026-12-02T12:00:00Z' }];
          }
          return [];
        }),
      }) as unknown as TxClient;

    // 1. Moving vehicle (95 km/h on Sheikh Zayed Rd) -> NEVER cuts power; queues PENDING_SAFE_STOP!
    const movingCmd = await executeSafeImmobilizerCommandInTx(makeImmobTx(95, true), 'tenant-1', {
      vehicleId: 'veh-immob-1',
      agreementId: 'agr-immob-1',
      action: 'IMMOBILIZE',
      reason: 'Unauthorized Oman border approach after overdue contract',
      requestedBy: 'mgr-user-1',
      telemetryOverride: { speedKmh: 95, ignitionOn: true },
    });
    expect(movingCmd.safetyInterlockPassed).toBe(false);
    expect(movingCmd.status).toBe('PENDING_SAFE_STOP');
    expect(movingCmd.executedAt).toBeNull();

    // 2. Stationary parked vehicle (0 km/h AND ignition OFF) -> safetyInterlockPassed = true, EXECUTED
    const parkedCmd = await executeSafeImmobilizerCommandInTx(makeImmobTx(0, false), 'tenant-1', {
      vehicleId: 'veh-immob-1',
      agreementId: 'agr-immob-1',
      action: 'IMMOBILIZE',
      reason: 'Vehicle safely parked; overdue 14 days unpaid balance',
      requestedBy: 'mgr-user-1',
      telemetryOverride: { speedKmh: 0, ignitionOn: false },
    });
    expect(parkedCmd.safetyInterlockPassed).toBe(true);
    expect(parkedCmd.status).toBe('EXECUTED');
    expect(parkedCmd.executedAt).not.toBeNull();

    // 3. RESTORE command releases starter-kill latch immediately
    const restoreCmd = await executeSafeImmobilizerCommandInTx(makeImmobTx(0, false), 'tenant-1', {
      vehicleId: 'veh-immob-1',
      agreementId: 'agr-immob-1',
      action: 'RESTORE',
      reason: 'Customer settled overdue invoice in full',
      requestedBy: 'mgr-user-1',
    });
    expect(restoreCmd.status).toBe('RESTORED');
    expect(restoreCmd.restoredAt).not.toBeNull();
  });

  it('extracts bilingual EN/AR rental intents and grounds AI Copilot quotes strictly in tenant PricingRules, RateEvents, Ancillaries & real Fleet stock', async () => {
    const arIntent = parseRentalIntentDeterministic(
      'أريد استئجار سيارة دفع رباعي فاخرة لمدة 5 أيام من مطار دبي مع مقعد طفل وتأمين شامل',
    );
    expect(arIntent.detectedLanguage).toBe('ar');
    expect(arIntent.rentalDays).toBe(5);
    expect(arIntent.requestedAncillaries.some((a) => a.code === 'CHILD_SEAT')).toBe(true);

    const enIntent = parseRentalIntentDeterministic(
      'Corporate client needs a Compact SUV from 2026-12-07 to 2026-12-11 from Dubai Marina with 1 child seat and SCDW insurance',
    );
    expect(enIntent.vehicleCategory).toBe('COMPACT_SUV');
    expect(enIntent.rentalDays).toBe(4);
    expect(enIntent.channel).toBe('CORPORATE');

    // Grounded Phase 2 quote inside tx:
    // Tenant has:
    //   - 1 available COMPACT_SUV vehicle (RAV4)
    //   - Tenant PricingRule (`SELECT * FROM pricing_rules`): AED 220/day for COMPACT_SUV
    //   - Tenant Ancillary catalogue (`SELECT to_jsonb(ra) AS row_json FROM rental_ancillaries`): CHILD_SEAT = AED 30/day
    const copilotTx = {
      $executeRawUnsafe: vi.fn(async () => 0),
      $queryRawUnsafe: vi.fn(async (sql: string) => {
        if (sql.includes('FROM pricing_rules')) {
          return [
            {
              id: 'pr-csuv-1',
              name: 'Tenant Corporate SUV Tariff 2026',
              vehicle_category: 'COMPACT_SUV',
              base_daily_rate: 220,
              weekly_rate: 1350,
              monthly_rate: 4500,
              priority: 10,
              is_active: true,
              insurance_plans: JSON.stringify([
                { code: 'SUPER_CDW', name: 'Super CDW (Zero Excess)', dailyRate: 65 },
              ]),
            },
          ];
        }
        if (sql.includes('FROM vehicles v') && sql.includes('license_plate')) {
          return [
            {
              id: 'veh-rav4-1',
              license_plate: 'DXB-K-11209',
              make: 'Toyota',
              model: 'RAV4',
              year: 2026,
              category: 'COMPACT_SUV',
              vehicle_type: 'SUV',
              status: 'AVAILABLE',
              fuel_level: 100,
              current_mileage: 8400,
              odometer_reading: 8400,
              branch_id: 'br-marina-1',
            },
          ];
        }
        if (sql.includes('FROM rental_ancillaries')) {
          return [
            {
              row_json: {
                id: 'anc-child-1',
                code: 'CHILD_SEAT',
                name_en: 'Child Safety Seat (ISOFIX)',
                pricing_type: 'PER_DAY',
                unit_price: 30,
                is_active: true,
              },
            },
          ];
        }
        return [];
      }),
    } as unknown as TxClient;

    const grounded = await buildGroundedRentalQuoteInTx(copilotTx, 'tenant-uae-rac-1', enIntent);

    expect(grounded.availableCount).toBe(1);
    expect(grounded.availableVehicles[0]?.licensePlate).toBe('DXB-K-11209');
    expect(grounded.suggestion.baseDailyRate).toBe(220);
    expect(grounded.suggestion.baseRentalCharge).toBe(880); // 4 weekday days * 220 from tenant PricingRule
    expect(grounded.suggestion.ancillariesTotal).toBe(120); // 4 days * 30 from tenant rental_ancillaries
    expect(grounded.suggestion.vatPct).toBe(5);
    expect(grounded.appliedPricingRule?.name).toBe('Tenant Corporate SUV Tariff 2026');
  });
});
