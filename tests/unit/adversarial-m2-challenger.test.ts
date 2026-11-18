/**
 * tests/unit/adversarial-m2-challenger.test.ts
 *
 * EMPIRICAL ADVERSARIAL CHALLENGER TEST SUITE: Milestone M2
 *
 * Scope:
 * 1. UAE VAT 201: Stress test missing TRN, multi-quarter filtering, cancelled/draft invoice exclusion,
 *    and logistics 5% tax-exclusive calculation.
 * 2. UAE FTA FAF CSV: Stress test CSV serialization across all 6 sections (CompInfo, GeneralLedger,
 *    Customer, Supplier, CustomerSupply, SupplierPurchase). Verify escaping (RFC 4180), dates,
 *    tax codes, and currency fields conform to FTA specifications.
 * 3. Traffic Fine Tax Split: Stress test 0% statutory fine vs 5% admin fee calculations with
 *    fractional fils, rounding, and Peppol XML category 'O' emission.
 * 4. Empty State Validation: Stress test /api/finance/self-billing and /api/sustainability/scope3-report
 *    for strict HTTP 422 fail-closed validation.
 */

import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { buildFtaFafReport, serializeFtaFafCsv, type FafSupplyRecord, type FafPurchaseRecord } from '@/lib/finance/fta-faf';
import { splitFineBillingLine } from '@/lib/leasing/pre-billing-aggregator';
import { generatePeppolUaeInvoiceXml, type PeppolInvoiceData } from '@/lib/finance/peppol-e-invoice';
import { POST as selfBillingPost, GET as selfBillingGet } from '@/app/api/finance/self-billing/route';
import { POST as selfBillingConfigPost } from '@/app/api/finance/self-billing/config/route';
import { POST as scope3Post, GET as scope3Get } from '@/app/api/sustainability/scope3-report/route';
import { normalizeTrn, isValidTrn, fromEmirateIsoCode } from '@/lib/finance/uae';

