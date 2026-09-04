import { describe, it, expect } from 'vitest';
import {
  detectMaintenanceAnomalies,
  detectFuelAnomalies,
  detectVendorInvoiceAnomalies,
  detectPartnerSettlementAnomalies,
  detectDriverExpenseAnomalies,
  detectTripTollAnomalies,
  detectContractAnomalies,
  detectProcurementAnomalies,
  MaintenanceRecord,
  FuelLogRecord,
  VendorInvoiceRecord,
  PartnerSettlementRecord,
  DriverExpenseRecord,
  TripTollRecord,
  ContractAuditRecord,
  ProcurementRecord,
} from '../../src/lib/agents/finance-anomaly/detectors';

describe('Finance Anomaly Agent — 8-Stream AI Control Layer v2.0.0', () => {

  describe('1. Maintenance & Garage Overbilling Detection', () => {
    it('detects parts price inflation exceeding OEM catalog baseline', () => {
      const records: MaintenanceRecord[] = [{
        id: 'M-1',
        vehicleId: 'V-1',
        vehicleCode: 'BUS-101',
        workOrderId: 'WO-991',
        garageName: 'Al Quoz Auto Works',
        partName: 'Heavy Duty Brake Pads',
        invoicedPartPrice: 650.0,
        catalogBaselinePrice: 320.0, // +103% inflation
        invoicedLaborHours: 2.0,
        standardLaborHours: 2.0,
        laborRatePerHour: 120.0,
        serviceDate: '2026-09-01',
      }];

      const flags = detectMaintenanceAnomalies(records);
      expect(flags.length).toBe(1);
      expect(flags[0].detectorId).toBe('maintenance-parts-inflation');
      expect(flags[0].severity).toBe('CRITICAL');
      expect(flags[0].financialExposureAed).toBe(330.0);
      expect(flags[0].expectedValue).toContain('AED 320.00');
      expect(flags[0].recommendedAction?.actionType).toBe('HOLD_PAYMENT');
    });

    it('detects repeat repairs within 60-day warranty window', () => {
      const records: MaintenanceRecord[] = [
        {
          id: 'M-10',
          vehicleId: 'V-5',
          vehicleCode: 'BUS-55',
          workOrderId: 'WO-101',
          garageName: 'Speedy Garage',
          partName: 'Alternator Assembly',
          invoicedPartPrice: 1200.0,
          catalogBaselinePrice: 1200.0,
          invoicedLaborHours: 3.0,
          standardLaborHours: 3.0,
          laborRatePerHour: 120.0,
          serviceDate: '2026-08-10',
          warrantyDays: 60,
        },
        {
          id: 'M-11',
          vehicleId: 'V-5',
          vehicleCode: 'BUS-55',
          workOrderId: 'WO-144',
          garageName: 'Speedy Garage',
          partName: 'Alternator Assembly',
          invoicedPartPrice: 1250.0,
          catalogBaselinePrice: 1200.0,
          invoicedLaborHours: 3.0,
          standardLaborHours: 3.0,
          laborRatePerHour: 120.0,
          serviceDate: '2026-08-28', // 18 days later
          warrantyDays: 60,
        },
      ];

      const flags = detectMaintenanceAnomalies(records);
      const warrantyFlag = flags.find(f => f.detectorId === 'maintenance-repeat-repair-warranty');
      expect(warrantyFlag).toBeDefined();
      expect(warrantyFlag?.severity).toBe('CRITICAL');
      expect(warrantyFlag?.explanation).toContain('within the 60-day warranty window');
      expect(warrantyFlag?.recommendedAction?.actionType).toBe('CLAIM_WARRANTY');
    });

    it('detects labor hour overruns exceeding Standard Repair Times (SRT)', () => {
      const records: MaintenanceRecord[] = [{
        id: 'M-20',
        vehicleId: 'V-9',
        vehicleCode: 'VAN-09',
        workOrderId: 'WO-808',
        garageName: 'Central Workshop',
        partName: 'Oil & Filter Change',
        invoicedPartPrice: 200.0,
        catalogBaselinePrice: 200.0,
        invoicedLaborHours: 4.5, // Standard is 1.0 hr
        standardLaborHours: 1.0,
        laborRatePerHour: 120.0,
        serviceDate: '2026-09-02',
      }];

      const flags = detectMaintenanceAnomalies(records);
      const srtFlag = flags.find(f => f.detectorId === 'maintenance-labor-srt-overrun');
      expect(srtFlag).toBeDefined();
      expect(srtFlag?.financialExposureAed).toBe(420.0); // 3.5 hrs * 120
      expect(srtFlag?.recommendedAction?.actionType).toBe('FLAG_DISPUTE');
    });
  });

  describe('2. Fuel Security & Fraud Detection', () => {
    it('detects fuel fill-up exceeding physical tank capacity', () => {
      const logs: FuelLogRecord[] = [{
        id: 'FL-1',
        vehicleId: 'V-10',
        vehicleCode: 'SEDAN-12',
        fuelCardNumber: 'FC-9944',
        fuelGrade: 'SPECIAL_95',
        liters: 94.5, // Tank capacity is 55L
        totalCost: 286.33,
        tankCapacityLiters: 55,
        fuelDate: '2026-09-03T10:00:00Z',
      }];

      const flags = detectFuelAnomalies(logs);
      const overfillFlag = flags.find(f => f.detectorId === 'fuel-tank-overfill');
      expect(overfillFlag).toBeDefined();
      expect(overfillFlag?.severity).toBe('CRITICAL');
      expect(overfillFlag?.explanation).toContain('exceeds physical tank capacity (55L)');
      expect(overfillFlag?.financialExposureAed).toBeGreaterThan(100);
      expect(overfillFlag?.recommendedAction?.actionType).toBe('HOLD_PAYMENT');
    });

    it('detects fuel card GPS location vs vehicle telematics mismatch', () => {
      const logs: FuelLogRecord[] = [{
        id: 'FL-2',
        vehicleId: 'V-11',
        vehicleCode: 'BUS-88',
        fuelCardNumber: 'FC-1122',
        fuelGrade: 'DIESEL',
        liters: 120.0,
        totalCost: 370.80,
        tankCapacityLiters: 160,
        fuelDate: '2026-09-03T12:00:00Z',
        stationName: 'ENOC Jebel Ali',
        stationLat: 24.9850,
        stationLng: 55.0820,
        vehicleLatAtTime: 25.2500, // ~35 km away in Deira
        vehicleLngAtTime: 55.3300,
      }];

      const flags = detectFuelAnomalies(logs);
      const gpsFlag = flags.find(f => f.detectorId === 'fuel-gps-mismatch');
      expect(gpsFlag).toBeDefined();
      expect(gpsFlag?.severity).toBe('CRITICAL');
      expect(gpsFlag?.confidence).toBeGreaterThanOrEqual(0.95);
      expect(gpsFlag?.financialExposureAed).toBe(370.80);
      expect(gpsFlag?.likelyCause).toContain('cloned or detached');
    });

    it('detects rapid consecutive fill-ups within 4 hours', () => {
      const logs: FuelLogRecord[] = [
        {
          id: 'FL-10',
          vehicleId: 'V-12',
          vehicleCode: 'VAN-44',
          fuelCardNumber: 'FC-8800',
          liters: 70.0,
          totalCost: 212.0,
          tankCapacityLiters: 80,
          fuelDate: '2026-09-03T08:00:00Z',
        },
        {
          id: 'FL-11',
          vehicleId: 'V-12',
          vehicleCode: 'VAN-44',
          fuelCardNumber: 'FC-8800',
          liters: 65.0,
          totalCost: 196.95,
          tankCapacityLiters: 80,
          fuelDate: '2026-09-03T09:30:00Z', // 1.5 hours later
        },
      ];

      const flags = detectFuelAnomalies(logs);
      const rapidFlag = flags.find(f => f.detectorId === 'fuel-rapid-consecutive');
      expect(rapidFlag).toBeDefined();
      expect(rapidFlag?.severity).toBe('HIGH');
      expect(rapidFlag?.explanation).toContain('1.5 hours after previous fill-up');
    });
  });

  describe('3. Vendor Invoices & UAE VAT Compliance', () => {
    it('detects UAE 5% VAT calculation discrepancies', () => {
      const invoices: VendorInvoiceRecord[] = [{
        id: 'INV-1',
        invoiceNumber: 'INV-2026-88',
        vendorName: 'Gulf Fleet Spares LLC',
        vendorTrn: '100234567800003',
        invoiceDate: '2026-09-01',
        subtotal: 10000.0,
        vatAmount: 850.0, // Expected 5% = 500.0 (Diff: 350.0)
        totalAmount: 10850.0,
        category: 'PARTS',
        currency: 'AED',
      }];

      const flags = detectVendorInvoiceAnomalies(invoices);
      const vatFlag = flags.find(f => f.detectorId === 'vendor-vat-compliance');
      expect(vatFlag).toBeDefined();
      expect(vatFlag?.severity).toBe('CRITICAL');
      expect(vatFlag?.financialExposureAed).toBe(350.0);
      expect(vatFlag?.expectedValue).toContain('AED 500.00 (5% UAE FTA VAT)');
      expect(vatFlag?.recommendedAction?.actionType).toBe('HOLD_PAYMENT');
    });

    it('flags missing 15-digit FTA TRN on large taxable invoices (> AED 10k)', () => {
      const invoices: VendorInvoiceRecord[] = [{
        id: 'INV-2',
        invoiceNumber: 'INV-2026-99',
        vendorName: 'Unregistered Vendor',
        vendorTrn: null, // Missing TRN
        invoiceDate: '2026-09-02',
        subtotal: 25000.0,
        vatAmount: 1250.0,
        totalAmount: 26250.0,
        category: 'SERVICES',
        currency: 'AED',
      }];

      const flags = detectVendorInvoiceAnomalies(invoices);
      const trnFlag = flags.find(f => f.detectorId === 'vendor-vat-compliance' && f.explanation.includes('TRN'));
      expect(trnFlag).toBeDefined();
      expect(trnFlag?.severity).toBe('HIGH');
      expect(trnFlag?.likelyCause).toContain('Unregistered vendor claiming tax');
    });

    it('detects contract rate card breaches', () => {
      const invoices: VendorInvoiceRecord[] = [{
        id: 'INV-3',
        invoiceNumber: 'INV-2026-101',
        vendorName: 'Towing Services Dubai',
        invoiceDate: '2026-09-02',
        subtotal: 4500.0,
        agreedRateCardAmount: 3000.0, // +50% over rate card
        vatAmount: 225.0,
        totalAmount: 4725.0,
        category: 'TOWING',
        currency: 'AED',
      }];

      const flags = detectVendorInvoiceAnomalies(invoices);
      const rateFlag = flags.find(f => f.detectorId === 'vendor-rate-card-breach');
      expect(rateFlag).toBeDefined();
      expect(rateFlag?.financialExposureAed).toBe(1500.0);
      expect(rateFlag?.recommendedAction?.actionType).toBe('HOLD_PAYMENT');
    });
  });

  describe('4. Partner Settlements & Spot Exchange', () => {
    it('detects spot exchange invoice exceeding agreed quotation', () => {
      const settlements: PartnerSettlementRecord[] = [{
        id: 'PS-1',
        partnerId: 'P-99',
        partnerName: 'Desert Logistics Partners',
        tripId: 'TRIP-440',
        agreedQuoteAmount: 1200.0,
        invoicedSettlementAmount: 1650.0, // +37.5% overrun
        hasTelematicsProof: true,
        completionDate: '2026-09-01',
      }];

      const flags = detectPartnerSettlementAnomalies(settlements);
      expect(flags.length).toBe(1);
      expect(flags[0].detectorId).toBe('partner-quote-divergence');
      expect(flags[0].financialExposureAed).toBe(450.0);
      expect(flags[0].expectedValue).toContain('AED 1200.00 (Agreed Quote)');
    });

    it('detects ghost trip billing without verified telematics ePOD', () => {
      const settlements: PartnerSettlementRecord[] = [{
        id: 'PS-2',
        partnerId: 'P-99',
        partnerName: 'Desert Logistics Partners',
        tripId: 'TRIP-999',
        agreedQuoteAmount: 2200.0,
        invoicedSettlementAmount: 2200.0,
        hasTelematicsProof: false, // No telematics trace
        completionDate: '2026-09-02',
      }];

      const flags = detectPartnerSettlementAnomalies(settlements);
      const ghostFlag = flags.find(f => f.detectorId === 'partner-ghost-trip');
      expect(ghostFlag).toBeDefined();
      expect(ghostFlag?.severity).toBe('CRITICAL');
      expect(ghostFlag?.financialExposureAed).toBe(2200.0);
    });
  });

  describe('5. Driver Expense Claims', () => {
    it('detects inflated mileage reimbursement claims vs telematics distance', () => {
      const expenses: DriverExpenseRecord[] = [{
        id: 'EXP-1',
        driverId: 'D-102',
        driverName: 'Rashid Khan',
        expenseDate: '2026-09-02',
        category: 'MILEAGE',
        claimedAmount: 480.0,
        claimedDistanceKm: 320, // Claimed 320 km
        telematicsDistanceKm: 180, // Verified telematics was only 180 km
        currency: 'AED',
      }];

      const flags = detectDriverExpenseAnomalies(expenses);
      expect(flags.length).toBe(1);
      expect(flags[0].detectorId).toBe('driver-mileage-inflated');
      expect(flags[0].financialExposureAed).toBe(210.0);
      expect(flags[0].recommendedAction?.actionType).toBe('AUTO_DEDUCT_DRIVER');
    });
  });

  describe('6. Trip Costs & Unbilled Road Tolls', () => {
    it('detects unbilled Salik road tolls during customer rental agreements', () => {
      const tolls: TripTollRecord[] = [{
        id: 'TOLL-1',
        rentalAgreementId: 'RA-2026-88',
        vehicleId: 'V-10',
        vehicleCode: 'SEDAN-04',
        tollGateName: 'Al Barsha Salik',
        tollAmount: 4.0,
        timestamp: '2026-09-02T14:30:00Z',
        isBilledToCustomer: false,
        isDeductedFromDriver: false,
        responsibleParty: 'CUSTOMER',
      }];

      const flags = detectTripTollAnomalies(tolls);
      expect(flags.length).toBe(1);
      expect(flags[0].detectorId).toBe('trip-unbilled-salik-tolls');
      expect(flags[0].financialExposureAed).toBe(4.0);
      expect(flags[0].recommendedAction?.actionType).toBe('INVOICE_CUSTOMER');
    });
  });

  describe('7. Contract & Revenue Leakage', () => {
    it('detects unbilled excess mileage on closed rental contracts', () => {
      const contracts: ContractAuditRecord[] = [{
        id: 'RA-100',
        contractNumber: 'RA-2026-100',
        vehicleId: 'V-15',
        vehicleCode: 'SUV-15',
        customerId: 'C-88',
        customerName: 'Emirates Aviation Services',
        contractStatus: 'CLOSED',
        allowedMonthlyKm: 3000,
        startOdometer: 10000,
        checkInOdometer: 14800, // 4,800 km driven (+1,800 km excess)
        excessKmRateAed: 0.50,
        excessKmBilled: false, // Omitted from invoice
        damageNoted: false,
        damageBilled: false,
      }];

      const flags = detectContractAnomalies(contracts);
      const excessFlag = flags.find(f => f.detectorId === 'contract-unbilled-excess-mileage');
      expect(excessFlag).toBeDefined();
      expect(excessFlag?.financialExposureAed).toBe(900.0); // 1800 km * 0.50
      expect(excessFlag?.recommendedAction?.actionType).toBe('INVOICE_CUSTOMER');
    });

    it('detects off-contract odometer movement (ghost utilization)', () => {
      const contracts: ContractAuditRecord[] = [{
        id: 'RA-101',
        contractNumber: 'RA-2026-101',
        vehicleId: 'V-20',
        vehicleCode: 'BUS-20',
        customerId: 'C-10',
        customerName: 'Dubai Schools Corp',
        contractStatus: 'EXPIRED',
        allowedMonthlyKm: 3000,
        startOdometer: 50000,
        checkInOdometer: 53000,
        excessKmRateAed: 0.45,
        excessKmBilled: true,
        damageNoted: false,
        damageBilled: false,
        currentTelematicsOdometer: 53650, // +650 km driven after contract expired
      }];

      const flags = detectContractAnomalies(contracts);
      const ghostFlag = flags.find(f => f.detectorId === 'contract-off-contract-mileage');
      expect(ghostFlag).toBeDefined();
      expect(ghostFlag?.severity).toBe('CRITICAL');
      expect(ghostFlag?.financialExposureAed).toBe(975.0); // 650 km * 1.5
    });

    it('detects unbilled return inspection damages', () => {
      const contracts: ContractAuditRecord[] = [{
        id: 'RA-102',
        contractNumber: 'RA-2026-102',
        vehicleId: 'V-22',
        vehicleCode: 'SEDAN-22',
        customerId: 'C-15',
        customerName: 'Corporate Rental Ltd',
        contractStatus: 'CLOSED',
        allowedMonthlyKm: 3000,
        startOdometer: 10000,
        checkInOdometer: 12000,
        excessKmRateAed: 0.45,
        excessKmBilled: true,
        damageNoted: true,
        damageAmountEstimated: 1450.0,
        damageBilled: false, // Damage not invoiced
      }];

      const flags = detectContractAnomalies(contracts);
      const damageFlag = flags.find(f => f.detectorId === 'contract-unbilled-damage');
      expect(damageFlag).toBeDefined();
      expect(damageFlag?.financialExposureAed).toBe(1450.0);
      expect(damageFlag?.recommendedAction?.actionType).toBe('INVOICE_CUSTOMER');
    });
  });

  describe('8. Procurement & Purchase Order Variances', () => {
    it('detects invoice exceeding authorized purchase order amount', () => {
      const pos: ProcurementRecord[] = [{
        id: 'PO-1',
        poNumber: 'PO-2026-550',
        vendorName: 'Bridgestone Fleet Tires',
        itemName: 'Commercial Bus Tires (Set of 6)',
        authorizedPoAmount: 7200.0,
        invoicedAmount: 9400.0, // +30.5% over PO
        poDate: '2026-08-15',
        invoiceDate: '2026-09-01',
      }];

      const flags = detectProcurementAnomalies(pos);
      expect(flags.length).toBe(1);
      expect(flags[0].detectorId).toBe('procurement-po-variance');
      expect(flags[0].financialExposureAed).toBe(2200.0);
      expect(flags[0].recommendedAction?.actionType).toBe('HOLD_PAYMENT');
    });
  });
});
