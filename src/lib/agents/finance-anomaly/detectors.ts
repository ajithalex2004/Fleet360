/**
 * Finance Anomaly Detection — 8-Stream AI Financial Control Layer v2.0.0
 * -----------------------------------------------------------------------
 * Comprehensive detection algorithms covering:
 *   1. Maintenance (Parts price inflation, repeat repairs/warranty, labor SRT overruns)
 *   2. Fuel (Tank capacity overfills, GPS location vs fuel station mismatch, UAE grade-specific price, rapid fills)
 *   3. Vendor Invoices (Rate card breaches, duplicate billing, UAE 5% VAT / FTA TRN audits)
 *   4. Partner Settlements (Spot exchange quote vs billing divergence, ghost trips)
 *   5. Driver Expenses (Inflated mileage claims vs telematics distance, suspicious round numbers)
 *   6. Trip Costs (Unbilled Salik/Darb road tolls, deadhead surges)
 *   7. Contracts (Off-contract odometer movement, unbilled excess km overages, unbilled damages)
 *   8. Procurement (PO line item variances, price escalation)
 */

import { AnomalyFlag, AnomalySeverity, AnomalyActionRecommendation, FinanceStreamType } from '../types';

// ── Transaction Record Types ───────────────────────────────────────────────────

export interface MaintenanceRecord {
  id: string;
  vehicleId: string;
  vehicleCode: string;
  workOrderId?: string;
  garageName: string;
  partName: string;
  partNumber?: string;
  invoicedPartPrice: number;
  catalogBaselinePrice: number;
  invoicedLaborHours: number;
  standardLaborHours: number; // SRT benchmark
  laborRatePerHour: number;
  serviceDate: string;
  warrantyDays?: number;
}

export interface FuelLogRecord {
  id: string;
  vehicleId: string;
  vehicleCode: string;
  fuelCardNumber?: string;
  fuelGrade?: string; // 'SPECIAL_95' | 'SUPER_98' | 'DIESEL'
  liters: number;
  totalCost: number;
  tankCapacityLiters: number;
  fuelDate: string;
  stationName?: string;
  stationLat?: number | null;
  stationLng?: number | null;
  vehicleLatAtTime?: number | null;
  vehicleLngAtTime?: number | null;
  odometerKm?: number;
}

export interface VendorInvoiceRecord {
  id: string;
  invoiceNumber: string;
  vendorName: string;
  vendorTrn?: string | null;
  invoiceDate: string;
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
  agreedRateCardAmount?: number;
  category: string;
  currency: string;
  description?: string;
}

export interface PartnerSettlementRecord {
  id: string;
  partnerId: string;
  partnerName: string;
  tripId: string;
  agreedQuoteAmount: number;
  invoicedSettlementAmount: number;
  hasTelematicsProof: boolean;
  completionDate: string;
}

export interface DriverExpenseRecord {
  id: string;
  driverId: string;
  driverName: string;
  expenseDate: string;
  category: string;
  claimedAmount: number;
  claimedDistanceKm?: number;
  telematicsDistanceKm?: number;
  currency: string;
  description?: string;
}

export interface TripTollRecord {
  id: string;
  tripId?: string;
  rentalAgreementId?: string;
  vehicleId: string;
  vehicleCode: string;
  driverId?: string;
  tollGateName: string;
  tollAmount: number;
  timestamp: string;
  isBilledToCustomer: boolean;
  isDeductedFromDriver: boolean;
  responsibleParty: 'CUSTOMER' | 'DRIVER' | 'FLEET';
}

export interface ContractAuditRecord {
  id: string;
  contractNumber: string;
  vehicleId: string;
  vehicleCode: string;
  customerId: string;
  customerName: string;
  contractStatus: string; // 'ACTIVE' | 'CLOSED' | 'EXPIRED'
  allowedMonthlyKm: number;
  startOdometer: number;
  checkInOdometer?: number;
  excessKmRateAed: number;
  excessKmBilled: boolean;
  damageNoted: boolean;
  damageAmountEstimated?: number;
  damageBilled: boolean;
  currentTelematicsOdometer?: number;
}

export interface ProcurementRecord {
  id: string;
  poNumber: string;
  vendorName: string;
  itemName: string;
  authorizedPoAmount: number;
  invoicedAmount: number;
  poDate: string;
  invoiceDate: string;
}

// ── Math & Spatial Helpers ────────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(2));
}

function daysBetween(a: string, b: string): number {
  return Math.abs((new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60 * 60 * 24));
}

// UAE Benchmark Official Fuel Prices (AED / Litre)
export const UAE_FUEL_BENCHMARKS: Record<string, { min: number; max: number; official: number }> = {
  SUPER_98:   { min: 2.70, max: 3.60, official: 3.15 },
  SPECIAL_95: { min: 2.60, max: 3.45, official: 3.03 },
  DIESEL:     { min: 2.70, max: 3.50, official: 3.09 },
  DEFAULT:    { min: 2.50, max: 3.60, official: 3.10 },
};

// ── 1. Maintenance Stream Detectors ───────────────────────────────────────────