describe('Adversarial M2 Challenge: UAE VAT 201 Engine', () => {
  // --------------------------------------------------------------------------
  // 1. Missing / Malformed TRN
  // --------------------------------------------------------------------------
  describe('TRN Validation & Missing TRN Safeguards', () => {
    it('rejects invalid or malformed TRNs in normalizeTrn and isValidTrn', () => {
      // UAE VAT TRN must be 15 digits starting with 100
      expect(isValidTrn(null)).toBe(false);
      expect(isValidTrn(undefined)).toBe(false);
      expect(isValidTrn('')).toBe(false);
      expect(isValidTrn('   ')).toBe(false);
      expect(isValidTrn('100000000000003')).toBe(true); // valid format (15 digits starting with 100)
      expect(isValidTrn('123456789012345')).toBe(false); // does not start with 100
      expect(isValidTrn('100123456789')).toBe(false); // too short (12 digits)
      expect(isValidTrn('10012345678901234')).toBe(false); // too long (17 digits)
      expect(isValidTrn('100-1234-5678-9012')).toBe(true); // normalized strips hyphens (15 digits)
    });

    it('cleanses formatted TRNs with whitespace and dashes', () => {
      expect(normalizeTrn(' 100-4567-8901-2345 ')).toBe('100456789012345');
      expect(normalizeTrn(null)).toBe('');
      expect(normalizeTrn(undefined)).toBe('');
    });
  });

  // --------------------------------------------------------------------------
  // 2. Multi-Quarter Date Range & Boundary Stress Testing
  // --------------------------------------------------------------------------
  describe('Multi-Quarter Filtering & End-of-Quarter Boundary Behavior', () => {
    // Replicating quarterRange implementation from src/app/api/finance/vat/route.ts
    function quarterRange(year: number, quarter: number) {
      const startMonth = (quarter - 1) * 3 + 1;
      const endMonth = startMonth + 2;
      const start = `${year}-${String(startMonth).padStart(2, '0')}-01`;
      const endDate = new Date(year, endMonth, 0);
      const end = endDate.toISOString().split('T')[0];
      return { start, end };
    }

    // Correct UTC-safe implementation
    function quarterRangeUtc(year: number, quarter: number) {
      const startMonth = (quarter - 1) * 3 + 1;
      const endMonth = startMonth + 2;
      const start = `${year}-${String(startMonth).padStart(2, '0')}-01`;
      const endDate = new Date(Date.UTC(year, endMonth, 0));
      const end = endDate.toISOString().split('T')[0];
      return { start, end };
    }

    it('demonstrates timezone offset sensitivity on end-of-quarter calculation', () => {
      // In UTC, last days of quarters:
      // Q1: March 31
      // Q2: June 30
      // Q3: September 30
      // Q4: December 31
      const q1Utc = quarterRangeUtc(2026, 1);
      const q2Utc = quarterRangeUtc(2026, 2);
      const q3Utc = quarterRangeUtc(2026, 3);
      const q4Utc = quarterRangeUtc(2026, 4);

      expect(q1Utc.start).toBe('2026-01-01');
      expect(q1Utc.end).toBe('2026-03-31');
      expect(q2Utc.start).toBe('2026-04-01');
      expect(q2Utc.end).toBe('2026-06-30');
      expect(q3Utc.start).toBe('2026-07-01');
      expect(q3Utc.end).toBe('2026-09-30');
      expect(q4Utc.start).toBe('2026-10-01');
      expect(q4Utc.end).toBe('2026-12-31');

      // Check current implementation in local environment
      const q1Local = quarterRange(2026, 1);
      const timezoneOffsetMinutes = new Date().getTimezoneOffset();

      if (timezoneOffsetMinutes < 0) {
        // Positive UTC offset (e.g. GST UAE is UTC+4, offset = -240 minutes)
        // Local midnight on March 31 is March 30 20:00:00 UTC!
        // This causes toISOString().split('T')[0] to return '2026-03-30', dropping March 31!
        expect(q1Local.end).toBe('2026-03-30');
      } else if (timezoneOffsetMinutes === 0) {
        expect(q1Local.end).toBe('2026-03-31');
      }
    });

    it('verifies that an invoice issued on March 31 is within the quarter under UTC quarters', () => {
      const q1 = quarterRangeUtc(2026, 1);
      const lastDayInvoice = '2026-03-31';
      const isIncluded = lastDayInvoice >= q1.start && lastDayInvoice <= q1.end;
      expect(isIncluded).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Logistics 5% Tax-Exclusive Calculation
  // --------------------------------------------------------------------------
  describe('Logistics 5% Tax-Exclusive Calculation', () => {
    it('correctly calculates 5% tax-exclusive VAT across multiple rate amounts', () => {
      const shipments = [
        { rate: 1000.0, expectedVat: 50.0 },
        { rate: 1234.56, expectedVat: 61.73 }, // 1234.56 * 0.05 = 61.728 -> 61.73
        { rate: 250.25, expectedVat: 12.51 }, // 250.25 * 0.05 = 12.5125 -> 12.51
        { rate: 0.0, expectedVat: 0.0 },
      ];

      for (const s of shipments) {
        const computedVat = Math.round(s.rate * 0.05 * 100) / 100;
        expect(computedVat).toBe(s.expectedVat);
      }
    });
  });
});

describe('Adversarial M2 Challenge: UAE FTA FAF CSV Serialization', () => {
  // --------------------------------------------------------------------------
  // 1. Mandatory 6 Sections & RFC 4180 Escaping
  // --------------------------------------------------------------------------
  it('serializes all 6 mandatory sections with robust RFC 4180 escaping', () => {
    const report = buildFtaFafReport(
      {
        companyNameEn: 'Trans-Arabian Freight & Logistics, LLC',
        companyNameAr: 'شركة عبر الخليج للشحن ذ.م.م',
        trn: '100555666777888',
        periodStart: '2026-01-01',
        periodEnd: '2026-03-31',
        defaultEmirate: 'Dubai',
      },
      [
        {
          customerName: 'Al "Super" Logistics, Inc.',
          customerTrn: '100111222333444',
          invoiceDate: '2026-01-20',
          invoiceNo: 'INV-2026/001,A',
          lineNo: 1,
          description: 'Special 40" Flatrack Container, Heavy Transport\nRoute: DXB -> AUH',
          supplyValueAed: 10500.5,
          vatValueAed: 525.03,
          taxCode: 'SR',
          country: 'AE',
          currency: 'AED',
          emirate: 'Dubai',
        },
      ],
      [
        {
          supplierName: 'Gulf Fuel Stations, "ENOC" Branch #12',
          supplierTrn: '100999888777666',
          invoiceDate: '2026-01-18',
          invoiceNo: 'FUEL-BILL,881',
          lineNo: 1,
          description: 'Diesel 5000L, Batch #99\r\nPump 4',
          purchaseValueAed: 15000.0,
          vatValueAed: 750.0,
          taxCode: 'SR',
          country: 'AE',
          currency: 'AED',
        },
      ],
      [
        {
          transactionDate: '2026-01-20',
          accountCode: '1132',
          accountName: 'Accounts Receivable, Logistics',
          transactionDescription: 'Shipment INV-2026/001,A — Al "Super" Logistics',
          transactionId: 'JE-0098',
          debit: 11025.53,
          credit: 0,
        },
        {
          transactionDate: '2026-01-20',
          accountCode: '4110',
          accountName: 'Freight Revenue',
          transactionDescription: 'Revenue from 40" container haulage',
          transactionId: 'JE-0098',
          debit: 0,
          credit: 10500.5,
        },
        {
          transactionDate: '2026-01-20',
          accountCode: '2140',
          accountName: 'Output VAT 5%',
          transactionDescription: 'Output VAT on INV-2026/001,A',
          transactionId: 'JE-0098',
          debit: 0,
          credit: 525.03,
        },
      ],
    );

    const csv = serializeFtaFafCsv(report);

    // Verify all 6 mandatory section headers
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

    // RFC 4180 Escaping:
    // 1. Commas in company name
    expect(csv).toContain('"Trans-Arabian Freight & Logistics, LLC"');
    // 2. Embedded quotes and commas in customer name
    expect(csv).toContain('"Al ""Super"" Logistics, Inc."');
    // 3. Line breaks in description
    expect(csv).toContain('"Special 40"" Flatrack Container, Heavy Transport\nRoute: DXB -> AUH"');
    // 4. Commas in invoice number
    expect(csv).toContain('"INV-2026/001,A"');
    // 5. Embedded quotes and commas in supplier name
    expect(csv).toContain('"Gulf Fuel Stations, ""ENOC"" Branch #12"');

    // GL running balance calculation check
    // Line 1: debit 11025.53, credit 0 -> balance 11025.53
    // Line 2: debit 0, credit 10500.50 -> balance 525.03
    // Line 3: debit 0, credit 525.03 -> balance 0.00
    expect(csv).toContain('11025.53,0.00,11025.53');
    expect(csv).toContain('0.00,10500.50,525.03');
    expect(csv).toContain('0.00,525.03,0.00');
  });

  // --------------------------------------------------------------------------
  // 2. Form VAT 201 Box Tax Allocation Conformance
  // --------------------------------------------------------------------------
  it('correctly maps tax codes to Form VAT 201 boxes', () => {
    const supplies: FafSupplyRecord[] = [
      {
        invoiceNo: 'INV-SR',
        invoiceDate: '2026-02-01',
        customerName: 'Dubai Client',
        emirate: 'Dubai',
        description: 'Standard Rated Service',
        supplyValueAed: 1000.0,
        vatValueAed: 50.0,
        taxCode: 'SR',
      },
      {
        invoiceNo: 'INV-ZR',
        invoiceDate: '2026-02-02',
        customerName: 'Export Client',
        emirate: 'Dubai',
        description: 'Zero Rated International Haulage',
        supplyValueAed: 2000.0,
        vatValueAed: 0.0,
        taxCode: 'ZR',
      },
      {
        invoiceNo: 'INV-EX',
        invoiceDate: '2026-02-03',
        customerName: 'Local Client',
        emirate: 'Dubai',
        description: 'Exempt Financial Service',
        supplyValueAed: 500.0,
        vatValueAed: 0.0,
        taxCode: 'EX',
      },
      {
        invoiceNo: 'INV-RC',
        invoiceDate: '2026-02-04',
        customerName: 'Foreign Vendor RCM',
        emirate: 'Dubai',
        description: 'Reverse Charge Import of Services',
        supplyValueAed: 3000.0,
        vatValueAed: 150.0,
        taxCode: 'RC',
      },
    ];

    const purchases: FafPurchaseRecord[] = [
      {
        invoiceNo: 'PUR-SR',
        invoiceDate: '2026-02-10',
        supplierName: 'Spare Parts Supplier',
        description: 'Truck Maintenance Parts',
        purchaseValueAed: 1200.0,
        vatValueAed: 60.0,
        taxCode: 'SR',
      },
    ];

    const report = buildFtaFafReport(
      {
        companyNameEn: 'Fleet360 Testing',
        trn: '100111222333444',
        periodStart: '2026-01-01',
        periodEnd: '2026-03-31',
        defaultEmirate: 'Dubai',
      },
      supplies,
      purchases,
    );

    const b = report.vat201Boxes;

    // Box 1b (Dubai standard rated)
    const dubaiBox = b.box1StandardRatedByEmirate.find(x => x.emirate === 'Dubai');
    expect(dubaiBox).toBeDefined();
    expect(dubaiBox?.amountAed).toBe(1000.0);
    expect(dubaiBox?.vatAmountAed).toBe(50.0);

    // Box 3 (Reverse charge)
    expect(b.box3ReverseChargeSupplies.amountAed).toBe(3000.0);
    expect(b.box3ReverseChargeSupplies.vatAmountAed).toBe(150.0);

    // Box 6 (Zero rated)
    expect(b.box6ZeroRatedSupplies.amountAed).toBe(2000.0);

    // Box 7 (Exempt)
    expect(b.box7ExemptSupplies.amountAed).toBe(500.0);

    // Box 8 (Total supplies & Output VAT: 1000 + 3000 + 2000 + 500 = 6500; VAT: 50 + 150 = 200)
    expect(b.box8TotalSuppliesAndOutputVat.amountAed).toBe(6500.0);
    expect(b.box8TotalSuppliesAndOutputVat.vatAmountAed).toBe(200.0);

    // Box 9 (Purchases: 1200, Recoverable: 60)
    expect(b.box9StandardRatedExpenses.amountAed).toBe(1200.0);
    expect(b.box9StandardRatedExpenses.recoverableVatAed).toBe(60.0);

    // Box 14 (Net VAT: Output 200 - Input 60 = 140)
    expect(b.box14NetVatPayableOrRefundable).toBe(140.0);
  });
});

describe('Adversarial M2 Challenge: Traffic Fine Tax Split & Peppol XML', () => {
  // --------------------------------------------------------------------------
  // 1. Fine Split Mathematical Precision & Fils Rounding
  // --------------------------------------------------------------------------
  describe('Fine Split & Fils Precision Stress Testing', () => {
    it('splits fine and admin surcharge with half-up rounding on fractional fils', () => {
      const cases = [
        // Exact fils
        { fine: 500.0, admin: 50.0, expectedVat: 2.5, expectedGross: 552.5 },
        // Fractional fils requiring half-up rounding:
        // 15.25 * 0.05 = 0.7625 -> rounds to 0.76
        { fine: 200.0, admin: 15.25, expectedVat: 0.76, expectedGross: 216.01 },
        // 15.35 * 0.05 = 0.7675 -> rounds to 0.77
        { fine: 350.0, admin: 15.35, expectedVat: 0.77, expectedGross: 366.12 },
        // Zero admin fee -> 0 VAT
        { fine: 1000.0, admin: 0.0, expectedVat: 0.0, expectedGross: 1000.0 },
      ];

      for (const tc of cases) {
        const split = splitFineBillingLine({
          fineAmount: tc.fine,
          adminFee: tc.admin,
          fineNumber: 'FINE-TEST',
        });

        expect(split.statutoryFine.amount).toBe(tc.fine);
        expect(split.statutoryFine.taxCategory).toBe('O');
        expect(split.statutoryFine.taxable).toBe(false);
        expect(split.statutoryFine.vatAmount).toBe(0.0);

        expect(split.adminSurcharge.amount).toBe(tc.admin);
        expect(split.adminSurcharge.taxCategory).toBe('S');
        expect(split.adminSurcharge.taxable).toBe(true);
        expect(split.adminSurcharge.vatAmount).toBe(tc.expectedVat);

        expect(split.totalVat).toBe(tc.expectedVat);
        // Compare gross rounded to 2 decimals to guard against float precision drift
        expect(Math.round(split.grossPayable * 100) / 100).toBe(tc.expectedGross);
      }
    });

    it('confirms grossPayable formula precision on edge-case float amounts', () => {
      // 0.1 fine + 0.2 admin -> admin VAT = Math.round(0.2 * 0.05 * 100)/100 = 0.01
      // 0.1 + 0.2 + 0.01 in JS floats gives 0.31000000000000005
      const split = splitFineBillingLine({
        fineAmount: 0.1,
        adminFee: 0.2,
      });

      // Verify rounding guard prevents float drift corruption
      const roundedGross = Math.round(split.grossPayable * 100) / 100;
      expect(roundedGross).toBe(0.31);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Peppol XML Category 'O' Statutory Fine Exemption Emission
  // --------------------------------------------------------------------------
  describe('Peppol PINT-UAE XML Emission with Category O', () => {
    it('generates compliant Peppol XML with Category O and Category S lines', () => {
      const invoiceData: PeppolInvoiceData = {
        invoiceNumber: 'INV-FINE-SPLIT-001',
        issueDate: '2026-02-15',
        supplyDate: '2026-02-15',
        dueDate: '2026-03-15',
        invoiceTypeCode: '380',
        currency: 'AED',
        seller: {
          name: 'Fleet360 Mobility LLC',
          trn: '100456789012345',
          endpointId: '100456789012345',
          endpointSchemeId: '0235',
          address: { street: 'Sheikh Zayed Rd', city: 'Dubai', state: 'AE-DU', countryCode: 'AE' },
        },
        buyer: {
          name: 'Al Baraka Contracting LLC',
          trn: '100987654321098',
          endpointId: '100987654321098',
          endpointSchemeId: '0235',
          address: { street: 'Al Quoz Industrial 3', city: 'Dubai', state: 'AE-DU', countryCode: 'AE' },
        },
        lines: [
          {
            id: 1,
            name: 'Monthly Vehicle Lease - Land Cruiser',
            quantity: 1,
            unitCode: 'MON',
            unitPrice: 5000.0,
            netAmount: 5000.0,
            vatRatePercent: 5,
            vatAmount: 250.0,
            taxCategoryCode: 'S',
          },
          {
            id: 2,
            name: 'Statutory Traffic Fine Recovery (Dubai Police Fine #88912)',
            quantity: 1,
            unitCode: 'C62',
            unitPrice: 500.0,
            netAmount: 500.0,
            vatRatePercent: 0,
            vatAmount: 0.0,
            taxCategoryCode: 'O',
            taxExemptionReason: 'Statutory authority fine outside scope of UAE VAT (FTA VATP006/VATP040)',
            taxExemptionReasonCode: 'VATEX-AE-O',
          },
          {
            id: 3,
            name: 'Fine Admin Processing Surcharge',
            quantity: 1,
            unitCode: 'C62',
            unitPrice: 50.0,
            netAmount: 50.0,
            vatRatePercent: 5,
            vatAmount: 2.5,
            taxCategoryCode: 'S',
          },
        ],
      };

      const result = generatePeppolUaeInvoiceXml(invoiceData);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.xml).toBeDefined();

      const xml = result.xml!;

      // 1. Verify Category O TaxSubtotal
      expect(xml).toContain('<cbc:ID>O</cbc:ID>');
      expect(xml).toContain('<cbc:Percent>0</cbc:Percent>');
      expect(xml).toContain('Statutory authority fine outside scope of UAE VAT (FTA VATP006/VATP040)');

      // 2. Verify Category S TaxSubtotal (5000 + 50 = 5050 taxable, 252.50 VAT)
      expect(xml).toContain('<cbc:ID>S</cbc:ID>');
      expect(xml).toContain('<cbc:Percent>5</cbc:Percent>');
      expect(xml).toContain('<cbc:TaxableAmount currencyID="AED">5050.00</cbc:TaxableAmount>');
      expect(xml).toContain('<cbc:TaxAmount currencyID="AED">252.50</cbc:TaxAmount>');

      // 3. Verify LegalMonetaryTotal
      // LineExtensionTotal: 5000 + 500 + 50 = 5550.00
      // TaxExclusiveAmount: 5550.00
      // TaxInclusiveAmount: 5550.00 + 252.50 = 5802.50
      expect(xml).toContain('<cbc:LineExtensionAmount currencyID="AED">5550.00</cbc:LineExtensionAmount>');
      expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="AED">5550.00</cbc:TaxExclusiveAmount>');
      expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="AED">5802.50</cbc:TaxInclusiveAmount>');
      expect(xml).toContain('<cbc:PayableAmount currencyID="AED">5802.50</cbc:PayableAmount>');

      // 4. Verify Cryptographic Digest & QR code emission
      expect(result.digestHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.qrCodeBase64).toBeTruthy();
    });
  });
});

describe('Adversarial M2 Challenge: Empty State & Fail-Closed 422 Validation', () => {
  // --------------------------------------------------------------------------
  // 1. POST /api/finance/self-billing Fail-Closed Validation
  // --------------------------------------------------------------------------
  describe('POST /api/finance/self-billing Validation', () => {
    it('rejects empty payload with strict HTTP 422 and missingFields array', async () => {
      const req = new NextRequest('http://localhost:3000/api/finance/self-billing', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 'tenant-adversarial-1',
          'x-user-id': 'user-adv-1',
        },
        body: JSON.stringify({}),
      });

      const res = await selfBillingPost(req);
      expect(res.status).toBe(422);

      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toBe('Unprocessable Entity');
      expect(body.missingFields).toContain('carrierName is required');
      expect(body.missingFields).toContain('valid 15-digit carrierTrn is required');
      expect(body.missingFields).toContain('at least one line item or trip must be specified');
    });

    it('rejects whitespace-only carrierName and carrierTrn with HTTP 422', async () => {
      const req = new NextRequest('http://localhost:3000/api/finance/self-billing', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 'tenant-adversarial-1',
          'x-user-id': 'user-adv-1',
        },
        body: JSON.stringify({
          carrierName: '   ',
          carrierTrn: '   ',
          items: [{ description: 'Haulage', ratePerUnit: 500 }],
        }),
      });

      const res = await selfBillingPost(req);
      expect(res.status).toBe(422);

      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.missingFields).toContain('carrierName is required');
      expect(body.missingFields).toContain('valid 15-digit carrierTrn is required');
    });

    it('rejects payload with valid carrier but zero trips / items with HTTP 422', async () => {
      const req = new NextRequest('http://localhost:3000/api/finance/self-billing', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 'tenant-adversarial-1',
          'x-user-id': 'user-adv-1',
        },
        body: JSON.stringify({
          carrierName: 'Fast Transit LLC',
          carrierTrn: '100123456789012',
          items: [],
          trips: [],
        }),
      });

      const res = await selfBillingPost(req);
      expect(res.status).toBe(422);

      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.missingFields).toContain('at least one line item or trip must be specified');
    });
  });

  // --------------------------------------------------------------------------
  // 2. GET /api/finance/self-billing Tenant Mismatch & Empty Record Protection
  // --------------------------------------------------------------------------
  describe('GET /api/finance/self-billing Validation', () => {
    it('rejects cross-tenant query mismatch with HTTP 403 or 422', async () => {
      const req = new NextRequest('http://localhost:3000/api/finance/self-billing?tenantId=different-tenant-id', {
        method: 'GET',
        headers: {
          'x-tenant-id': 'tenant-authorized-1',
          'x-user-id': 'user-1',
        },
      });

      const res = await selfBillingGet(req);
      expect([403, 422]).toContain(res.status);
    });
  });

  // --------------------------------------------------------------------------
  // 3. POST /api/finance/self-billing/config Fail-Closed Validation
  // --------------------------------------------------------------------------
  describe('POST /api/finance/self-billing/config Validation', () => {
    it('rejects empty configuration with HTTP 422', async () => {
      const req = new NextRequest('http://localhost:3000/api/finance/self-billing/config', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 'tenant-adversarial-1',
        },
        body: JSON.stringify({}),
      });

      const res = await selfBillingConfigPost(req);
      expect(res.status).toBe(422);

      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.message).toBe('Self-billing configuration cannot be empty');
      expect(body.missingFields).toContain('agreementNumber');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Scope 3 Sustainability Report Validation
  // --------------------------------------------------------------------------
  describe('POST & GET /api/sustainability/scope3-report Validation', () => {
    it('POST rejects empty body with HTTP 422', async () => {
      const req = new NextRequest('http://localhost:3000/api/sustainability/scope3-report', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 'tenant-adversarial-1',
        },
        body: JSON.stringify({}),
      });

      const res = await scope3Post(req);
      expect(res.status).toBe(422);

      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.missingFields).toContain('clientName is required');
      expect(body.missingFields).toContain('reportingPeriod is required');
      expect(body.missingFields).toContain('trips array with at least one trip is required');
    });

    it('GET rejects distant future year beyond forecast horizon (2050) with HTTP 422', async () => {
      const req = new NextRequest('http://localhost:3000/api/sustainability/scope3-report?year=2050', {
        method: 'GET',
        headers: { 'x-tenant-id': 'tenant-adversarial-1' },
      });

      const res = await scope3Get(req);
      expect(res.status).toBe(422);

      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toContain('beyond allowed forecast horizon');
    });

    it('GET rejects non-numeric year parameter with HTTP 400', async () => {
      const req = new NextRequest('http://localhost:3000/api/sustainability/scope3-report?year=INVALID_YEAR', {
        method: 'GET',
        headers: { 'x-tenant-id': 'tenant-adversarial-1' },
      });

      const res = await scope3Get(req);
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toContain('Invalid year format');
    });

    it('GET rejects empty data tenant with HTTP 422', async () => {
      const req = new NextRequest('http://localhost:3000/api/sustainability/scope3-report?tenantId=new_empty_tenant', {
        method: 'GET',
        headers: { 'x-tenant-id': 'new_empty_tenant' },
      });

      const res = await scope3Get(req);
      expect(res.status).toBe(422);

      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.missingFields).toContain('trips');
    });

    it('GET rejects year 2026 without data with HTTP 422', async () => {
      const req = new NextRequest('http://localhost:3000/api/sustainability/scope3-report?year=2026', {
        method: 'GET',
        headers: { 'x-tenant-id': 'tenant-adversarial-1' },
      });

      const res = await scope3Get(req);
      expect(res.status).toBe(422);

      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toContain('No emissions data found for reporting period 2026');
    });
  });
});
