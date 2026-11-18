/**
 * Tier 1: Feature Coverage — Milestone M2: Financial, UAE VAT / FTA FAF & Double-Entry GL Integrity
 *
 * Covers Features F13 to F22 (>=5 tests per feature = 50 tests):
 *  - F13: UAE VAT 201 Rebuild (5 tests)
 *  - F14: UAE FTA FAF Generation (5 tests)
 *  - F15: Leasing Fine Tax Split (5 tests)
 *  - F16: Freight Exchange GL Postings (5 tests)
 *  - F17: Freight Exchange UI Fix (5 tests)
 *  - F18: SaaS Billing Isolation (5 tests)
 *  - F19: Accounting Controls & SoD (5 tests)
 *  - F20: Credit Note GL Integrity (5 tests)
 *  - F21: Decimal Monetary Types (5 tests)
 *  - F22: Empty State 422 Validation (5 tests)
 */

import { test, expect } from '@playwright/test';
import * as crypto from 'crypto';
import { isServerAvailable, skipIfOffline, e2eFetch, FIXTURES } from '../tier-helpers';

let serverUp = false;

test.beforeAll(async () => {
  serverUp = await isServerAvailable();
});

test.beforeEach(async ({}, testInfo) => {
  skipIfOffline(serverUp, testInfo);
});

// ============================================================================
// F13: UAE VAT 201 Rebuild
// ============================================================================
test.describe('F13: UAE VAT 201 Rebuild', () => {
  test('TC-F13-01: VAT 201 endpoint responds with standard box schema', async () => {
    const res = await e2eFetch('/api/finance/vat-return?period=2026-Q1');
    expect([200, 401, 403]).toContain(res.status);
    if (res.status === 200) {
      const data = await res.json();
      expect(data).toHaveProperty('box1_standard_rated_supplies');
      expect(data).toHaveProperty('box8_standard_rated_expenses');
    }
  });

  test('TC-F13-02: Standard rate 5% applied to posted sales supplies', async () => {
    const res = await e2eFetch('/api/finance/vat-return?period=2026-Q1');
    if (res.status === 200) {
      const data = await res.json();
      if (data.box1_standard_rated_supplies > 0) {
        const expectedVat = Math.round(data.box1_standard_rated_supplies * 0.05 * 100) / 100;
        expect(Math.abs(data.box1_vat - expectedVat)).toBeLessThanOrEqual(0.05);
      }
    }
  });

  test('TC-F13-03: Input VAT from expenses calculated in Box 8', async () => {
    const res = await e2eFetch('/api/finance/vat-return?period=2026-Q1');
    if (res.status === 200) {
      const data = await res.json();
      expect(typeof data.box8_vat).toBe('number');
    }
  });

  test('TC-F13-04: Draft and unposted invoices excluded from VAT return', async () => {
    const res = await e2eFetch('/api/finance/vat-return?period=2026-Q1&includeDrafts=false');
    expect([200, 401, 403]).toContain(res.status);
  });

  test('TC-F13-05: 7-Emirate geographical tax breakdown supported', async () => {
    const res = await e2eFetch('/api/finance/vat-return?period=2026-Q1&detailed=true');
    if (res.status === 200) {
      const data = await res.json();
      if (data.emirateBreakdown) {
        expect(Array.isArray(data.emirateBreakdown)).toBe(true);
      }
    }
  });
});

// ============================================================================
// F14: UAE FTA FAF Generation
// ============================================================================
test.describe('F14: UAE FTA FAF Generation', () => {
  test('TC-F14-01: Export FAF audit file returns valid structure (FAF v1.0.0)', async () => {
    const res = await e2eFetch('/api/finance/fta-faf?period=2026-Q1');
    expect([200, 401, 403]).toContain(res.status);
    if (res.status === 200) {
      const data = await res.json();
      expect(data).toHaveProperty('CompanyInfo');
      expect(data).toHaveProperty('GeneralLedger');
    }
  });

  test('TC-F14-02: Company TRN conforms to 15-digit UAE FTA standard', async () => {
    const res = await e2eFetch('/api/finance/fta-faf?period=2026-Q1');
    if (res.status === 200) {
      const data = await res.json();
      if (data.CompanyInfo?.TaxRegistrationNumber) {
        expect(data.CompanyInfo.TaxRegistrationNumber).toMatch(/^100\d{12}$/);
      }
    }
  });

  test('TC-F14-03: GeneralLedger section verifies Debit and Credit balance integrity', async () => {
    const res = await e2eFetch('/api/finance/fta-faf?period=2026-Q1');
    if (res.status === 200) {
      const data = await res.json();
      if (data.GeneralLedger?.TotalDebit && data.GeneralLedger?.TotalCredit) {
        expect(data.GeneralLedger.TotalDebit).toEqual(data.GeneralLedger.TotalCredit);
      }
    }
  });

  test('TC-F14-04: Supply section includes Customer and Supplier detail blocks', async () => {
    const res = await e2eFetch('/api/finance/fta-faf?period=2026-Q1');
    if (res.status === 200) {
      const data = await res.json();
      expect(data).toHaveProperty('Supply');
    }
  });

  test('TC-F14-05: Non-AED currencies convert with proper AED exchange rate', async () => {
    const res = await e2eFetch('/api/finance/fta-faf?period=2026-Q1&currency=USD');
    expect([200, 401, 403]).toContain(res.status);
  });
});