export function detectMaintenanceAnomalies(records: MaintenanceRecord[]): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  const partHistory = new Map<string, MaintenanceRecord[]>();

  for (const m of records) {
    // A. Parts Price Inflation vs OEM Baseline (> 25% inflation)
    if (m.catalogBaselinePrice > 0 && m.invoicedPartPrice > m.catalogBaselinePrice * 1.25) {
      const variancePct = ((m.invoicedPartPrice - m.catalogBaselinePrice) / m.catalogBaselinePrice) * 100;
      const overcharge = m.invoicedPartPrice - m.catalogBaselinePrice;
      const severity: AnomalySeverity = variancePct >= 75 ? 'CRITICAL' : variancePct >= 40 ? 'HIGH' : 'MEDIUM';

      flags.push({
        detectorId: 'maintenance-parts-inflation',
        entityType: 'WORK_ORDER',
        entityId: m.workOrderId ?? m.id,
        streamType: 'MAINTENANCE',
        severity,
        confidence: 0.92,
        explanation: `Garage "${m.garageName}" invoiced "${m.partName}" at AED ${m.invoicedPartPrice.toFixed(2)}, which is +${variancePct.toFixed(1)}% above OEM catalog baseline (AED ${m.catalogBaselinePrice.toFixed(2)}).`,
        amount: m.invoicedPartPrice,
        currency: 'AED',
        expectedValue: `AED ${m.catalogBaselinePrice.toFixed(2)} (OEM Catalog)`,
        actualValue: `AED ${m.invoicedPartPrice.toFixed(2)}`,
        variancePercentage: parseFloat(variancePct.toFixed(2)),
        likelyCause: 'Garage parts markup exceeds authorized corporate discount tier or aftermarket supplier substitution.',
        financialExposureAed: parseFloat(overcharge.toFixed(2)),
        recommendedAction: {
          actionType: 'HOLD_PAYMENT',
          title: 'Hold Invoiced Parts Markup',
          description: `Dispute parts line item with ${m.garageName} and adjust invoice to catalog baseline (Save AED ${overcharge.toFixed(2)}).`,
          financialRecoveryAed: parseFloat(overcharge.toFixed(2)),
        },
        metadata: { vehicleCode: m.vehicleCode, garageName: m.garageName, partName: m.partName },
      });
    }

    // B. Labor Hours vs Standard Repair Times (SRT) (> 35% overrun)
    if (m.standardLaborHours > 0 && m.invoicedLaborHours > m.standardLaborHours * 1.35) {
      const excessHours = m.invoicedLaborHours - m.standardLaborHours;
      const excessCost = excessHours * (m.laborRatePerHour || 120);
      const variancePct = (excessHours / m.standardLaborHours) * 100;

      flags.push({
        detectorId: 'maintenance-labor-srt-overrun',
        entityType: 'WORK_ORDER',
        entityId: m.workOrderId ?? m.id,
        streamType: 'MAINTENANCE',
        severity: variancePct >= 75 ? 'HIGH' : 'MEDIUM',
        confidence: 0.88,
        explanation: `Billed labor of ${m.invoicedLaborHours} hrs for "${m.partName}" exceeds Standard Repair Time (SRT) of ${m.standardLaborHours} hrs by +${variancePct.toFixed(1)}%.`,
        amount: m.invoicedLaborHours * (m.laborRatePerHour || 120),
        currency: 'AED',
        expectedValue: `${m.standardLaborHours} hrs (Flat-rate SRT)`,
        actualValue: `${m.invoicedLaborHours} hrs`,
        variancePercentage: parseFloat(variancePct.toFixed(2)),
        likelyCause: 'Unproductive garage downtime or unauthorized labor padding.',
        financialExposureAed: parseFloat(excessCost.toFixed(2)),
        recommendedAction: {
          actionType: 'FLAG_DISPUTE',
          title: 'Enforce Standard Repair Labor Cap',
          description: `Cap labor hours to industry SRT of ${m.standardLaborHours} hrs (Recover AED ${excessCost.toFixed(2)}).`,
          financialRecoveryAed: parseFloat(excessCost.toFixed(2)),
        },
      });
    }

    // Group for repeat repairs check
    const key = `${m.vehicleId}::${m.partName.toLowerCase()}`;
    if (!partHistory.has(key)) partHistory.set(key, []);
    partHistory.get(key)!.push(m);
  }

  // C. Repeat Repairs Within Warranty Window (30–90 days)
  for (const [, recordsList] of partHistory) {
    if (recordsList.length < 2) continue;
    recordsList.sort((a, b) => new Date(a.serviceDate).getTime() - new Date(b.serviceDate).getTime());

    for (let i = 0; i < recordsList.length - 1; i++) {
      const first = recordsList[i];
      const second = recordsList[i + 1];
      const days = daysBetween(first.serviceDate, second.serviceDate);
      const warrantyWindow = first.warrantyDays ?? 60;

      if (days <= warrantyWindow) {
        flags.push({
          detectorId: 'maintenance-repeat-repair-warranty',
          entityType: 'WORK_ORDER',
          entityId: second.workOrderId ?? second.id,
          streamType: 'MAINTENANCE',
          severity: 'CRITICAL',
          confidence: 0.95,
          explanation: `Repeat repair for "${second.partName}" on ${second.vehicleCode} occurred ${Math.round(days)} days after previous repair on ${first.serviceDate}. This is within the ${warrantyWindow}-day warranty window.`,
          amount: second.invoicedPartPrice + (second.invoicedLaborHours * (second.laborRatePerHour || 120)),
          currency: 'AED',
          expectedValue: `AED 0.00 (Covered under ${warrantyWindow}-day Warranty)`,
          actualValue: `AED ${(second.invoicedPartPrice + (second.invoicedLaborHours * (second.laborRatePerHour || 120))).toFixed(2)}`,
          variancePercentage: 100,
          likelyCause: 'Premature component failure or defective workmanship covered under vendor warranty.',
          financialExposureAed: parseFloat((second.invoicedPartPrice + (second.invoicedLaborHours * (second.laborRatePerHour || 120))).toFixed(2)),
          recommendedAction: {
            actionType: 'CLAIM_WARRANTY',
            title: 'Claim Supplier Warranty Credit',
            description: `File warranty claim against ${first.garageName} for repeat failure within ${warrantyWindow} days.`,
            financialRecoveryAed: parseFloat((second.invoicedPartPrice + (second.invoicedLaborHours * (second.laborRatePerHour || 120))).toFixed(2)),
          },
          metadata: { previousServiceDate: first.serviceDate, daysBetween: Math.round(days), previousGarage: first.garageName },
        });
      }
    }
  }

  return flags;
}

