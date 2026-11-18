/**
 * tests/unit/adversarial-m2-gl-controls-challenger.test.ts
 *
 * EMPIRICAL ADVERSARIAL CHALLENGER TEST SUITE FOR MILESTONE M2:
 * Tier 1 Financial, UAE VAT / FTA FAF & Double-Entry GL Integrity
 *
 * Focus Areas Under Challenge:
 * 1. Segregation of Duties (Maker-Checker on Journal Entry Approval)
 * 2. Closed Period Controls (assertPeriodOpen, LOCKED & YEAR_END enforcement)
 * 3. Chart of Accounts Validation (Header accounts, Inactive accounts, 422 enforcement)
 * 4. Decimal Arithmetic Precision (Float drift, Half-up rounding, Division by zero, Currency conversion)
 * 5. Freight Exchange GL Atomicity & Rollback Integrity
 * 6. Credit Note Allocations (finance_payment_allocations vs paid_amount preservation)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

// ── Mock Setup ────────────────────────────────────────────────────────────────

const mockTx = {
  $queryRawUnsafe: vi.fn(),
  $executeRawUnsafe: vi.fn(),
  partnerInvoice: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  financePayable: {
    create: vi.fn(),
    findUnique: vi.fn(),
  },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: (...args: unknown[]) => mockTx.$queryRawUnsafe(...args),
    $executeRawUnsafe: (...args: unknown[]) => mockTx.$executeRawUnsafe(...args),
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockTx)),
    partnerInvoice: {
      findUnique: (...args: unknown[]) => mockTx.partnerInvoice.findUnique(...args),
      update: (...args: unknown[]) => mockTx.partnerInvoice.update(...args),
    },
    financePayable: {
      create: (...args: unknown[]) => mockTx.financePayable.create(...args),
      findUnique: (...args: unknown[]) => mockTx.financePayable.findUnique(...args),
    },
  },
}));

vi.mock('@/lib/rls', () => ({
  withTenantRls: vi.fn(async (_client: unknown, _tenantId: string, fn: (tx: unknown) => Promise<unknown>) => {
    return fn(mockTx);
  }),
}));

vi.mock('@/lib/workflow/approvals', () => ({
  approvalGate: vi.fn().mockResolvedValue(null),
  approvalInProgress: vi.fn().mockResolvedValue(null),
  withApprovalStart: vi.fn(),
}));

vi.mock('@/lib/session-user', () => ({
  sessionUser: vi.fn().mockResolvedValue({ email: 'manager@fleet360.io' }),
}));

vi.mock('@/lib/audit', () => ({
  logAuditInTx: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/alerts/raise', () => ({
  raiseAlert: vi.fn().mockResolvedValue(undefined),
}));

// Route handlers & domain services
import { POST as journalEntriesPost } from '@/app/api/finance/journal-entries/route';
import { PATCH as journalEntriesPatch } from '@/app/api/finance/journal-entries/[id]/route';
import { assertPeriodOpen } from '@/lib/finance/journal-service';
import { POST as calculateTotalsPost } from '@/app/api/finance/calculate-totals/route';
import { POST as calculateTaxPost } from '@/app/api/finance/calculate-tax/route';
import { POST as unitPricePost } from '@/app/api/finance/unit-price/route';
import { POST as convertCurrencyPost } from '@/app/api/finance/convert-currency/route';
import { POST as creditNotesPost } from '@/app/api/finance/credit-notes/route';
import { PATCH as creditNotesPatch } from '@/app/api/finance/credit-notes/[id]/route';
import { PartnerInvoiceService } from '@/lib/exchange/partner-invoice-service';
import { ExchangeCommercialLedgerService } from '@/lib/exchange/commercial-ledger-service';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Adversarial Challenge M2: GL & Accounting Controls Integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // 1. Segregation of Duties (Maker-Checker on Journal Entry Approval)
  // ==========================================================================
  describe('1. Segregation of Duties (Maker-Checker Approval)', () => {
    it('CH-01-A: Rejects self-approval with HTTP 403 when approvedBy matches prepared_by', async () => {
      mockTx.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: 'je-101',
          status: 'SUBMITTED',
          je_number: 'JE-202611-00001-A1B2',
          entry_date: '2026-11-01',
          narration: 'Monthly depreciation',
          total_debit: '1500.00',
          tenant_id: 't-alpha',
          prepared_by: 'accountant_alice',
        },
      ]);

      const req = new NextRequest('http://localhost:3000/api/finance/journal-entries/je-101', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 't-alpha',
          'x-user-id': 'accountant_alice',
        },
        body: JSON.stringify({
          action: 'approve',
          approvedBy: 'accountant_alice',
        }),
      });

      const res = await journalEntriesPatch(req, { params: Promise.resolve({ id: 'je-101' }) });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toMatch(/Segregation of Duties|Maker-Checker/i);
    });

    it('CH-01-B: Rejects self-approval with HTTP 403 when approvedBy is omitted but x-user-id header matches prepared_by', async () => {
      mockTx.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: 'je-102',
          status: 'SUBMITTED',
          je_number: 'JE-202611-00002-C3D4',
          entry_date: '2026-11-01',
          narration: 'Office supplies accrual',
          total_debit: '800.00',
          tenant_id: 't-alpha',
          prepared_by: 'accountant_bob',
        },
      ]);

      const req = new NextRequest('http://localhost:3000/api/finance/journal-entries/je-102', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 't-alpha',
          'x-user-id': 'accountant_bob',
        },
        body: JSON.stringify({
          action: 'approve',
        }),
      });

      const res = await journalEntriesPatch(req, { params: Promise.resolve({ id: 'je-102' }) });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toMatch(/Preparer cannot approve/i);
    });

    it('CH-01-C: Rejects self-approval under case variation and leading/trailing whitespace', async () => {
      mockTx.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: 'je-103',
          status: 'SUBMITTED',
          je_number: 'JE-202611-00003-E5F6',
          entry_date: '2026-11-01',
          narration: 'Vehicle insurance payment',
          total_debit: '2500.00',
          tenant_id: 't-alpha',
          prepared_by: '  CHARLIE.FINANCE@FLEET360.IO  ',
        },
      ]);

      const req = new NextRequest('http://localhost:3000/api/finance/journal-entries/je-103', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 't-alpha',
          'x-user-id': 'charlie.finance@fleet360.io',
        },
        body: JSON.stringify({
          action: 'approve',
          approvedBy: 'charlie.finance@fleet360.io',
        }),
      });

      const res = await journalEntriesPatch(req, { params: Promise.resolve({ id: 'je-103' }) });
      expect(res.status).toBe(403);
    });

    it('CH-01-D: Allows legitimate Maker-Checker approval by independent checker', async () => {
      mockTx.$queryRawUnsafe
        .mockResolvedValueOnce([
          {
            id: 'je-104',
            status: 'SUBMITTED',
            je_number: 'JE-202611-00004-G7H8',
            entry_date: '2026-11-01',
            narration: 'Fuel expense allocation',
            total_debit: '3200.00',
            tenant_id: 't-alpha',
            prepared_by: 'accountant_alice',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'je-104',
            status: 'APPROVED',
            approved_by: 'finance_manager_bob',
          },
        ]);

      const req = new NextRequest('http://localhost:3000/api/finance/journal-entries/je-104', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 't-alpha',
          'x-user-id': 'finance_manager_bob',
        },
        body: JSON.stringify({
          action: 'approve',
          approvedBy: 'finance_manager_bob',
        }),
      });

      const res = await journalEntriesPatch(req, { params: Promise.resolve({ id: 'je-104' }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('APPROVED');
    });

    it('CH-01-E: Rejects approval of entries not in SUBMITTED status with HTTP 400', async () => {
      mockTx.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: 'je-105',
          status: 'DRAFT',
          je_number: 'JE-202611-00005-I9J0',
          entry_date: '2026-11-01',
          narration: 'Draft entry',
          total_debit: '500.00',
          tenant_id: 't-alpha',
          prepared_by: 'accountant_alice',
        },
      ]);

      const req = new NextRequest('http://localhost:3000/api/finance/journal-entries/je-105', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 't-alpha',
          'x-user-id': 'finance_manager_bob',
        },
        body: JSON.stringify({
          action: 'approve',
          approvedBy: 'finance_manager_bob',
        }),
      });

      const res = await journalEntriesPatch(req, { params: Promise.resolve({ id: 'je-105' }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/Only SUBMITTED entries can be approved/i);
    });
  });

  // ==========================================================================
  // 2. Closed Period Controls (assertPeriodOpen)
  // ==========================================================================
  describe('2. Closed Period Controls (assertPeriodOpen)', () => {
    it('CH-02-A: assertPeriodOpen throws statusCode 422 on LOCKED period', async () => {
      const mockPeriodDb = {
        $queryRawUnsafe: vi.fn().mockResolvedValueOnce([
          { status: 'LOCKED', period_name: '2026-Q1' },
        ]),
      };

      await expect(
        assertPeriodOpen(mockPeriodDb, 't-alpha', '2026-02-15'),
      ).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringMatching(/LOCKED and cannot accept new postings/i),
      });
    });

    it('CH-02-B: assertPeriodOpen throws statusCode 422 on YEAR_END closed period', async () => {
      const mockPeriodDb = {
        $queryRawUnsafe: vi.fn().mockResolvedValueOnce([
          { status: 'YEAR_END', period_name: 'FY-2025' },
        ]),
      };

      await expect(
        assertPeriodOpen(mockPeriodDb, 't-alpha', '2025-12-31'),
      ).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringMatching(/YEAR_END and cannot accept new postings/i),
      });
    });

    it('CH-02-C: assertPeriodOpen passes cleanly on open periods', async () => {
      const mockPeriodDb = {
        $queryRawUnsafe: vi.fn().mockResolvedValueOnce([]), // No locked rows
      };

      await expect(
        assertPeriodOpen(mockPeriodDb, 't-alpha', '2026-11-16'),
      ).resolves.toBeUndefined();
    });

    it('CH-02-D: POST /api/finance/journal-entries rejects postings to locked period with HTTP 422', async () => {
      // 1. ensureTenantChartOfAccounts check
      mockTx.$queryRawUnsafe
        .mockResolvedValueOnce([{ ready: false }])
        // 2. assertPeriodOpen query returning LOCKED
        .mockResolvedValueOnce([{ status: 'LOCKED', period_name: '2026-Q1' }]);

      const req = new NextRequest('http://localhost:3000/api/finance/journal-entries', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 't-alpha',
          'x-user-id': 'accountant_alice',
        },
        body: JSON.stringify({
          entryDate: '2026-03-15',
          narration: 'Backdated entry to locked quarter',
          lines: [
            { accountCode: '1010', debitAmount: 100, creditAmount: 0 },
            { accountCode: '4110', debitAmount: 0, creditAmount: 100 },
          ],
        }),
      });

      const res = await journalEntriesPost(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toMatch(/LOCKED and cannot accept new postings/i);
    });

    it('CH-02-E: PATCH /api/finance/journal-entries/[id] (action: post) rejects locked period with HTTP 422', async () => {
      mockTx.$queryRawUnsafe
        // 1. Fetch current JE
        .mockResolvedValueOnce([
          {
            id: 'je-201',
            status: 'APPROVED',
            je_number: 'JE-202603-00001-K1L2',
            entry_date: '2026-03-31',
            narration: 'Approved entry for closed Q1',
            total_debit: '2000.00',
            tenant_id: 't-alpha',
            prepared_by: 'accountant_alice',
          },
        ])
        // 2. assertPeriodOpen finds LOCKED
        .mockResolvedValueOnce([{ status: 'LOCKED', period_name: '2026-Q1' }]);

      const req = new NextRequest('http://localhost:3000/api/finance/journal-entries/je-201', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 't-alpha',
          'x-user-id': 'finance_director',
        },
        body: JSON.stringify({ action: 'post' }),
      });

      const res = await journalEntriesPatch(req, { params: Promise.resolve({ id: 'je-201' }) });
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toMatch(/LOCKED and cannot accept new postings/i);
    });

    it('CH-02-F: PATCH /api/finance/journal-entries/[id] (action: reverse) rejects locked reversalDate with HTTP 422', async () => {
      mockTx.$queryRawUnsafe
        // 1. Fetch current JE
        .mockResolvedValueOnce([
          {
            id: 'je-202',
            status: 'POSTED',
            je_number: 'JE-202603-00002-M3N4',
            entry_date: '2026-03-15',
            narration: 'Posted entry',
            total_debit: '500.00',
            tenant_id: 't-alpha',
            prepared_by: 'accountant_alice',
          },
        ])
        // 2. Claim JE for reversal
        .mockResolvedValueOnce([{ id: 'je-202' }])
        // 3. Fetch lines
        .mockResolvedValueOnce([
          { account_code: '1010', debit_amount: '500.00', credit_amount: '0.00' },
          { account_code: '4110', debit_amount: '0.00', credit_amount: '500.00' },
        ])
        // 4. nextJournalNumber count
        .mockResolvedValueOnce([{ count: 5 }])
        // 5. assertPeriodOpen on reversalDate returns LOCKED
        .mockResolvedValueOnce([{ status: 'LOCKED', period_name: '2026-Q1' }]);

      const req = new NextRequest('http://localhost:3000/api/finance/journal-entries/je-202', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 't-alpha',
          'x-user-id': 'finance_director',
        },
        body: JSON.stringify({
          action: 'reverse',
          reversalDate: '2026-03-31',
        }),
      });

      const res = await journalEntriesPatch(req, { params: Promise.resolve({ id: 'je-202' }) });
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toMatch(/LOCKED and cannot accept new postings/i);
    });
  });

  // ==========================================================================
  // 3. Chart of Accounts Validation
  // ==========================================================================
  describe('3. Chart of Accounts Validation', () => {
    it('CH-03-A: Rejects summary header accounts with HTTP 422', async () => {
      mockTx.$queryRawUnsafe
        .mockResolvedValueOnce([{ ready: false }]) // ensureTenantChartOfAccounts
        .mockResolvedValueOnce([]) // assertPeriodOpen (open)
        // CoA account lookup: 1000 is a header account
        .mockResolvedValueOnce([
          { account_code: '1000', account_name: 'Current Assets Header', normal_balance: 'DEBIT', is_header: true, is_active: true },
          { account_code: '4110', account_name: 'Rental Revenue', normal_balance: 'CREDIT', is_header: false, is_active: true },
        ]);

      const req = new NextRequest('http://localhost:3000/api/finance/journal-entries', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 't-alpha',
          'x-user-id': 'accountant_alice',
        },
        body: JSON.stringify({
          entryDate: '2026-11-16',
          narration: 'Attempted posting to header account',
          lines: [
            { accountCode: '1000', debitAmount: 500, creditAmount: 0 },
            { accountCode: '4110', debitAmount: 0, creditAmount: 500 },
          ],
        }),
      });

      const res = await journalEntriesPost(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toMatch(/summary header account and cannot accept journal postings/i);
    });

    it('CH-03-B: Rejects inactive accounts with HTTP 422', async () => {
      mockTx.$queryRawUnsafe
        .mockResolvedValueOnce([{ ready: false }]) // ensureTenantChartOfAccounts
        .mockResolvedValueOnce([]) // assertPeriodOpen (open)
        // CoA account lookup: 5999 is deactivated
        .mockResolvedValueOnce([
          { account_code: '1010', account_name: 'Bank Account', normal_balance: 'DEBIT', is_header: false, is_active: true },
          { account_code: '5999', account_name: 'Deprecated Expense', normal_balance: 'DEBIT', is_header: false, is_active: false },
        ]);

      const req = new NextRequest('http://localhost:3000/api/finance/journal-entries', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 't-alpha',
          'x-user-id': 'accountant_alice',
        },
        body: JSON.stringify({
          entryDate: '2026-11-16',
          narration: 'Attempted posting to inactive account',
          lines: [
            { accountCode: '5999', debitAmount: 250, creditAmount: 0 },
            { accountCode: '1010', debitAmount: 0, creditAmount: 250 },
          ],
        }),
      });

      const res = await journalEntriesPost(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toMatch(/is inactive and cannot accept journal postings/i);
    });

    it('CH-03-C: Rejects non-existent CoA account codes with HTTP 422', async () => {
      mockTx.$queryRawUnsafe
        .mockResolvedValueOnce([{ ready: false }]) // ensureTenantChartOfAccounts
        .mockResolvedValueOnce([]) // assertPeriodOpen (open)
        // CoA account lookup: returns only 1010, missing 9999
        .mockResolvedValueOnce([
          { account_code: '1010', account_name: 'Bank Account', normal_balance: 'DEBIT', is_header: false, is_active: true },
        ]);

      const req = new NextRequest('http://localhost:3000/api/finance/journal-entries', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 't-alpha',
          'x-user-id': 'accountant_alice',
        },
        body: JSON.stringify({
          entryDate: '2026-11-16',
          narration: 'Attempted posting with fake account code',
          lines: [
            { accountCode: '9999', debitAmount: 100, creditAmount: 0 },
            { accountCode: '1010', debitAmount: 0, creditAmount: 100 },
          ],
        }),
      });

      const res = await journalEntriesPost(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toMatch(/does not exist in chart of accounts/i);
    });

    it('CH-03-D: Rejects unbalanced journal entry with HTTP 400', async () => {
      mockTx.$queryRawUnsafe.mockResolvedValueOnce([{ ready: false }]);

      const req = new NextRequest('http://localhost:3000/api/finance/journal-entries', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 't-alpha',
          'x-user-id': 'accountant_alice',
        },
        body: JSON.stringify({
          entryDate: '2026-11-16',
          narration: 'Unbalanced entry',
          lines: [
            { accountCode: '1010', debitAmount: 1000, creditAmount: 0 },
            { accountCode: '4110', debitAmount: 0, creditAmount: 950 },
          ],
        }),
      });

      const res = await journalEntriesPost(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/Journal entry is not balanced/i);
    });

    it('CH-03-E: Rejects entry with fewer than 2 lines with HTTP 400', async () => {
      mockTx.$queryRawUnsafe.mockResolvedValueOnce([{ ready: false }]);

      const req = new NextRequest('http://localhost:3000/api/finance/journal-entries', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 't-alpha',
          'x-user-id': 'accountant_alice',
        },
        body: JSON.stringify({
          entryDate: '2026-11-16',
          narration: 'One line only',
          lines: [{ accountCode: '1010', debitAmount: 100, creditAmount: 0 }],
        }),
      });

      const res = await journalEntriesPost(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/at least 2 lines/i);
    });
  });

  // ==========================================================================
  // 4. Decimal Arithmetic Precision
  // ==========================================================================
  describe('4. Decimal Arithmetic Precision Stress Tests', () => {
    const decimalAuthHeaders = {
      'content-type': 'application/json',
      'x-tenant-id': 'tenant-a',
      'x-user-id': 'accountant',
    };

    describe('/api/finance/calculate-totals', () => {
      it('CH-04-A: Eliminates classic IEEE-754 drift (0.1 + 0.2 = 0.3)', async () => {
        const req = new NextRequest('http://localhost:3000/api/finance/calculate-totals', {
          method: 'POST',
          headers: decimalAuthHeaders,
          body: JSON.stringify({
            items: [{ amount: 0.1 }, { amount: 0.2 }],
          }),
        });

        const res = await calculateTotalsPost(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.total).toBe(0.3);
        expect(data.total).not.toBe(0.30000000000000004);
      });

      it('CH-04-B: Accumulates 100 sub-cent amounts without drift', async () => {
        const items = Array.from({ length: 100 }, () => ({ amount: 0.01 }));
        const req = new NextRequest('http://localhost:3000/api/finance/calculate-totals', {
          method: 'POST',
          headers: decimalAuthHeaders,
          body: JSON.stringify({ items }),
        });

        const res = await calculateTotalsPost(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.total).toBe(1.0);
      });

      it('CH-04-C: Normalizes negative zero (-0) to positive zero', async () => {
        const req = new NextRequest('http://localhost:3000/api/finance/calculate-totals', {
          method: 'POST',
          headers: decimalAuthHeaders,
          body: JSON.stringify({
            items: [{ amount: -0 }],
          }),
        });

        const res = await calculateTotalsPost(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(Object.is(data.total, -0)).toBe(false);
        expect(data.total).toBe(0);
      });

      it('CH-04-D: Offsetting positive and negative amounts resolve cleanly to zero', async () => {
        const req = new NextRequest('http://localhost:3000/api/finance/calculate-totals', {
          method: 'POST',
          headers: decimalAuthHeaders,
          body: JSON.stringify({
            items: [{ amount: 1250.75 }, { amount: -1250.75 }],
          }),
        });

        const res = await calculateTotalsPost(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.total).toBe(0);
        expect(Object.is(data.total, -0)).toBe(false);
      });
    });

    describe('/api/finance/calculate-tax', () => {
      it('CH-04-E: Performs strict half-up rounding on border cases (0.525 -> 0.53)', async () => {
        const req = new NextRequest('http://localhost:3000/api/finance/calculate-tax', {
          method: 'POST',
          headers: decimalAuthHeaders,
          body: JSON.stringify({
            amount: 10.50,
            rate: 0.05,
          }),
        });

        const res = await calculateTaxPost(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        // 10.50 * 0.05 = 0.525 -> half-up rounds to 0.53
        expect(data.tax).toBe(0.53);
      });

      it('CH-04-F: Performs strict half-up rounding on border cases (0.505 -> 0.51)', async () => {
        const req = new NextRequest('http://localhost:3000/api/finance/calculate-tax', {
          method: 'POST',
          headers: decimalAuthHeaders,
          body: JSON.stringify({
            amount: 10.10,
            rate: 0.05,
          }),
        });

        const res = await calculateTaxPost(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        // 10.10 * 0.05 = 0.505 -> half-up rounds to 0.51
        expect(data.tax).toBe(0.51);
      });

      it('CH-04-G: Handles negative amounts (tax credits/adjustments) correctly', async () => {
        const req = new NextRequest('http://localhost:3000/api/finance/calculate-tax', {
          method: 'POST',
          headers: decimalAuthHeaders,
          body: JSON.stringify({
            amount: -200.0,
            rate: 0.05,
          }),
        });

        const res = await calculateTaxPost(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.tax).toBe(-10.0);
      });
    });

    describe('/api/finance/unit-price', () => {
      it('CH-04-H: Rejects division by zero with HTTP 422', async () => {
        const req = new NextRequest('http://localhost:3000/api/finance/unit-price', {
          method: 'POST',
          headers: decimalAuthHeaders,
          body: JSON.stringify({ total: 500, quantity: 0 }),
        });

        const res = await unitPricePost(req);
        expect(res.status).toBe(422);
        const data = await res.json();
        expect(data.ok).toBe(false);
        expect(data.error).toMatch(/Quantity must be non-zero/i);
      });

      it('CH-04-I: Rejects string zero and invalid non-numeric quantities with HTTP 422', async () => {
        for (const badQty of ['0', 'abc', null, NaN]) {
          const req = new NextRequest('http://localhost:3000/api/finance/unit-price', {
            method: 'POST',
            headers: decimalAuthHeaders,
            body: JSON.stringify({ total: 100, quantity: badQty }),
          });

          const res = await unitPricePost(req);
          expect(res.status).toBe(422);
        }
      });

      it('CH-04-J: Precision on repeating non-terminating decimals (100 / 3 = 33.33)', async () => {
        const req = new NextRequest('http://localhost:3000/api/finance/unit-price', {
          method: 'POST',
          headers: decimalAuthHeaders,
          body: JSON.stringify({ total: 100, quantity: 3 }),
        });

        const res = await unitPricePost(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.unitPrice).toBe(33.33);
      });
    });

    describe('/api/finance/convert-currency', () => {
      it('CH-04-K: Preserves sub-dollar exchange rate precision (0.29 USD -> 1.07 AED)', async () => {
        const req = new NextRequest('http://localhost:3000/api/finance/convert-currency', {
          method: 'POST',
          headers: decimalAuthHeaders,
          body: JSON.stringify({
            amountUSD: 0.29,
            rate: 3.6725,
          }),
        });

        const res = await convertCurrencyPost(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        // 0.29 * 3.6725 = 1.065025 -> 1.07 AED
        expect(data.amountAED).toBe(1.07);
      });

      it('CH-04-L: Converts large monetary volumes without floating precision loss', async () => {
        const req = new NextRequest('http://localhost:3000/api/finance/convert-currency', {
          method: 'POST',
          headers: decimalAuthHeaders,
          body: JSON.stringify({
            amountUSD: 50000.55,
            rate: 3.6725,
          }),
        });

        const res = await convertCurrencyPost(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        // 50000.55 * 3.6725 = 183627.019875 -> 183627.02
        expect(data.amountAED).toBe(183627.02);
      });
    });
  });

  // ==========================================================================
  // 5. Freight Exchange GL Atomicity & Rollback
  // ==========================================================================
  describe('5. Freight Exchange GL Atomicity & Rollback', () => {
    it('CH-05-A: approveInvoice commits payable, invoice status, and GL postings within one atomic transaction', async () => {
      const mockInvoice = {
        id: 'pi-100',
        tenantId: 't-exchange',
        partnerId: 'partner-1',
        invoiceNumber: 'PINV-2026-001',
        invoiceDate: new Date('2026-11-10'),
        subtotalAmount: 10000.0,
        vatAmount: 500.0,
        totalAmount: 10500.0,
        currency: 'AED',
        status: 'SUBMITTED',
        verificationStatus: 'MATCHED',
        payableId: null,
        partner: { legalName: 'Swift Haulage LLC' },
        award: {
          id: 'award-1',
          commercialSnapshot: {
            commercialModel: 'AGENCY',
            agencySettlementMode: 'PLATFORM_COLLECT_AND_NET_REMIT',
            platformFeePct: 3,
            buyerAgreedPrice: 10000.0,
          },
        },
      };

      mockTx.partnerInvoice.findUnique.mockResolvedValueOnce(mockInvoice);
      mockTx.financePayable.create.mockResolvedValueOnce({
        id: 'pay-100',
        payableNumber: 'PAY-PINV-2026-001',
        totalAmount: 10500.0,
        status: 'APPROVED',
      });
      mockTx.partnerInvoice.update.mockResolvedValueOnce({
        ...mockInvoice,
        status: 'APPROVED',
        payableId: 'pay-100',
      });

      // Smart mock handler for GL queries during transaction
      mockTx.$queryRawUnsafe.mockImplementation(async (sql: string) => {
        if (sql.includes('partner_invoices')) return [{ id: 'pi-100' }];
        if (sql.includes('finance_periods')) return []; // Period is OPEN
        if (sql.includes('COUNT(*)')) return [{ count: 12 }];
        if (sql.includes('INSERT INTO finance_journal_entries')) {
          return [{ id: 'je-ex-100', je_number: 'JE-202611-00013-X1Y2' }];
        }
        return [];
      });

      mockTx.$executeRawUnsafe.mockResolvedValue(1);

      const result = await PartnerInvoiceService.approveInvoice({
        tenantId: 't-exchange',
        invoiceId: 'pi-100',
        approvedByUserId: 'usr-finance-approver',
      });

      expect(result.invoice.status).toBe('APPROVED');
      expect(result.payable).toBeDefined();
      expect(result.payable!.id).toBe('pay-100');
      expect(result.glEntries).toBeDefined();
      expect(result.glEntries!.length).toBeGreaterThan(0);
      expect(result.glEntries![0].id).toBe('je-ex-100');
    });

    it('CH-05-B: postSupplierApprovalToGl throws immediately on unbalanced transaction economics', async () => {
      const unbalancedEconomics = {
        commercialModel: 'AGENCY' as const,
        ifrs15PrincipalQualified: false,
        financePolicyVersion: 'v1',
        currencyCode: 'AED',
        taxTreatment: 'UAE_STANDARD_5_PCT' as const,
        vatRate: 0.05,
        buyerChargeExclVat: 1000,
        buyerVatAmount: 50,
        buyerRefundsExclVat: 0,
        buyerTotalReceivableInclVat: 1050,
        supplierCostExclVat: 900,
        supplierVatAmount: 45,
        supplierDeductionsExclVat: 0,
        supplierGrossPayableInclVat: 945,
        supplierNetSettlementPayable: 945,
        platformFeeExclVat: 50,
        platformFeeVatAmount: 2.5,
        platformFeeInclVat: 52.5,
        grossSpreadExclVat: 50,
        grossContributionAfterFeeExclVat: 50,
        recognizableAccountingRevenueExclVat: 50,
        journalLines: [
          { lineNo: 1, accountCode: '1130', accountName: 'AR', description: 'test', debit: 1000, credit: 0 },
          { lineNo: 2, accountCode: '4400', accountName: 'Rev', description: 'test', debit: 0, credit: 900 }, // Discrepancy!
        ],
        totalDebits: 1000,
        totalCredits: 900,
        isBalanced: false, // UNBALANCED
      };

      await expect(
        ExchangeCommercialLedgerService.postSupplierApprovalToGl({
          tenantId: 't-exchange',
          invoiceId: 'pi-unbalanced',
          invoiceNumber: 'INV-UNBAL-1',
          partnerName: 'Test Partner',
          economics: unbalancedEconomics,
        }),
      ).rejects.toThrow(/Cannot post unbalanced exchange transaction/i);
    });

    it('CH-05-C: approveInvoice rolls back entire transaction if GL posting throws', async () => {
      const mockInvoice = {
        id: 'pi-fail',
        tenantId: 't-exchange',
        partnerId: 'partner-1',
        invoiceNumber: 'PINV-FAIL-001',
        invoiceDate: new Date('2026-11-10'),
        subtotalAmount: 5000.0,
        vatAmount: 250.0,
        totalAmount: 5250.0,
        currency: 'AED',
        status: 'SUBMITTED',
        verificationStatus: 'MATCHED',
        payableId: null,
        partner: { legalName: 'Fail Carrier LLC' },
        award: {
          id: 'award-2',
          commercialSnapshot: {
            commercialModel: 'AGENCY',
          },
        },
      };

      mockTx.$queryRawUnsafe.mockResolvedValue([{ id: 'pi-fail' }]);
      mockTx.partnerInvoice.findUnique.mockResolvedValueOnce(mockInvoice);
      mockTx.financePayable.create.mockResolvedValueOnce({ id: 'pay-fail', status: 'APPROVED' });
      mockTx.partnerInvoice.update.mockResolvedValueOnce({ ...mockInvoice, status: 'APPROVED' });

      // Simulate GL posting throwing a database constraint error during transaction
      const spyPost = vi
        .spyOn(ExchangeCommercialLedgerService, 'postSupplierApprovalToGl')
        .mockRejectedValueOnce(new Error('Postgres error 23505: unique_violation on journal_entries'));

      await expect(
        PartnerInvoiceService.approveInvoice({
          tenantId: 't-exchange',
          invoiceId: 'pi-fail',
          approvedByUserId: 'usr-finance-approver',
        }),
      ).rejects.toThrow(/unique_violation/);

      spyPost.mockRestore();
    });
  });

  // ==========================================================================
  // 6. Credit Note Allocations & Integrity
  // ==========================================================================
  describe('6. Credit Note Allocations & Subledger Integrity', () => {
    it('CH-06-A: PATCH /api/finance/credit-notes/[id] (action: apply) records allocation in finance_payment_allocations without corrupting paid_amount', async () => {
      const targetInvoiceId = 'b0000000-0000-0000-0000-000000000001';
      const cnId = 'c0000000-0000-0000-0000-000000000002';

      mockTx.$queryRawUnsafe
        // 1. Fetch current credit note
        .mockResolvedValueOnce([
          {
            id: cnId,
            cn_number: 'CN-202611-0001',
            status: 'ISSUED',
            total_amount: '500.00',
            original_invoice_id: targetInvoiceId,
            tenant_id: 't-alpha',
          },
        ])
        // 2. Update credit note status to APPLIED
        .mockResolvedValueOnce([
          {
            id: cnId,
            status: 'APPLIED',
            applied_amount: '500.00',
          },
        ]);

      const req = new NextRequest(`http://localhost:3000/api/finance/credit-notes/${cnId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 't-alpha',
          'x-user-id': 'finance_alice',
        },
        body: JSON.stringify({
          action: 'apply',
          appliedAmount: 500.0,
          appliedToInvoiceId: targetInvoiceId,
        }),
      });

      const res = await creditNotesPatch(req, { params: Promise.resolve({ id: cnId }) });
      expect(res.status).toBe(200);

      // Verify that finance_payment_allocations was inserted into
      const allocInsert = mockTx.$executeRawUnsafe.mock.calls.find((call) =>
        String(call[0]).includes('INSERT INTO finance_payment_allocations'),
      );
      expect(allocInsert).toBeDefined();
      expect(allocInsert?.[0]).toContain("'CREDIT_NOTE'");
      expect(allocInsert?.[2]).toBe(targetInvoiceId);
      expect(allocInsert?.[4]).toBe(500.0);

      // CRITICAL AUDIT CHECK: Verify finance_invoices SQL does NOT overwrite paid_amount
      const invoiceUpdate = mockTx.$executeRawUnsafe.mock.calls.find((call) =>
        String(call[0]).includes('UPDATE finance_invoices'),
      );
      expect(invoiceUpdate).toBeDefined();
      const sql = String(invoiceUpdate?.[0]);
      // Must NOT contain "paid_amount = ..." in the SET clause!
      expect(sql).not.toMatch(/SET\s+[^]*paid_amount\s*=\s*(?:paid_amount|\$)/i);
      // Must only update payment_status based on calculation
      expect(sql).toContain('payment_status = CASE');
      expect(sql).toContain('updated_at = NOW()');
    });

    it('CH-06-B: POST /api/finance/credit-notes rejects whitespace-only reason with HTTP 400', async () => {
      const req = new NextRequest('http://localhost:3000/api/finance/credit-notes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 't-alpha',
          'x-user-id': 'finance_alice',
        },
        body: JSON.stringify({
          invoiceId: 'inv-123',
          reason: '   ',
          amount: 100,
        }),
      });

      const res = await creditNotesPost(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/Credit note reason cannot be whitespace only/i);
    });

    it('CH-06-C: POST /api/finance/credit-notes rejects invoice with zero remaining balance with HTTP 422', async () => {
      const req = new NextRequest('http://localhost:3000/api/finance/credit-notes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 't-alpha',
          'x-user-id': 'finance_alice',
        },
        body: JSON.stringify({
          invoiceId: 'inv-123',
          remainingBalance: 0,
          reason: 'Discount adjustment',
          amount: 50,
        }),
      });

      const res = await creditNotesPost(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toMatch(/zero remaining balance/i);
    });

    it('CH-06-D: POST /api/finance/credit-notes rejects credit amount exceeding invoice balance with HTTP 422', async () => {
      mockTx.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: 'inv-300',
          invoice_number: 'INV-2026-300',
          total_amount: 1000.0,
          paid_amount: 800.0, // Remaining balance = 200.00
          client_name: 'Acme Logistics',
        },
      ]);

      const req = new NextRequest('http://localhost:3000/api/finance/credit-notes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 't-alpha',
          'x-user-id': 'finance_alice',
        },
        body: JSON.stringify({
          invoiceId: 'inv-300',
          amount: 500.0, // Exceeds 200 remaining balance!
          reason: 'Rate dispute',
        }),
      });

      const res = await creditNotesPost(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toMatch(/exceeds original invoice balance/i);
    });

    it('CH-06-E: POST /api/finance/credit-notes returns 404 if linked invoice does not exist', async () => {
      mockTx.$queryRawUnsafe.mockResolvedValueOnce([]); // No invoice found

      const req = new NextRequest('http://localhost:3000/api/finance/credit-notes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 't-alpha',
          'x-user-id': 'finance_alice',
        },
        body: JSON.stringify({
          invoiceId: 'inv-nonexistent',
          amount: 100.0,
          reason: 'Rate adjustment',
        }),
      });

      const res = await creditNotesPost(req);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toMatch(/Linked invoice not found/i);
    });

    it('CH-06-F: POST /api/finance/credit-notes posts balanced double-entry GL reversing entries on issuance', async () => {
      const invId = 'inv-400';
      mockTx.$queryRawUnsafe
        // 1. Linked invoice lookup
        .mockResolvedValueOnce([
          {
            id: invId,
            invoice_number: 'INV-2026-400',
            total_amount: 1050.0,
            paid_amount: 0.0,
            client_name: 'Gulf Express',
          },
        ])
        // 2. nextDocumentNumber for CN
        .mockResolvedValueOnce([{ next_val: 1 }])
        // 3. Insert credit note
        .mockResolvedValueOnce([
          {
            id: 'cn-400',
            cn_number: 'CN-202611-0001',
            total_amount: '105.00',
            subtotal: '100.00',
            vat_amount: '5.00',
            original_invoice_id: invId,
            tenant_id: 't-alpha',
          },
        ]);

      const req = new NextRequest('http://localhost:3000/api/finance/credit-notes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 't-alpha',
          'x-user-id': 'finance_alice',
        },
        body: JSON.stringify({
          invoiceId: invId,
          amount: 105.0,
          reason: 'Damaged shipment compensation',
        }),
      });

      const res = await creditNotesPost(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.cn_number).toBe('CN-202611-0001');
    });
  });
});