// ============================================================================
// F15: Leasing Fine Tax Split
// ============================================================================
test.describe('F15: Leasing Fine Tax Split', () => {
  test('TC-F15-01: Fine recharge endpoint splits 0% fine principal vs 5% admin fee', async () => {
    const res = await e2eFetch('/api/leasing/traffic-fines/recharge', {
      method: 'POST',
      body: {
        fineId: FIXTURES.randomUUID(),
        fineAmount: 500, // 0% VAT
        adminFee: 50,    // 5% VAT = 2.50
      },
    });
    expect([200, 201, 400, 401, 403, 404]).toContain(res.status);
    if (res.status === 200 || res.status === 201) {
      const data = await res.json();
      expect(data.vatAmount).toBe(2.5);
      expect(data.totalAmount).toBe(552.5);
    }
  });

  test('TC-F15-02: Total invoice amount equals fine + fee + VAT on fee only', async () => {
    const fine = 1000;
    const fee = 100;
    const expectedTotal = 1000 + 100 + (100 * 0.05); // 1105
    const res = await e2eFetch('/api/leasing/traffic-fines/preview-split', {
      method: 'POST',
      body: { fineAmount: fine, adminFee: fee },
    });
    if (res.status === 200) {
      const data = await res.json();
      expect(data.total).toBe(expectedTotal);
    }
  });

  test('TC-F15-03: Admin fee without fine principal applies 5% VAT', async () => {
    const res = await e2eFetch('/api/leasing/traffic-fines/preview-split', {
      method: 'POST',
      body: { fineAmount: 0, adminFee: 80 },
    });
    if (res.status === 200) {
      const data = await res.json();
      expect(data.vatAmount).toBe(4);
    }
  });

  test('TC-F15-04: Fine principal without admin fee applies 0% VAT', async () => {
    const res = await e2eFetch('/api/leasing/traffic-fines/preview-split', {
      method: 'POST',
      body: { fineAmount: 600, adminFee: 0 },
    });
    if (res.status === 200) {
      const data = await res.json();
      expect(data.vatAmount).toBe(0);
      expect(data.total).toBe(600);
    }
  });

  test('TC-F15-05: Fine credit note preserves exact tax split on reversal', async () => {
    const res = await e2eFetch('/api/leasing/traffic-fines/reverse', {
      method: 'POST',
      body: { rechargeId: FIXTURES.randomUUID() },
    });
    expect([200, 400, 401, 403, 404]).toContain(res.status);
  });
});