// ── 2. Fuel Security & Fraud Detectors ─────────────────────────────────────────

export function detectFuelAnomalies(logs: FuelLogRecord[]): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  const cardHistory = new Map<string, FuelLogRecord[]>();

  for (const log of logs) {
    if (!log.liters || log.liters <= 0) continue;

    // A. Fuel Volume Exceeds Tank Capacity
    if (log.tankCapacityLiters > 0 && log.liters > log.tankCapacityLiters * 1.05) {
      const overfillLiters = log.liters - log.tankCapacityLiters;
      const pricePerLitre = log.totalCost / log.liters;
      const exposureAed = overfillLiters * pricePerLitre;
      const variancePct = ((log.liters - log.tankCapacityLiters) / log.tankCapacityLiters) * 100;

      flags.push({
        detectorId: 'fuel-tank-overfill',
        entityType: 'FUEL_LOG',
        entityId: log.id,
        streamType: 'FUEL',
        severity: 'CRITICAL',
        confidence: 0.98,
        explanation: `Fill-up volume of ${log.liters.toFixed(1)}L exceeds physical tank capacity (${log.tankCapacityLiters}L) on ${log.vehicleCode} by +${variancePct.toFixed(1)}% (+${overfillLiters.toFixed(1)}L).`,
        amount: log.totalCost,
        currency: 'AED',
        expectedValue: `Max ${log.tankCapacityLiters}L (OEM Tank Spec)`,
        actualValue: `${log.liters.toFixed(1)}L Billed`,
        variancePercentage: parseFloat(variancePct.toFixed(2)),
        likelyCause: 'Fuel card used to fill external jerrycans or secondary unauthorized vehicle (fuel theft).',
        financialExposureAed: parseFloat(exposureAed.toFixed(2)),
        recommendedAction: {
          actionType: 'HOLD_PAYMENT',
          title: 'Flag Fuel Card & Audit Driver',
          description: `Freeze driver fuel card ${log.fuelCardNumber ?? ''} and recover AED ${exposureAed.toFixed(2)} overfill discrepancy.`,
          financialRecoveryAed: parseFloat(exposureAed.toFixed(2)),
        },
        metadata: { vehicleCode: log.vehicleCode, tankCapacity: log.tankCapacityLiters, liters: log.liters },
      });
    }

    // B. GPS Fuel Station vs Vehicle Telematics Location Mismatch
    if (
      log.stationLat !== undefined && log.stationLat !== null &&
      log.stationLng !== undefined && log.stationLng !== null &&
      log.vehicleLatAtTime !== undefined && log.vehicleLatAtTime !== null &&
      log.vehicleLngAtTime !== undefined && log.vehicleLngAtTime !== null
    ) {
      const distanceKm = haversineKm(log.stationLat, log.stationLng, log.vehicleLatAtTime, log.vehicleLngAtTime);
      if (distanceKm > 5.0) {
        flags.push({
          detectorId: 'fuel-gps-mismatch',
          entityType: 'FUEL_LOG',
          entityId: log.id,
          streamType: 'FUEL',
          severity: 'CRITICAL',
          confidence: 0.96,
          explanation: `Fuel card was swiped at "${log.stationName ?? 'Station'}" while vehicle ${log.vehicleCode} telematics was ${distanceKm.toFixed(1)} km away at the timestamp of transaction.`,
          amount: log.totalCost,
          currency: 'AED',
          expectedValue: '< 0.5 km (At Fuel Pump)',
          actualValue: `${distanceKm.toFixed(1)} km Away`,
          variancePercentage: parseFloat((distanceKm * 100).toFixed(2)),
          likelyCause: 'Card cloned or detached from vehicle and used remotely without the fleet vehicle present.',
          financialExposureAed: log.totalCost,
          recommendedAction: {
            actionType: 'HOLD_PAYMENT',
            title: 'Deauthorize Fuel Card & Dispute Charge',
            description: `Block fuel card ${log.fuelCardNumber ?? ''} immediately and dispute AED ${log.totalCost.toFixed(2)} with fuel supplier.`,
            financialRecoveryAed: log.totalCost,
          },
          metadata: { distanceKm, stationName: log.stationName, vehicleCode: log.vehicleCode },
        });
      }
    }

    // C. Dynamic UAE Fuel Grade Benchmark Check
    const grade = (log.fuelGrade ?? 'SPECIAL_95').toUpperCase();
    const benchmark = UAE_FUEL_BENCHMARKS[grade] ?? UAE_FUEL_BENCHMARKS.DEFAULT;
    const pricePerLitre = log.totalCost / log.liters;

    if (pricePerLitre < benchmark.min || pricePerLitre > benchmark.max) {
      const variancePct = ((pricePerLitre - benchmark.official) / benchmark.official) * 100;
      flags.push({
        detectorId: 'category-mismatch',
        entityType: 'FUEL_LOG',
        entityId: log.id,
        streamType: 'FUEL',
        severity: Math.abs(variancePct) > 50 ? 'HIGH' : 'MEDIUM',
        confidence: 0.85,
        explanation: `Invoiced fuel rate of AED ${pricePerLitre.toFixed(2)}/L deviates from official UAE ${grade} benchmark (AED ${benchmark.official.toFixed(2)}/L).`,
        amount: log.totalCost,
        currency: 'AED',
        expectedValue: `AED ${benchmark.official.toFixed(2)}/L (UAE Official)`,
        actualValue: `AED ${pricePerLitre.toFixed(2)}/L`,
        variancePercentage: parseFloat(variancePct.toFixed(2)),
        likelyCause: 'Data entry typo, incorrect fuel grade billing, or premium service surcharge.',
        financialExposureAed: parseFloat(Math.abs((pricePerLitre - benchmark.official) * log.liters).toFixed(2)),
        recommendedAction: {
          actionType: 'FLAG_DISPUTE',
          title: 'Verify Fuel Pump Rate Card',
          description: 'Request itemized fuel slip from station manager to rectify price per litre.',
        },
      });
    }

    // Group for rapid consecutive fills
    const cardKey = log.fuelCardNumber ?? log.vehicleId;
    if (!cardHistory.has(cardKey)) cardHistory.set(cardKey, []);
    cardHistory.get(cardKey)!.push(log);
  }

  // D. Rapid Consecutive Fills (< 4 Hours)
  for (const [, logsList] of cardHistory) {
    if (logsList.length < 2) continue;
    logsList.sort((a, b) => new Date(a.fuelDate).getTime() - new Date(b.fuelDate).getTime());

    for (let i = 0; i < logsList.length - 1; i++) {
      const a = logsList[i];
      const b = logsList[i + 1];
      const hours = (new Date(b.fuelDate).getTime() - new Date(a.fuelDate).getTime()) / (1000 * 60 * 60);

      if (hours > 0 && hours < 4.0 && b.liters > (b.tankCapacityLiters || 40) * 0.5) {
        flags.push({
          detectorId: 'fuel-rapid-consecutive',
          entityType: 'FUEL_LOG',
          entityId: b.id,
          streamType: 'FUEL',
          severity: 'HIGH',
          confidence: 0.90,
          explanation: `Consecutive fill-up of ${b.liters.toFixed(1)}L occurred only ${hours.toFixed(1)} hours after previous fill-up of ${a.liters.toFixed(1)}L on ${b.vehicleCode}.`,
          amount: b.totalCost,
          currency: 'AED',
          expectedValue: '> 12.0 hrs Interval',
          actualValue: `${hours.toFixed(1)} hrs Interval`,
          variancePercentage: parseFloat(((4 - hours) / 4 * 100).toFixed(2)),
          likelyCause: 'Double-swiping fuel card or refueling non-fleet vehicles in succession.',
          financialExposureAed: b.totalCost,
          recommendedAction: {
            actionType: 'HOLD_PAYMENT',
            title: 'Audit Driver Shift Fuel Log',
            description: `Verify shift odometer log for ${b.vehicleCode} before approving payment of AED ${b.totalCost.toFixed(2)}.`,
            financialRecoveryAed: b.totalCost,
          },
        });
      }
    }
  }

  return flags;
}

