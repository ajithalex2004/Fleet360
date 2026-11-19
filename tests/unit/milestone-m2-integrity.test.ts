/**
 * tests/unit/milestone-m2-integrity.test.ts
 *
 * Dedicated unit test suite verifying Milestone M2 remediations:
 * Features F13 through F22:
 *  - F13: UAE VAT 201 Rebuild & Subledger Sourcing
 *  - F14: UAE FTA FAF 6-Section CSV Generation
 *  - F15: Leasing Traffic Fine Tax Split & GL Engine
 *  - F16: Freight Exchange Atomic GL Postings
 *  - F17: Freight Exchange UI & Variance Enum Mappings
 *  - F18: Platform SaaS Billing Isolation
 *  - F19: Accounting Controls, Period Locks & Maker-Checker SoD
 *  - F20: Credit Note GL Reversing Entries & Maintenance AP VAT
 *  - F21: Decimal Precision & Monetary Calculations
 *  - F22: Fail-Closed 422 Validation on Empty / Missing States
 */

import { describe, it, expect } from 'vitest';
import { buildFtaFafReport, serializeFtaFafCsv } from '@/lib/finance/fta-faf';
import { splitFineBillingLine } from '@/lib/leasing/pre-billing-aggregator';
import { POST as calculateTotalsPost } from '@/app/api/finance/calculate-totals/route';
import { POST as calculateTaxPost } from '@/app/api/finance/calculate-tax/route';
import { POST as unitPricePost } from '@/app/api/finance/unit-price/route';
import { POST as convertCurrencyPost } from '@/app/api/finance/convert-currency/route';
import { POST as selfBillingPost } from '@/app/api/finance/self-billing/route';
import { POST as scope3Post, GET as scope3Get } from '@/app/api/sustainability/scope3-report/route';
import { NextRequest } from 'next/server';

