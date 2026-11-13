import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import {
  formatCanonicalFuelDisplay,
  normalizeFuelToPct,
  pctToEighths,
  resolveInputFuelPct,
  resolveStoredFuelPct,
  resolveStoredOdometerKm,
} from '@/lib/rental/fuel-odometer';
import { nextRentalSerial, withRentalLock } from '@/lib/rental/locks';
import { withContractAndVehicleLock } from '@/lib/leasing/contract-lock';
import { calculateRate } from '@/lib/rental-rate-engine';
import {
  RAC_GL_ACCOUNTS,
  buildRacInvoiceCreditBuckets,
  classifyRacLineCreditAccount,
  recordRacSecurityDepositCollected,
  resolveSettlementGlAccount,
} from '@/lib/finance/rac-gl-posting';
import { decodeFtaTlvQrBase64, generateFtaTlvQrBase64 } from '@/lib/finance/fta-qr';
import {
  generatePeppolUaeInvoiceXml,
  type PeppolInvoiceData,
} from '@/lib/finance/peppol-e-invoice';
import { buildPeppolWorkbook } from '@/lib/finance/peppol-xlsx';
import { matchFineWithShiftRecords } from '@/lib/fleet/fine-toll-matcher';
import type { TxClient } from '@/lib/rls';

describe('Section 4.1 — Canonical Fuel (0–100%) & Dual-Column Odometer Standardization', () => {
  it('normalizes fractions, labels, eighths, and percentages into canonical 0–100%', () => {
    expect(normalizeFuelToPct('FULL')).toBe(100);
    expect(normalizeFuelToPct('HALF')).toBe(50);
    expect(normalizeFuelToPct('EMPTY')).toBe(0);
    expect(normalizeFuelToPct('6/8')).toBe(75);
    expect(normalizeFuelToPct('3/4')).toBe(75);
    expect(normalizeFuelToPct('62%')).toBe(62);
    expect(normalizeFuelToPct(6, { unit: 'EIGHTHS' })).toBe(75);
    expect(normalizeFuelToPct(8, { unit: 'PCT' })).toBe(8);
  });

  it('disambiguates explicit 8% fuel from legacy 8/8 full tank on API inputs', () => {
    expect(resolveInputFuelPct({ pickupFuelLevel: 8 }, 'pickup', 'EIGHTHS')).toBe(8);
    expect(resolveInputFuelPct({ fuelOut: 8, fuelUnit: 'PCT' }, 'pickup', 'EIGHTHS')).toBe(8);
    expect(resolveInputFuelPct({ fuelOutEighths: 8 }, 'pickup', 'PCT')).toBe(100);
    expect(resolveInputFuelPct({ fuelIn: 6 }, 'return', 'EIGHTHS')).toBe(75);
    expect(resolveInputFuelPct({ returnFuelPct: 37 }, 'return', 'EIGHTHS')).toBe(37);
  });

  it('resolves stored dual columns without misreading canonical 8% or printing "75/8"', () => {
    // Canonical column present -> preserved verbatim even when <= 8
    expect(resolveStoredFuelPct(8, 1)).toBe(8);
    // Legacy row with null canonical pct column and fuel_out = 8 (eighths) -> upgraded to 100%
    expect(resolveStoredFuelPct(null, 8)).toBe(100);
    expect(resolveStoredFuelPct(null, 6)).toBe(75);
    expect(pctToEighths(75)).toBe(6);
    expect(formatCanonicalFuelDisplay(75, { pctColumn: 75 })).toBe('75% (6/8)');
    expect(formatCanonicalFuelDisplay(null, { pctColumn: 100 })).toBe('100% (8/8)');

    expect(resolveStoredOdometerKm(null, 45210)).toBe(45210);
    expect(resolveStoredOdometerKm(45390, 45210)).toBe(45390);
  });
});