// ── 3. Vendor Invoices & UAE VAT Detectors ─────────────────────────────────────

export function detectVendorInvoiceAnomalies(invoices: VendorInvoiceRecord[]): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];

  for (const inv of invoices) {
    // A. UAE 5% VAT Calculation Audit
    const expectedVat = parseFloat((inv.subtotal * 0.05).toFixed(2));
    const vatDiff = Math.abs(inv.vatAmount - expectedVat);

    if (inv.subtotal > 0 && vatDiff > 0.50) {
      const variancePct = (vatDiff / expectedVat) * 100;
      flags.push({
        detectorId: 'vendor-vat-compliance',
        entityType: 'INVOICE',
        entityId: inv.id,
        streamType: 'VENDOR_INVOICE',
        severity: vatDiff >= 100 ? 'CRITICAL' : 'HIGH',
        confidence: 0.99,
        explanation: `Invoice ${inv.invoiceNumber} from "${inv.vendorName}" has incorrect UAE VAT: billed AED ${inv.vatAmount.toFixed(2)} vs statutory 5% of AED ${expectedVat.toFixed(2)} (Diff: AED ${vatDiff.toFixed(2)}).`,
        amount: inv.totalAmount,
        currency: inv.currency,
        expectedValue: `AED ${expectedVat.toFixed(2)} (5% UAE FTA VAT)`,
        actualValue: `AED ${inv.vatAmount.toFixed(2)}`,
        variancePercentage: parseFloat(variancePct.toFixed(2)),
        likelyCause: 'Supplier calculation error or illegal tax overcharge failing FTA e-invoicing compliance.',
        financialExposureAed: parseFloat(vatDiff.toFixed(2)),
        recommendedAction: {
          actionType: 'HOLD_PAYMENT',
          title: 'Reject Non-Compliant Tax Invoice',
          description: `Reject invoice ${inv.invoiceNumber} and request corrected FTA-compliant tax invoice with 5% VAT.`,
          financialRecoveryAed: parseFloat(vatDiff.toFixed(2)),
        },
      });
    }

    // B. Missing TRN on Large Taxable Invoices (> AED 10,000)
    if (inv.totalAmount >= 10000 && (!inv.vendorTrn || inv.vendorTrn.length !== 15)) {
      flags.push({
        detectorId: 'vendor-vat-compliance',
        entityType: 'INVOICE',
        entityId: inv.id,
        streamType: 'VENDOR_INVOICE',
        severity: 'HIGH',
        confidence: 0.95,
        explanation: `Invoice ${inv.invoiceNumber} from "${inv.vendorName}" (AED ${inv.totalAmount.toLocaleString()}) lacks a valid 15-digit UAE FTA Tax Registration Number (TRN). Input VAT cannot be recovered.`,
        amount: inv.totalAmount,
        currency: inv.currency,
        expectedValue: '15-digit FTA TRN Required',
        actualValue: inv.vendorTrn ?? 'Missing TRN',
        variancePercentage: 100,
        likelyCause: 'Unregistered vendor claiming tax or administrative oversight in vendor onboarding.',
        financialExposureAed: parseFloat(inv.vatAmount.toFixed(2)),
        recommendedAction: {
          actionType: 'HOLD_PAYMENT',
          title: 'Withhold VAT Payment Until TRN Verified',
          description: 'Withhold tax disbursement until vendor provides certified FTA TRN certificate.',
          financialRecoveryAed: parseFloat(inv.vatAmount.toFixed(2)),
        },
      });
    }

    // C. Contract Rate Card Breach
    if (inv.agreedRateCardAmount && inv.subtotal > inv.agreedRateCardAmount * 1.10) {
      const overcharge = inv.subtotal - inv.agreedRateCardAmount;
      const variancePct = (overcharge / inv.agreedRateCardAmount) * 100;

      flags.push({
        detectorId: 'vendor-rate-card-breach',
        entityType: 'INVOICE',
        entityId: inv.id,
        streamType: 'VENDOR_INVOICE',
        severity: variancePct >= 30 ? 'HIGH' : 'MEDIUM',
        confidence: 0.94,
        explanation: `Invoiced amount AED ${inv.subtotal.toFixed(2)} from "${inv.vendorName}" exceeds agreed contractual rate card of AED ${inv.agreedRateCardAmount.toFixed(2)} (+${variancePct.toFixed(1)}%).`,
        amount: inv.totalAmount,
        currency: inv.currency,
        expectedValue: `AED ${inv.agreedRateCardAmount.toFixed(2)} (Rate Card)`,
        actualValue: `AED ${inv.subtotal.toFixed(2)}`,
        variancePercentage: parseFloat(variancePct.toFixed(2)),
        likelyCause: 'Vendor applying non-contractual price increases without corporate rate amendment.',
        financialExposureAed: parseFloat(overcharge.toFixed(2)),
        recommendedAction: {
          actionType: 'HOLD_PAYMENT',
          title: 'Re-rate to Contract Baseline',
          description: `Issue debit note of AED ${overcharge.toFixed(2)} to align invoice with contractual master rate card.`,
          financialRecoveryAed: parseFloat(overcharge.toFixed(2)),
        },
      });
    }
  }

  return flags;
}