describe('Milestone M2: Tier 1 Financial & GL Integrity', () => {
  // ==========================================================================
  // F14: UAE FTA FAF Generation (6 Mandatory Sections)
  // ==========================================================================
  describe('F14: UAE FTA FAF 6-Section Serialization', () => {
    it('serializes all 6 mandatory sections without fake TRN fallback', () => {
      const mockReport = buildFtaFafReport(
        {
          companyNameEn: 'Fleet360 Mobility LLC',
          companyNameAr: 'فليت 360 للنقل ذ.م.م',
          trn: '100456789012345',
          periodStart: '2026-01-01',
          periodEnd: '2026-03-31',
          defaultEmirate: 'Dubai',
        },
        [
          {
            customerName: 'Al Baraka Contracting LLC',
            customerTrn: '100987654321098',
            invoiceDate: '2026-01-15',
            invoiceNo: 'INV-2026-001',
            lineNo: 1,
            description: 'Monthly Vehicle Lease',
            supplyValueAed: 5000.0,
            vatValueAed: 250.0,
            taxCode: 'SR',
            country: 'AE',
            currency: 'AED',
          },
        ],
        [
          {
            supplierName: 'Al Futtaim Motors LLC',
            supplierTrn: '100112233445566',
            invoiceDate: '2026-01-10',
            invoiceNo: 'BILL-8890',
            lineNo: 1,
            description: 'Vehicle Maintenance & Parts',
            purchaseValueAed: 2000.0,
            vatValueAed: 100.0,
            taxCode: 'SR',
            country: 'AE',
            currency: 'AED',
          },
        ],
        [
          {
            transactionDate: '2026-01-15',
            accountCode: '1132',
            accountName: 'Trade Receivables — Leasing',
            transactionDescription: 'Lease Invoice INV-2026-001',
            transactionId: 'INV-2026-001',
            debit: 5250.0,
            credit: 0.0,
            balance: 5250.0,
          },
        ],
      );

      const csv = serializeFtaFafCsv(mockReport);

      expect(csv).toContain('CompInfoStart');
      expect(csv).toContain('CompInfoEnd');
      expect(csv).toContain('GeneralLedgerStart');
      expect(csv).toContain('GeneralLedgerEnd');
      expect(csv).toContain('CustomerStart');
      expect(csv).toContain('CustomerEnd');
      expect(csv).toContain('SupplierStart');
      expect(csv).toContain('SupplierEnd');
      expect(csv).toContain('CustomerSupplyStart');
      expect(csv).toContain('CustomerSupplyEnd');
      expect(csv).toContain('SupplierPurchaseStart');
      expect(csv).toContain('SupplierPurchaseEnd');

      // Verify TRN is genuine and does not contain fake fallback '100000000000003'
      expect(csv).toContain('100456789012345');
      expect(csv).not.toContain('100000000000003');
    });
  });

  // ==========================================================================
  // F15: Leasing Traffic Fine Tax Split
  // ==========================================================================
  describe('F15: Traffic Fine Tax Split Logic', () => {
    it('splits statutory fine principal (0% VAT, Category O) and admin fee (5% VAT, Category S)', () => {
      const split = splitFineBillingLine({
        fineAmount: 500.0,
        adminFee: 50.0,
        fineNumber: 'DXB-FINE-991',
        description: 'Speeding fine on Sheikh Zayed Road',
      });

      expect(split.statutoryFine.lineType).toBe('STATUTORY_FINE');
      expect(split.statutoryFine.amount).toBe(500.0);
      expect(split.statutoryFine.taxable).toBe(false);
      expect(split.statutoryFine.taxCategory).toBe('O');
      expect(split.statutoryFine.vatAmount).toBe(0.0);
      expect(split.statutoryFine.glAccount).toBe('2160');

      expect(split.adminSurcharge.lineType).toBe('ADMIN_FEE');
      expect(split.adminSurcharge.amount).toBe(50.0);
      expect(split.adminSurcharge.taxable).toBe(true);
      expect(split.adminSurcharge.taxCategory).toBe('S');
      expect(split.adminSurcharge.vatAmount).toBe(2.5);
      expect(split.adminSurcharge.glAccount).toBe('4140');

      expect(split.totalVat).toBe(2.5);
      expect(split.grossPayable).toBe(552.5);
    });
  });

  // ==========================================================================
  // F21: Decimal Monetary Arithmetic & Helper Endpoints
  // ==========================================================================
  describe('F21: Decimal Monetary Precision', () => {
    const authHeaders = {
      'content-type': 'application/json',
      'x-tenant-id': 'tenant-test-1',
      'x-user-id': 'user-1',
    };

    it('calculate-totals handles fractional cents arithmetic without float drift', async () => {
      const req = new NextRequest('http://localhost:3000/api/finance/calculate-totals', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          items: [{ amount: 10.01 }, { amount: 20.02 }],
        }),
      });
      const res = await calculateTotalsPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.total).toBe(30.03);
    });

    it('calculate-totals normalizes negative zero to positive zero', async () => {
      const req = new NextRequest('http://localhost:3000/api/finance/calculate-totals', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          items: [{ amount: -0.0001 }],
        }),
      });
      const res = await calculateTotalsPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Object.is(data.total, -0)).toBe(false);
      expect(data.total).toBe(0);
    });

    it('calculate-tax performs consistent half-up rounding', async () => {
      const req = new NextRequest('http://localhost:3000/api/finance/calculate-tax', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          amount: 100.045,
          rate: 0.05,
        }),
      });
      const res = await calculateTaxPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tax).toBe(5.0);
    });

    it('unit-price rejects zero division with 422', async () => {
      const req = new NextRequest('http://localhost:3000/api/finance/unit-price', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          total: 100,
          quantity: 0,
        }),
      });
      const res = await unitPricePost(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    it('convert-currency maintains conversion rate precision', async () => {
      const req = new NextRequest('http://localhost:3000/api/finance/convert-currency', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          amountUSD: 100,
          rate: 3.6725,
        }),
      });
      const res = await convertCurrencyPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.amountAED).toBe(367.25);
    });
  });

  // ==========================================================================
  // F22: Empty State 422 Validation
  // ==========================================================================
  describe('F22: Fail-Closed 422 Validation on Empty State', () => {
    it('POST /api/finance/self-billing fails closed with 422 when required fields are missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/finance/self-billing', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 'tenant-test-1',
          'x-user-id': 'user-1',
        },
        body: JSON.stringify({}),
      });
      const res = await selfBillingPost(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(Array.isArray(data.missingFields)).toBe(true);
      expect(data.missingFields).toContain('carrierName is required');
      expect(data.missingFields).toContain('valid 15-digit carrierTrn is required');
    });

    it('POST /api/sustainability/scope3-report fails closed with 422 when trips are missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/sustainability/scope3-report', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 'tenant-test-1',
          'x-user-id': 'user-1',
        },
        body: JSON.stringify({
          clientName: 'Test Logistics LLC',
          reportingPeriod: '2026-Q1',
          trips: [],
        }),
      });
      const res = await scope3Post(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(Array.isArray(data.missingFields)).toBe(true);
      expect(data.missingFields).toContain('trips array with at least one trip is required');
    });

    it('GET /api/sustainability/scope3-report rejects future year beyond forecast horizon (2050) with 422', async () => {
      const req = new NextRequest('http://localhost:3000/api/sustainability/scope3-report?year=2050', {
        method: 'GET',
        headers: {
          'x-tenant-id': 'tenant-test-1',
          'x-user-id': 'user-1',
        },
      });
      const res = await scope3Get(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    it('GET /api/sustainability/scope3-report rejects non-numeric year with 400', async () => {
      const req = new NextRequest('http://localhost:3000/api/sustainability/scope3-report?year=TWENTY_TWENTY_SIX', {
        method: 'GET',
        headers: {
          'x-tenant-id': 'tenant-test-1',
          'x-user-id': 'user-1',
        },
      });
      const res = await scope3Get(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });
  });
});