describe('Section 4.2 — Cross-Module Advisory Locks & Canonical MAX+1 Serials', () => {
  it('acquires shared fleet-vehicle advisory locks in sorted vehicle order across RAC and Leasing', async () => {
    const racLocks: string[] = [];
    const leaseLocks: string[] = [];

    const makeMockTx = (sink: string[]) =>
      ({
        $executeRawUnsafe: vi.fn(async (_sql: string, key: string) => {
          sink.push(key);
          return 1;
        }),
      }) as unknown as TxClient;

    await withRentalLock(
      makeMockTx(racLocks),
      'tenant-1',
      { entityKey: 'agr-99', vehicleIds: ['veh-z', 'veh-a', 'veh-z'] },
      async () => 'ok',
    );

    await withContractAndVehicleLock(
      makeMockTx(leaseLocks),
      'tenant-1',
      { contractId: 'lc-42', vehicleIds: ['veh-z', 'veh-a'] },
      async () => 'ok',
    );

    expect(racLocks).toEqual([
      'rac-entity:tenant-1:agr-99',
      'fleet-vehicle:tenant-1:veh-a',
      'rac-vehicle:tenant-1:veh-a',
      'fleet-vehicle:tenant-1:veh-z',
      'rac-vehicle:tenant-1:veh-z',
    ]);

    expect(leaseLocks).toEqual([
      'lease-contract:tenant-1:lc-42',
      'fleet-vehicle:tenant-1:veh-a',
      'lease-vehicle:tenant-1:veh-a',
      'fleet-vehicle:tenant-1:veh-z',
      'lease-vehicle:tenant-1:veh-z',
    ]);
  });

  it('generates collision-free MAX+1 serials under rac-serial advisory lock even after row gaps', async () => {
    const executedSql: Array<{ sql: string; params: unknown[] }> = [];
    const mockTx = {
      $executeRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
        executedSql.push({ sql, params });
        return 1;
      }),
      $queryRawUnsafe: vi.fn(async () => [{ max_seq: 41n }]),
    } as unknown as TxClient;

    const nextNo = await nextRentalSerial(mockTx, {
      tenantId: 'tenant-uae',
      series: 'RINV',
      prefix: 'RINV-',
      table: 'rental_invoices',
      column: 'invoice_no',
    });

    expect(nextNo).toBe('RINV-000042');
    expect(
      executedSql.some(
        (c) =>
          c.sql.includes('pg_advisory_xact_lock') &&
          c.params[0] === 'rac-serial:tenant-uae:RINV',
      ),
    ).toBe(true);
  });
});

describe('Section 4.1 — Unified Master Rate & Yield Engine (1 Price List)', () => {
  it('applies proportional UAE Fri/Sat weekend uplift, RateEvent flatSurcharge, and fleet-gated utilization surge', () => {
    // 2026-11-12 is Thursday; 2-day rental covers Thu (weekday) + Fri (UAE weekend) -> 1/2 weekend day
    const pickupDate = new Date('2026-11-12T09:00:00Z');
    const dropoffDate = new Date('2026-11-14T09:00:00Z');

    const quoteSmallFleet = calculateRate(
      [
        {
          id: 'rule-suv',
          name: 'Standard SUV Tariff',
          vehicleCategory: 'SUV',
          baseDailyRate: 200,
          weekendDailyRate: 240, // +20% on weekend days -> +10% blended over 2 days (AED 220/day)
          isActive: true,
        },
      ],
      {
        vehicleCategory: 'SUV',
        pickupDate,
        dropoffDate,
        rateEvents: [
          {
            eventCode: 'F1-ABUDHABI',
            name: 'Abu Dhabi Grand Prix',
            multiplier: 1.1, // 220 * 1.1 = 242/day -> 484 base
            flatSurcharge: 50, // + AED 50 flat event fee
          },
        ],
        fleetUtilizationPct: 95,
        totalCategoryFleet: 3, // < 5 vehicles -> utilization surge must NOT fire
      },
    );

    expect(quoteSmallFleet.totalDays).toBe(2);
    expect(quoteSmallFleet.dailyRate).toBeCloseTo(242, 2);
    expect(quoteSmallFleet.baseRentalCharge).toBeCloseTo(534, 2);
    expect(
      quoteSmallFleet.breakdown.find((b) => b.type === 'EVENT_SURCHARGE')?.amount,
    ).toBeCloseTo(50, 2);
    expect(quoteSmallFleet.subtotal).toBeCloseTo(534, 2);
    expect(quoteSmallFleet.taxAmount).toBeCloseTo(26.7, 2);
    expect(quoteSmallFleet.totalAmount).toBeCloseTo(560.7, 2);

    // Same 95% utilization on a category with >= 5 vehicles triggers +18% surge
    const quoteLargeFleet = calculateRate(
      [
        {
          id: 'rule-suv',
          name: 'Standard SUV Tariff',
          vehicle_category: 'SUV',
          base_daily_rate: '200',
          weekend_daily_rate: '240',
          is_active: true,
        },
      ],
      {
        vehicleCategory: 'SUV',
        pickupDate,
        dropoffDate,
        fleetUtilizationPct: 95,
        totalCategoryFleet: 10,
      },
    );

    // 220 * 1.18 = 259.60/day
    expect(quoteLargeFleet.dailyRate).toBeCloseTo(259.6, 2);
    expect(quoteLargeFleet.yieldTrace?.some((l) => l.layer === 'UTILIZATION')).toBe(true);
  });
});