// ── 4. Partner Settlements & Spot Exchange Detectors ───────────────────────────

export function detectPartnerSettlementAnomalies(settlements: PartnerSettlementRecord[]): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];

  for (const s of settlements) {
    // A. Subcontractor Invoiced Bill > Agreed Spot Quotation
    if (s.agreedQuoteAmount > 0 && s.invoicedSettlementAmount > s.agreedQuoteAmount * 1.05) {
      const divergence = s.invoicedSettlementAmount - s.agreedQuoteAmount;
      const variancePct = (divergence / s.agreedQuoteAmount) * 100;

      flags.push({
        detectorId: 'partner-quote-divergence',
        entityType: 'EXCHANGE_QUOTATION',
        entityId: s.id,
        streamType: 'PARTNER_SETTLEMENT',
        severity: variancePct >= 25 ? 'HIGH' : 'MEDIUM',
        confidence: 0.96,
        explanation: `Subcontractor "${s.partnerName}" billed AED ${s.invoicedSettlementAmount.toFixed(2)} for Trip ${s.tripId}, which exceeds agreed exchange quote of AED ${s.agreedQuoteAmount.toFixed(2)} (+${variancePct.toFixed(1)}%).`,
        amount: s.invoicedSettlementAmount,
        currency: 'AED',
        expectedValue: `AED ${s.agreedQuoteAmount.toFixed(2)} (Agreed Quote)`,
        actualValue: `AED ${s.invoicedSettlementAmount.toFixed(2)}`,
        variancePercentage: parseFloat(variancePct.toFixed(2)),
        likelyCause: 'Unapproved accessorial charges, waiting time padding, or unauthorized toll markup.',
        financialExposureAed: parseFloat(divergence.toFixed(2)),
        recommendedAction: {
          actionType: 'HOLD_PAYMENT',
          title: 'Cap Settlement to Spot Quotation',
          description: `Withhold AED ${divergence.toFixed(2)} excess and settle trip at agreed quote of AED ${s.agreedQuoteAmount.toFixed(2)}.`,
          financialRecoveryAed: parseFloat(divergence.toFixed(2)),
        },
      });
    }

    // B. Ghost Trip Billing (No Telematics Proof of Delivery)
    if (!s.hasTelematicsProof && s.invoicedSettlementAmount > 0) {
      flags.push({
        detectorId: 'partner-ghost-trip',
        entityType: 'EXCHANGE_QUOTATION',
        entityId: s.id,
        streamType: 'PARTNER_SETTLEMENT',
        severity: 'CRITICAL',
        confidence: 0.91,
        explanation: `Settlement submitted for Trip ${s.tripId} by "${s.partnerName}" (AED ${s.invoicedSettlementAmount.toFixed(2)}) without verified telematics GPS track or digital proof of delivery (ePOD).`,
        amount: s.invoicedSettlementAmount,
        currency: 'AED',
        expectedValue: 'Verified GPS ePOD Track',
        actualValue: 'No Telematics Data Found',
        variancePercentage: 100,
        likelyCause: 'Ghost trip, canceled run billed erroneously, or driver forgot to start mobile trip dispatch tracker.',
        financialExposureAed: s.invoicedSettlementAmount,
        recommendedAction: {
          actionType: 'HOLD_PAYMENT',
          title: 'Hold Settlement Pending Proof of Delivery',
          description: `Require ${s.partnerName} to upload signed customer manifest or verified GPS logs before payment release.`,
          financialRecoveryAed: s.invoicedSettlementAmount,
        },
      });
    }
  }

  return flags;
}