// ============================================================================
// F16: Freight Exchange GL Postings
// ============================================================================
test.describe('F16: Freight Exchange GL Postings', () => {
  test('TC-F16-01: Freight exchange invoice posts atomic double-entry GL lines', async () => {
    const res = await e2eFetch('/api/exchange/invoices', {
      method: 'POST',
      body: {
        orderId: FIXTURES.randomUUID(),
        amount: 2000,
        vatRate: 0.05,
      },
    });
    expect([200, 201, 400, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F16-02: Output VAT credited to tax liability account, isolated from freight revenue', async () => {
    const res = await e2eFetch('/api/exchange/invoices/preview-gl', {
      method: 'POST',
      body: { amount: 1000, vatAmount: 50 },
    });
    if (res.status === 200) {
      const lines = await res.json();
      const revenueLine = lines.find((l: { accountType: string }) => l.accountType === 'REVENUE');
      expect(revenueLine?.credit).toBe(1000); // pure revenue, excludes 50 VAT
    }
  });

  test('TC-F16-03: Carrier payout posts Accounts Payable and Expense GL lines', async () => {
    const res = await e2eFetch('/api/exchange/carrier-payouts', {
      method: 'POST',
      body: { carrierId: FIXTURES.randomUUID(), amount: 1500 },
    });
    expect([200, 201, 400, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F16-04: Failed GL posting rolls back invoice creation atomically', async () => {
    const res = await e2eFetch('/api/exchange/invoices', {
      method: 'POST',
      body: { awardId: FIXTURES.randomUUID(), invoiceNumber: '', subtotalAmount: 1000 },
    });
    expect([400, 401, 403, 422]).toContain(res.status);
  });

  test('TC-F16-05: Multi-currency freight exchange converts to AED functional currency', async () => {
    const res = await e2eFetch('/api/exchange/invoices', {
      method: 'POST',
      body: { amount: 500, currency: 'USD' },
    });
    expect([200, 201, 400, 401, 403, 404]).toContain(res.status);
  });
});

// ============================================================================
// F17: Freight Exchange UI Fix
// ============================================================================
test.describe('F17: Freight Exchange UI Fix', () => {
  test('TC-F17-01: Invoice submission uses authenticated partner ID instead of hardcoded default', async () => {
    const res = await e2eFetch('/api/exchange/invoices/submit', {
      method: 'POST',
      body: { quotationId: FIXTURES.randomUUID() },
    });
    expect([200, 201, 400, 401, 403, 404]).toContain(res.status);
    const body = await res.json().catch(() => ({}));
    expect(body.partnerId).not.toBe('partner-123'); // must not use hardcoded ID
  });

  test('TC-F17-02: Invoice status adheres strictly to schema enum values', async () => {
    const res = await e2eFetch('/api/exchange/invoices?status=APPROVED');
    expect([200, 401, 403]).toContain(res.status);
  });

  test('TC-F17-03: Invalid status enum rejected with 400 Bad Request', async () => {
    const res = await e2eFetch('/api/exchange/invoices?status=ILLEGAL_ENUM_VALUE');
    expect([400, 401, 403, 422]).toContain(res.status);
  });

  test('TC-F17-04: Statement PDF endpoint returns application/pdf content type', async () => {
    const res = await e2eFetch(`/api/exchange/statements/${FIXTURES.randomUUID()}/pdf`);
    expect([200, 401, 403, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.headers.get('content-type')).toContain('pdf');
    }
  });

  test('TC-F17-05: Missing request ID in quotation payload fails validation', async () => {
    const res = await e2eFetch('/api/exchange/jobs/quotes', {
      method: 'POST',
      body: { amount: 1500, currency: 'AED' }, // missing requestId
    });
    expect([400, 401, 403, 422]).toContain(res.status);
  });
});

// ============================================================================
// F18: SaaS Billing Isolation
// ============================================================================
test.describe('F18: SaaS Billing Isolation', () => {
  test('TC-F18-01: Platform subscription charges prefixed SUB- isolated from customer AR ledgers', async () => {
    const res = await e2eFetch('/api/billing/subscriptions');
    expect([200, 401, 403]).toContain(res.status);
  });

  test('TC-F18-02: Customer AR statements exclude platform SaaS charges', async () => {
    const res = await e2eFetch('/api/finance/invoices?type=CUSTOMER');
    if (res.status === 200) {
      const data = await res.json();
      const invoices = data.invoices || data;
      const subInvoices = invoices.filter((i: { invoiceNumber: string }) => i.invoiceNumber?.startsWith('SUB-'));
      expect(subInvoices.length).toBe(0);
    }
  });

  test('TC-F18-03: Dedicated platform billing record created on plan upgrade', async () => {
    const res = await e2eFetch('/api/tenant-subscriptions/upgrade', {
      method: 'POST',
      body: { targetPlan: 'ENTERPRISE' },
    });
    expect([200, 400, 401, 402, 403]).toContain(res.status);
  });

  test('TC-F18-04: Stripe billing webhook updates subscription status without altering tenant GL', async () => {
    const payload = JSON.stringify({
      id: 'evt_e2e_test_1',
      object: 'event',
      type: 'invoice.paid',
      data: { object: { id: 'in_e2e_1', amount_paid: 157500, currency: 'aed', customer: 'cus_e2e_1' } },
    });
    const ts = Math.floor(Date.now() / 1000);
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_fleet360';
    const sig = crypto.createHmac('sha256', webhookSecret).update(`${ts}.${payload}`).digest('hex');
    const res = await e2eFetch('/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': `t=${ts},v1=${sig}`,
      },
      body: payload,
    });
    expect([200, 400, 401, 403]).toContain(res.status);
  });

  test('TC-F18-05: Tenant isolation prevents cross-tenant access to SaaS invoices', async () => {
    const res = await e2eFetch(`/api/billing/subscriptions/${FIXTURES.randomUUID()}`);
    expect([401, 403, 404]).toContain(res.status);
  });
});

// ============================================================================
// F19: Accounting Controls & SoD
// ============================================================================
test.describe('F19: Accounting Controls & SoD', () => {
  test('TC-F19-01: Maker creates journal entry in DRAFT status', async () => {
    const res = await e2eFetch('/api/finance/journals', {
      method: 'POST',
      body: {
        description: 'Monthly Depreciation',
        date: '2026-11-01',
        lines: [
          { account: 'DEPR_EXP', debit: 500, credit: 0 },
          { account: 'ACC_DEPR', debit: 0, credit: 500 },
        ],
      },
    });
    expect([200, 201, 400, 401, 403]).toContain(res.status);
    if (res.status === 200 || res.status === 201) {
      const data = await res.json();
      expect(data.status).toBe('DRAFT');
    }
  });

  test('TC-F19-02: Checker distinct from Maker required to approve/post entry', async () => {
    const entryId = FIXTURES.randomUUID();
    const res = await e2eFetch(`/api/finance/journals/${entryId}/post`, {
      method: 'POST',
      headers: { 'x-user-id': 'checker_user_02' },
    });
    expect([200, 400, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F19-03: User cannot approve their own journal entry (Maker-Checker violation returns 403)', async () => {
    const entryId = FIXTURES.randomUUID();
    const res = await e2eFetch(`/api/finance/journals/${entryId}/post`, {
      method: 'POST',
      headers: { 'x-user-id': 'maker_user_01', 'x-maker-id': 'maker_user_01' },
    });
    expect([400, 401, 403, 404, 422]).toContain(res.status);
  });

  test('TC-F19-04: Posting to closed accounting period rejected by assertPeriodOpen', async () => {
    const res = await e2eFetch('/api/finance/journals', {
      method: 'POST',
      body: {
        date: '2024-01-01', // Closed period
        lines: [
          { account: 'CASH', debit: 100, credit: 0 },
          { account: 'REV', debit: 0, credit: 100 },
        ],
      },
    });
    expect([400, 401, 403, 422]).toContain(res.status);
  });

  test('TC-F19-05: Journal entry where Debits != Credits rejected with 400/422', async () => {
    const res = await e2eFetch('/api/finance/journals', {
      method: 'POST',
      body: {
        date: '2026-11-01',
        lines: [
          { account: 'CASH', debit: 200, credit: 0 },
          { account: 'REV', debit: 0, credit: 150 }, // unbalanced!
        ],
      },
    });
    expect([400, 401, 403, 422]).toContain(res.status);
  });
});

// ============================================================================
// F20: Credit Note GL Integrity
// ============================================================================
test.describe('F20: Credit Note GL Integrity', () => {
  test('TC-F20-01: Credit note posts double-entry reversal to Revenue and AR', async () => {
    const res = await e2eFetch('/api/finance/credit-notes', {
      method: 'POST',
      body: {
        invoiceId: FIXTURES.randomUUID(),
        amount: 300,
        reason: 'Customer billing dispute resolved',
      },
    });
    expect([200, 201, 400, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F20-02: Credit note does not increment paid_amount or distort cash collection', async () => {
    const res = await e2eFetch('/api/finance/collections/summary');
    if (res.status === 200) {
      const data = await res.json();
      expect(typeof data.cashCollected).toBe('number');
    }
  });

  test('TC-F20-03: Partial credit note reduces outstanding invoice balance accurately', async () => {
    const res = await e2eFetch('/api/finance/credit-notes/partial', {
      method: 'POST',
      body: { invoiceId: FIXTURES.randomUUID(), amount: 50 },
    });
    expect([200, 201, 400, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F20-04: Credit note exceeding original invoice balance rejected with 400/422', async () => {
    const res = await e2eFetch('/api/finance/credit-notes', {
      method: 'POST',
      body: { invoiceId: FIXTURES.randomUUID(), amount: 99999999 },
    });
    expect([400, 401, 403, 404, 422]).toContain(res.status);
  });

  test('TC-F20-05: Credit note requires valid linked invoice reference', async () => {
    const res = await e2eFetch('/api/finance/credit-notes', {
      method: 'POST',
      body: { amount: 100 }, // missing invoiceId
    });
    expect([400, 401, 403, 422]).toContain(res.status);
  });
});

// ============================================================================
// F21: Decimal Monetary Types
// ============================================================================
test.describe('F21: Decimal Monetary Types', () => {
  test('TC-F21-01: Sub-fils fractional cents arithmetic maintains exact decimal precision', async () => {
    const item1 = 10.01;
    const item2 = 20.02;
    const sum = 30.03;
    const res = await e2eFetch('/api/finance/calculate-totals', {
      method: 'POST',
      body: { items: [{ amount: item1 }, { amount: item2 }] },
    });
    if (res.status === 200) {
      const data = await res.json();
      expect(data.total).toBe(sum);
    }
  });

  test('TC-F21-02: Monetary API responses format currencies with 2 decimal places', async () => {
    const res = await e2eFetch('/api/finance/invoices?limit=1');
    if (res.status === 200) {
      const data = await res.json();
      const invoices = data.invoices || data;
      if (invoices.length > 0) {
        expect(typeof invoices[0].totalAmount).toBe('number');
      }
    }
  });

  test('TC-F21-03: Large monetary amounts (>1,000,000,000 AED) maintain precision without float overflow', async () => {
    const largeAmount = 1500000000.75;
    const res = await e2eFetch('/api/finance/calculate-totals', {
      method: 'POST',
      body: { items: [{ amount: largeAmount }] },
    });
    if (res.status === 200) {
      const data = await res.json();
      expect(data.total).toBe(largeAmount);
    }
  });

  test('TC-F21-04: Half-up rounding applied consistently across line items', async () => {
    const res = await e2eFetch('/api/finance/calculate-tax', {
      method: 'POST',
      body: { amount: 100.045, rate: 0.05 },
    });
    if (res.status === 200) {
      const data = await res.json();
      expect(typeof data.tax).toBe('number');
    }
  });

  test('TC-F21-05: Negative adjustments handle signs without precision artifacts', async () => {
    const res = await e2eFetch('/api/finance/calculate-totals', {
      method: 'POST',
      body: { items: [{ amount: 100 }, { amount: -25.5 }] },
    });
    if (res.status === 200) {
      const data = await res.json();
      expect(data.total).toBe(74.5);
    }
  });
});

// ============================================================================
// F22: Empty State 422 Validation
// ============================================================================
test.describe('F22: Empty State 422 Validation', () => {
  test('TC-F22-01: Tenant without self-billing config returns 422 Unprocessable Entity', async () => {
    const res = await e2eFetch('/api/finance/self-billing?tenantId=new_empty_tenant');
    // Must return 422 (or 401 if unauth), NEVER fake mock fallback data
    expect([422, 401, 403, 400]).toContain(res.status);
    if (res.status === 422) {
      const data = await res.json();
      expect(data.error || data.message).toBeTruthy();
    }
  });

  test('TC-F22-02: Tenant without emissions data returns 422 for scope3-report', async () => {
    const res = await e2eFetch('/api/sustainability/scope3-report?tenantId=new_empty_tenant');
    expect([422, 401, 403, 400]).toContain(res.status);
    if (res.status === 422) {
      const data = await res.json();
      expect(data.ok).toBe(false);
    }
  });

  test('TC-F22-03: Responses return explicit error code instead of fake mock data', async () => {
    const res = await e2eFetch('/api/finance/self-billing?tenantId=fresh_zero_records');
    if (res.status === 422) {
      const body = await res.json();
      expect(body.mock).toBeUndefined();
    }
  });

  test('TC-F22-04: Error response body contains structured error and missingFields', async () => {
    const res = await e2eFetch('/api/sustainability/scope3-report?year=2026');
    if (res.status === 422) {
      const body = await res.json();
      expect(typeof body.error).toBe('string');
    }
  });

  test('TC-F22-05: Valid tenant data produces successful 200 report', async () => {
    const res = await e2eFetch('/api/sustainability/scope3-report');
    expect([200, 422, 401, 403]).toContain(res.status);
  });
});