describe('Section 4.3 — Double-Entry RAC General Ledger, Statutory Clearing & Deposit Accounting', () => {
  it('routes weekly rentals, CDW insurance, statutory traffic fines, and admin surcharges to exact CoA leaves with balanced credits', () => {
    const lines = [
      { lineType: 'RENTAL', description: '8-Day SUV Rental', amount: 1600, quantity: 8, unitLabel: 'day', taxable: true },
      { lineType: 'INSURANCE', description: 'Super CDW Waiver', amount: 240, taxable: true },
      { lineType: 'FINE', description: 'Dubai Police Fine #9912 (Statutory Pass-Through)', amount: 400, taxable: false },
      { lineType: 'ADMIN_FEE', description: 'Traffic Fine Admin Surcharge', amount: 40, taxable: true },
    ];

    expect(classifyRacLineCreditAccount(lines[0], 8).code).toBe('4120');
    expect(classifyRacLineCreditAccount(lines[1], 8).code).toBe('4130');
    expect(classifyRacLineCreditAccount(lines[2], 8).code).toBe('2160');
    expect(classifyRacLineCreditAccount(lines[3], 8).code).toBe('4140');

    // Commercial discount of AED 100 reduces taxable base from (1600+240+40=1880) to 1780;
    // VAT = 5% of 1780 = 89.00; statutory fine = 400 (0% VAT); total = 1780 + 400 + 89 = 2269.00
    const buckets = buildRacInvoiceCreditBuckets({
      subtotal: 2280,
      discountAmount: 100,
      taxAmount: 89,
      totalAmount: 2269,
      lines,
      rentalDaysHint: 8,
    });

    const sumCredits = Number(buckets.reduce((s, b) => s + b.amount, 0).toFixed(2));
    expect(Number((sumCredits + 89).toFixed(2))).toBe(2269);

    // Statutory fine clearing (2160) must remain intact at 400.00 (never eroded by commercial discount)
    const clearingBucket = buckets.find((b) => b.code === RAC_GL_ACCOUNTS.FINES_CLEARING.code);
    expect(clearingBucket?.amount).toBe(400);
  });

  it('maps deposit deductions to 2150 and keeps uncaptured card PREAUTH holds off-balance-sheet', async () => {
    expect(resolveSettlementGlAccount('CASH').code).toBe('1110');
    expect(resolveSettlementGlAccount('CARD').code).toBe('1120');
    expect(resolveSettlementGlAccount('PDC').code).toBe('1160');
    expect(resolveSettlementGlAccount('DEPOSIT_DEDUCTION').code).toBe('2150');

    const neverCalledTx = {
      $executeRawUnsafe: vi.fn(),
      $queryRawUnsafe: vi.fn(),
    } as unknown as TxClient;

    const preauthHoldRes = await recordRacSecurityDepositCollected(neverCalledTx, {
      tenantId: 'tenant-1',
      agreementId: 'agr-1',
      agreementNo: 'RA-000001',
      customerName: 'Al Futtaim Logistics',
      amount: 1500,
      collectionMethod: 'PREAUTH',
    });

    expect(preauthHoldRes).toEqual({ depositId: null, journalId: null });
    expect(neverCalledTx.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('Section 4.3 — UAE FTA TLV QR Code & PEPPOL PINT AE (380/381, S + O, BG-20 Discount)', () => {
  it('encodes and decodes UAE FTA Tags 1–5 TLV Base64 QR payloads losslessly', () => {
    const qrBase64 = generateFtaTlvQrBase64({
      sellerName: 'Fleet360 Rent A Car LLC',
      sellerTrn: '100234567890003',
      timestamp: '2026-11-11T14:30:00Z',
      totalWithVat: 2269,
      vatTotal: 89,
    });

    const decoded = decodeFtaTlvQrBase64(qrBase64);
    expect(decoded.sellerName).toBe('Fleet360 Rent A Car LLC');
    expect(decoded.sellerTrn).toBe('100234567890003');
    expect(decoded.timestamp).toBe('2026-11-11T14:30:00Z');
    expect(decoded.totalWithVat).toBe('2269.00');
    expect(decoded.vatTotal).toBe('89.00');
  });

  it('maintains exact mathematical parity between PINT AE UBL 2.1 XML and XLSX for mixed S (5%) + O (0% statutory fine) + BG-20 discount', () => {
    const sampleInvoice: PeppolInvoiceData = {
      invoiceNumber: 'RINV-000105',
      issueDate: '2026-11-11',
      invoiceTypeCode: '380',
      currency: 'AED',
      discountAmount: 100,
      discountReason: 'Corporate Loyalty Discount',
      discountTaxCategoryCode: 'S',
      discountVatRatePercent: 5,
      referenceContractNo: 'RA-000088',
      seller: {
        name: 'Fleet360 Rent A Car LLC',
        trn: '100234567890003',
        address: {
          street: 'Sheikh Zayed Road',
          city: 'Dubai',
          state: 'AE-DU',
          countryCode: 'AE',
        },
      },
      buyer: {
        name: 'Emirates Corporate Mobility LLC',
        trn: '100987654320003',
        address: {
          street: 'Al Maryah Island',
          city: 'Abu Dhabi',
          state: 'AE-AZ',
          countryCode: 'AE',
        },
      },
      lines: [
        {
          id: 1,
          name: 'Rental Tariff — SUV (8 Days)',
          quantity: 8,
          unitCode: 'DAY',
          unitPrice: 200,
          netAmount: 1600,
          vatRatePercent: 5,
          vatAmount: 80,
          taxCategoryCode: 'S',
        },
        {
          id: 2,
          name: 'Statutory Traffic Fine Pass-Through (FTA VATP006)',
          quantity: 1,
          unitCode: 'C62',
          unitPrice: 400,
          netAmount: 400,
          vatRatePercent: 0,
          vatAmount: 0,
          taxCategoryCode: 'O',
          taxExemptionReasonCode: 'VATEX-AE-O',
          taxExemptionReason: 'Statutory authority fine outside scope of UAE VAT (FTA VATP006)',
        },
        {
          id: 3,
          name: 'Traffic Fine Admin Handling Fee',
          quantity: 1,
          unitCode: 'C62',
          unitPrice: 40,
          netAmount: 40,
          vatRatePercent: 5,
          vatAmount: 2,
          taxCategoryCode: 'S',
        },
      ],
    };

    // Line sum = 2040; Discount = 100 (applied to S group: 1640 - 100 = 1540 -> 5% VAT = 77.00);
    // O group = 400 (0% VAT); TaxExclusive = 1940.00; TaxInclusive = 2017.00
    const xmlResult = generatePeppolUaeInvoiceXml(sampleInvoice);
    expect(xmlResult.isValid).toBe(true);
    expect(xmlResult.xml).toContain('<cbc:LineExtensionAmount currencyID="AED">2040.00</cbc:LineExtensionAmount>');
    expect(xmlResult.xml).toContain('<cbc:TaxExclusiveAmount currencyID="AED">1940.00</cbc:TaxExclusiveAmount>');
    expect(xmlResult.xml).toContain('<cbc:TaxAmount currencyID="AED">77.00</cbc:TaxAmount>');
    expect(xmlResult.xml).toContain('<cbc:PayableAmount currencyID="AED">2017.00</cbc:PayableAmount>');
    expect(xmlResult.xml).toContain('<cbc:ID>O</cbc:ID>');

    const wbBuffer = buildPeppolWorkbook(sampleInvoice, xmlResult);
    const wb = XLSX.read(wbBuffer, { type: 'buffer' });
    const headerRows = XLSX.utils.sheet_to_json<Array<string | number>>(wb.Sheets[wb.SheetNames[0]], {
      header: 1,
    });
    const findMetric = (label: string) => headerRows.find((r) => r[0] === label)?.[1];

    expect(findMetric('Tax exclusive amount')).toBe(1940);
    expect(findMetric('VAT amount')).toBe(77);
    expect(findMetric('Payable amount')).toBe(2017);

    // Also verify UAE Art. 61 Credit Note (381) emits BillingReference to parent Tax Invoice
    const creditNoteXml = generatePeppolUaeInvoiceXml({
      ...sampleInvoice,
      invoiceNumber: 'RCN-000009',
      invoiceTypeCode: '381',
      discountAmount: 0,
      billingReference: { invoiceNumber: 'RINV-000105', issueDate: '2026-11-11' },
      lines: [
        {
          id: 1,
          name: 'Partial Rental Rate Adjustment',
          quantity: 1,
          unitCode: 'DAY',
          unitPrice: 200,
          netAmount: 200,
          vatRatePercent: 5,
          vatAmount: 10,
          taxCategoryCode: 'S',
        },
      ],
    });
    expect(creditNoteXml.isValid).toBe(true);
    expect(creditNoteXml.xml).toContain('<cbc:InvoiceTypeCode listID="UNCL1001">381</cbc:InvoiceTypeCode>');
    expect(creditNoteXml.xml).toContain('<cac:BillingReference>');
    expect(creditNoteXml.xml).toContain('<cbc:ID>RINV-000105</cbc:ID>');
  });
});

describe('Section 4.3 — Self-Drive RAC Traffic Fine & Toll Matcher', () => {
  it('assigns driving violations during active RAC RentalAgreements to RENTAL_CUSTOMER while keeping vehicle defects on COMPANY', () => {
    const agreements = [
      {
        id: 'agr-selfdrive-1',
        agreementNo: 'RA-000512',
        customerId: 'cust-77',
        customerName: 'Noor Al Mansoori',
        vehicleId: 'veh-rac-9',
        startDate: '2026-11-10T08:00:00Z',
        endDate: '2026-11-15T08:00:00Z',
        status: 'ACTIVE',
      },
    ];

    const speedingMatch = matchFineWithShiftRecords(
      {
        id: 'fine-1',
        vehicleId: 'veh-rac-9',
        fineDate: '2026-11-11T11:20:00Z',
        fineAmount: 600,
        offenceType: 'EXCEEDING_MAXIMUM_SPEED_LIMIT',
        authority: 'RTA_DUBAI',
      },
      [],
      [],
      agreements,
    );

    expect(speedingMatch.assignedTo).toBe('RENTAL_CUSTOMER');
    expect(speedingMatch.matchSource).toBe('RENTAL_AGREEMENT');
    expect(speedingMatch.rentalAgreementId).toBe('agr-selfdrive-1');
    expect(speedingMatch.agreementNo).toBe('RA-000512');

    const defectMatch = matchFineWithShiftRecords(
      {
        id: 'fine-2',
        vehicleId: 'veh-rac-9',
        fineDate: '2026-11-11T12:00:00Z',
        fineAmount: 500,
        offenceType: 'EXPIRED_REGISTRATION',
        authority: 'RTA_DUBAI',
      },
      [],
      [],
      agreements,
    );

    expect(defectMatch.assignedTo).toBe('COMPANY');
    expect(defectMatch.matchSource).toBe('COMPANY_DEFECT_OFFENCE');
  });
});