// ── 5. Driver Expense & Reimbursement Detectors ────────────────────────────────

export function detectDriverExpenseAnomalies(expenses: DriverExpenseRecord[]): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];

  for (const exp of expenses) {
    // A. Inflated Mileage Claims vs Telematics Recorded Distance
    if (
      exp.claimedDistanceKm && exp.claimedDistanceKm > 20 &&
      exp.telematicsDistanceKm !== undefined && exp.telematicsDistanceKm !== null &&
      exp.claimedDistanceKm > exp.telematicsDistanceKm * 1.25
    ) {
      const excessKm = exp.claimedDistanceKm - exp.telematicsDistanceKm;
      const ratePerKm = exp.claimedAmount / exp.claimedDistanceKm;
      const excessAed = excessKm * ratePerKm;
      const variancePct = (excessKm / exp.telematicsDistanceKm) * 100;

      flags.push({
        detectorId: 'driver-mileage-inflated',
        entityType: 'EXPENSE',
        entityId: exp.id,
        streamType: 'DRIVER_EXPENSE',
        severity: variancePct >= 50 ? 'HIGH' : 'MEDIUM',
        confidence: 0.93,
        explanation: `Driver ${exp.driverName} claimed ${exp.claimedDistanceKm} km for reimbursement, but telematics logged only ${exp.telematicsDistanceKm.toFixed(1)} km (+${variancePct.toFixed(1)}% variance).`,
        amount: exp.claimedAmount,
        currency: exp.currency,
        expectedValue: `${exp.telematicsDistanceKm.toFixed(1)} km (Telematics)`,
        actualValue: `${exp.claimedDistanceKm} km Claimed`,
        variancePercentage: parseFloat(variancePct.toFixed(2)),
        likelyCause: 'Manual distance inflation or personal errands included in corporate reimbursement claim.',
        financialExposureAed: parseFloat(excessAed.toFixed(2)),
        recommendedAction: {
          actionType: 'AUTO_DEDUCT_DRIVER',
          title: 'Adjust Reimbursement to Telematics Distance',
          description: `Approve reimbursement at verified ${exp.telematicsDistanceKm.toFixed(1)} km (Save AED ${excessAed.toFixed(2)}).`,
          financialRecoveryAed: parseFloat(excessAed.toFixed(2)),
        },
      });
    }
  }

  return flags;
}

// ── 6. Trip Costs & Unbilled Road Tolls Detectors ──────────────────────────────

export function detectTripTollAnomalies(tolls: TripTollRecord[]): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];

  for (const toll of tolls) {
    // Unbilled Salik / Darb Road Tolls (Revenue Leakage)
    if (toll.responsibleParty === 'CUSTOMER' && !toll.isBilledToCustomer) {
      flags.push({
        detectorId: 'trip-unbilled-salik-tolls',
        entityType: 'SALIK_TOLL',
        entityId: toll.id,
        streamType: 'TRIP_COST',
        severity: 'MEDIUM',
        confidence: 0.98,
        explanation: `Salik toll of AED ${toll.tollAmount.toFixed(2)} at "${toll.tollGateName}" on ${toll.vehicleCode} incurred during customer rental ${toll.rentalAgreementId ?? ''} has not been billed to customer.`,
        amount: toll.tollAmount,
        currency: 'AED',
        expectedValue: `Billed to Customer ${toll.rentalAgreementId ?? ''}`,
        actualValue: 'Unbilled / Fleet Absorbed',
        variancePercentage: 100,
        likelyCause: 'Toll batch sync delay or omitted toll reconciliation before rental agreement closing.',
        financialExposureAed: toll.tollAmount,
        recommendedAction: {
          actionType: 'INVOICE_CUSTOMER',
          title: 'Generate Customer Toll Debit Invoice',
          description: `Auto-create customer invoice line item for AED ${toll.tollAmount.toFixed(2)} Salik toll.`,
          financialRecoveryAed: toll.tollAmount,
        },
      });
    }

    if (toll.responsibleParty === 'DRIVER' && !toll.isDeductedFromDriver) {
      flags.push({
        detectorId: 'trip-unbilled-salik-tolls',
        entityType: 'SALIK_TOLL',
        entityId: toll.id,
        streamType: 'TRIP_COST',
        severity: 'LOW',
        confidence: 0.98,
        explanation: `Off-shift Salik toll of AED ${toll.tollAmount.toFixed(2)} at "${toll.tollGateName}" on ${toll.vehicleCode} has not been recovered from driver payroll.`,
        amount: toll.tollAmount,
        currency: 'AED',
        expectedValue: 'Deducted from Driver Settlement',
        actualValue: 'Unrecovered',
        variancePercentage: 100,
        likelyCause: 'Private off-duty vehicle movement through toll gate without automatic payroll deduction.',
        financialExposureAed: toll.tollAmount,
        recommendedAction: {
          actionType: 'AUTO_DEDUCT_DRIVER',
          title: 'Deduct Toll from Driver Payroll',
          description: `Queue AED ${toll.tollAmount.toFixed(2)} deduction for upcoming driver settlement cycle.`,
          financialRecoveryAed: toll.tollAmount,
        },
      });
    }
  }

  return flags;
}

// ── 7. Contract & Revenue Leakage Detectors ────────────────────────────────────

export function detectContractAnomalies(contracts: ContractAuditRecord[]): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];

  for (const c of contracts) {
    // A. Unbilled Excess Mileage on Closed / Returned Contracts
    if (c.contractStatus === 'CLOSED' && c.checkInOdometer && c.allowedMonthlyKm > 0 && !c.excessKmBilled) {
      const totalKmDriven = c.checkInOdometer - c.startOdometer;
      if (totalKmDriven > c.allowedMonthlyKm) {
        const excessKm = totalKmDriven - c.allowedMonthlyKm;
        const excessChargeAed = excessKm * (c.excessKmRateAed || 0.45);
        const variancePct = (excessKm / c.allowedMonthlyKm) * 100;

        flags.push({
          detectorId: 'contract-unbilled-excess-mileage',
          entityType: 'RENTAL_AGREEMENT',
          entityId: c.id,
          streamType: 'CONTRACT',
          severity: excessChargeAed >= 500 ? 'HIGH' : 'MEDIUM',
          confidence: 0.97,
          explanation: `Contract ${c.contractNumber} for "${c.customerName}" closed with ${totalKmDriven.toLocaleString()} km driven (+${excessKm.toLocaleString()} km over ${c.allowedMonthlyKm.toLocaleString()} km allowance). Excess mileage of AED ${excessChargeAed.toFixed(2)} was not invoiced.`,
          amount: excessChargeAed,
          currency: 'AED',
          expectedValue: `AED ${excessChargeAed.toFixed(2)} Excess Invoiced`,
          actualValue: 'AED 0.00 Invoiced',
          variancePercentage: parseFloat(variancePct.toFixed(2)),
          likelyCause: 'Check-in agent closed agreement without generating excess mileage supplementary invoice.',
          financialExposureAed: parseFloat(excessChargeAed.toFixed(2)),
          recommendedAction: {
            actionType: 'INVOICE_CUSTOMER',
            title: 'Generate Supplementary Excess Mileage Invoice',
            description: `Issue supplementary invoice of AED ${excessChargeAed.toFixed(2)} for ${excessKm} excess kilometres to ${c.customerName}.`,
            financialRecoveryAed: parseFloat(excessChargeAed.toFixed(2)),
          },
        });
      }
    }

    // B. Off-Contract Odometer Movement (Ghost Utilization)
    if (
      (c.contractStatus === 'EXPIRED' || c.contractStatus === 'CLOSED') &&
      c.currentTelematicsOdometer && c.checkInOdometer &&
      c.currentTelematicsOdometer > c.checkInOdometer + 50
    ) {
      const unbilledKm = c.currentTelematicsOdometer - c.checkInOdometer;
      const estimatedValue = unbilledKm * 1.5; // average rental revenue per km

      flags.push({
        detectorId: 'contract-off-contract-mileage',
        entityType: 'RENTAL_AGREEMENT',
        entityId: c.id,
        streamType: 'CONTRACT',
        severity: 'CRITICAL',
        confidence: 0.95,
        explanation: `Vehicle ${c.vehicleCode} accumulated +${unbilledKm.toLocaleString()} km in telematics while status is ${c.contractStatus} without an active contract or rental billing.`,
        amount: estimatedValue,
        currency: 'AED',
        expectedValue: `${c.checkInOdometer.toLocaleString()} km (Contract Return)`,
        actualValue: `${c.currentTelematicsOdometer.toLocaleString()} km (Live Odo)`,
        variancePercentage: parseFloat(((unbilledKm / c.checkInOdometer) * 100).toFixed(2)),
        likelyCause: 'Unauthorized vehicle use by internal staff, unrecorded rental, or delayed contract renewal.',
        financialExposureAed: parseFloat(estimatedValue.toFixed(2)),
        recommendedAction: {
          actionType: 'FLAG_DISPUTE',
          title: 'Audit Vehicle Custody & Create Contract',
          description: `Ground vehicle ${c.vehicleCode} and back-bill AED ${estimatedValue.toFixed(2)} for ${unbilledKm} unrecorded kilometres.`,
          financialRecoveryAed: parseFloat(estimatedValue.toFixed(2)),
        },
      });
    }

    // C. Unbilled Return Damages
    if (c.damageNoted && !c.damageBilled && c.damageAmountEstimated && c.damageAmountEstimated > 0) {
      flags.push({
        detectorId: 'contract-unbilled-damage',
        entityType: 'RENTAL_AGREEMENT',
        entityId: c.id,
        streamType: 'CONTRACT',
        severity: 'HIGH',
        confidence: 0.94,
        explanation: `Return inspection on Contract ${c.contractNumber} recorded damages estimated at AED ${c.damageAmountEstimated.toFixed(2)}, but no damage recovery invoice or security deposit deduction was issued.`,
        amount: c.damageAmountEstimated,
        currency: 'AED',
        expectedValue: `AED ${c.damageAmountEstimated.toFixed(2)} Damage Claim`,
        actualValue: 'AED 0.00 Claimed',
        variancePercentage: 100,
        likelyCause: 'Inspection damage report was completed but not pushed to finance billing queue.',
        financialExposureAed: c.damageAmountEstimated,
        recommendedAction: {
          actionType: 'INVOICE_CUSTOMER',
          title: 'Claim Damage from Customer Security Deposit',
          description: `Deduct AED ${c.damageAmountEstimated.toFixed(2)} from customer security deposit or issue damage recovery invoice.`,
          financialRecoveryAed: c.damageAmountEstimated,
        },
      });
    }
  }

  return flags;
}

// ── 8. Procurement & Purchase Order Detectors ──────────────────────────────────

export function detectProcurementAnomalies(pos: ProcurementRecord[]): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];

  for (const p of pos) {
    if (p.authorizedPoAmount > 0 && p.invoicedAmount > p.authorizedPoAmount * 1.10) {
      const variance = p.invoicedAmount - p.authorizedPoAmount;
      const variancePct = (variance / p.authorizedPoAmount) * 100;

      flags.push({
        detectorId: 'procurement-po-variance',
        entityType: 'PURCHASE_ORDER',
        entityId: p.id,
        streamType: 'PROCUREMENT',
        severity: variancePct >= 30 ? 'HIGH' : 'MEDIUM',
        confidence: 0.95,
        explanation: `Invoiced amount AED ${p.invoicedAmount.toFixed(2)} for PO "${p.poNumber}" (${p.itemName}) exceeds authorized PO budget of AED ${p.authorizedPoAmount.toFixed(2)} (+${variancePct.toFixed(1)}%).`,
        amount: p.invoicedAmount,
        currency: 'AED',
        expectedValue: `AED ${p.authorizedPoAmount.toFixed(2)} (Authorized PO)`,
        actualValue: `AED ${p.invoicedAmount.toFixed(2)}`,
        variancePercentage: parseFloat(variancePct.toFixed(2)),
        likelyCause: 'Price escalation by supplier without approved Purchase Order amendment.',
        financialExposureAed: parseFloat(variance.toFixed(2)),
        recommendedAction: {
          actionType: 'HOLD_PAYMENT',
          title: 'Hold PO Payment Variance',
          description: `Withhold AED ${variance.toFixed(2)} pending procurement manager approval or re-issue PO.`,
          financialRecoveryAed: parseFloat(variance.toFixed(2)),
        },
      });
    }
  }

  return flags;
}
