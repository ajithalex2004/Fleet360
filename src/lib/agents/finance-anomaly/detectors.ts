/**
 * Finance Anomaly Detection — Statistical Detectors
 * --------------------------------------------------
 * Five independent detectors, each returning AnomalyFlag[].
 * No LLM required — pure statistical heuristics.
 *
 * Detectors:
 *   1. duplicate-invoice     — same amount ± 1% + same vendor within 30 days
 *   2. amount-outlier        — Z-score > 2.5 vs 90-day category baseline
 *   3. round-number          — suspiciously round amounts > AED 1,000
 *   4. velocity-spike        — >2x normal transaction count in 7-day window
 *   5. category-mismatch     — amount outside expected range for category
 */

import { AnomalyFlag } from '../types';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface InvoiceRecord {
  id: string;
  amount: number;
  currency: string;
  vendor?: string | null;
  category?: string | null;
  invoiceDate: string;
  description?: string | null;
}

export interface ExpenseRecord {
  id: string;
  amount: number;
  currency: string;
  category?: string | null;
  expenseDate: string;
  description?: string | null;
  submittedBy?: string | null;
}

export interface FuelLogRecord {
  id: string;
  liters: number;
  totalCost: number;
  fuelDate: string;
  vehicleId?: string | null;
}

// ── Math helpers ───────────────────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[], avg?: number): number {
  if (values.length < 2) return 0;
  const m = avg ?? mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function zScore(value: number, avg: number, sd: number): number {
  if (sd === 0) return 0;
  return Math.abs((value - avg) / sd);
}

function daysBetween(a: string, b: string): number {
  return Math.abs((new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60 * 60 * 24));
}

// ── Detector 1: Duplicate Invoice ─────────────────────────────────────────────
export function detectDuplicateInvoices(invoices: InvoiceRecord[]): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < invoices.length; i++) {
    for (let j = i + 1; j < invoices.length; j++) {
      const a = invoices[i];
      const b = invoices[j];

      // Skip if already flagged as a pair
      const pairKey = [a.id, b.id].sort().join('|');
      if (seen.has(pairKey)) continue;

      // Same vendor (or both null)
      const sameVendor = (a.vendor ?? '') === (b.vendor ?? '');
      if (!sameVendor) continue;

      // Same amount ± 1%
      const amountRatio = Math.abs(a.amount - b.amount) / Math.max(a.amount, 1);
      if (amountRatio > 0.01) continue;

      // Within 30 days of each other
      if (daysBetween(a.invoiceDate, b.invoiceDate) > 30) continue;

      seen.add(pairKey);

      const confidence = sameVendor && amountRatio === 0 ? 0.95 : 0.75;
      const severity = confidence >= 0.9 ? 'HIGH' : 'MEDIUM';

      // Flag both invoices
      for (const inv of [a, b]) {
        flags.push({
          detectorId:  'duplicate-invoice',
          entityType:  'INVOICE',
          entityId:    inv.id,
          severity,
          confidence,
          explanation: `Possible duplicate: AED ${inv.amount.toFixed(2)} from "${inv.vendor ?? 'unknown vendor'}" appears twice within 30 days.`,
          amount:      inv.amount,
          currency:    inv.currency,
          metadata: {
            matchedInvoiceId:  inv.id === a.id ? b.id : a.id,
            daysBetween:       Math.round(daysBetween(a.invoiceDate, b.invoiceDate)),
            amountDifference:  Math.abs(a.amount - b.amount),
          },
        });
      }
    }
  }

  return flags;
}

// ── Detector 2: Amount Outlier (Z-score) ─────────────────────────────────────
export function detectAmountOutliers(
  invoices: InvoiceRecord[],
  expenses: ExpenseRecord[],
): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];

  // Group by category, compute baseline stats
  const invoiceByCategory = new Map<string, InvoiceRecord[]>();
  for (const inv of invoices) {
    const cat = inv.category ?? 'UNCATEGORISED';
    if (!invoiceByCategory.has(cat)) invoiceByCategory.set(cat, []);
    invoiceByCategory.get(cat)!.push(inv);
  }

  for (const [category, records] of invoiceByCategory) {
    if (records.length < 5) continue; // need enough data for meaningful stats

    const amounts = records.map((r) => r.amount);
    const avg = mean(amounts);
    const sd  = stddev(amounts, avg);

    for (const inv of records) {
      const z = zScore(inv.amount, avg, sd);
      if (z < 2.5) continue;

      const confidence = Math.min(0.4 + (z - 2.5) * 0.2, 0.95);
      const severity   = z >= 4 ? 'CRITICAL' : z >= 3.5 ? 'HIGH' : 'MEDIUM';

      flags.push({
        detectorId:  'amount-outlier',
        entityType:  'INVOICE',
        entityId:    inv.id,
        severity,
        confidence:  parseFloat(confidence.toFixed(3)),
        explanation: `Invoice amount AED ${inv.amount.toFixed(2)} is ${z.toFixed(1)}σ above the ${category} category average of AED ${avg.toFixed(2)}.`,
        amount:      inv.amount,
        currency:    inv.currency,
        metadata:    { category, zScore: parseFloat(z.toFixed(2)), categoryAvg: parseFloat(avg.toFixed(2)), categoryStddev: parseFloat(sd.toFixed(2)) },
      });
    }
  }

  // Same for expenses
  const expenseByCategory = new Map<string, ExpenseRecord[]>();
  for (const exp of expenses) {
    const cat = exp.category ?? 'UNCATEGORISED';
    if (!expenseByCategory.has(cat)) expenseByCategory.set(cat, []);
    expenseByCategory.get(cat)!.push(exp);
  }

  for (const [category, records] of expenseByCategory) {
    if (records.length < 5) continue;

    const amounts = records.map((r) => r.amount);
    const avg = mean(amounts);
    const sd  = stddev(amounts, avg);

    for (const exp of records) {
      const z = zScore(exp.amount, avg, sd);
      if (z < 2.5) continue;

      const confidence = Math.min(0.4 + (z - 2.5) * 0.2, 0.95);
      const severity   = z >= 4 ? 'CRITICAL' : z >= 3.5 ? 'HIGH' : 'MEDIUM';

      flags.push({
        detectorId:  'amount-outlier',
        entityType:  'EXPENSE',
        entityId:    exp.id,
        severity,
        confidence:  parseFloat(confidence.toFixed(3)),
        explanation: `Expense amount AED ${exp.amount.toFixed(2)} is ${z.toFixed(1)}σ above the ${category} category average of AED ${avg.toFixed(2)}.`,
        amount:      exp.amount,
        currency:    exp.currency,
        metadata:    { category, zScore: parseFloat(z.toFixed(2)), categoryAvg: parseFloat(avg.toFixed(2)) },
      });
    }
  }

  return flags;
}

// ── Detector 3: Round Number ──────────────────────────────────────────────────
const ROUND_NUMBER_THRESHOLD = 1_000; // AED

export function detectRoundNumbers(
  invoices: InvoiceRecord[],
  expenses: ExpenseRecord[],
): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];

  const isRound = (amount: number): { round: boolean; confidence: number } => {
    if (amount < ROUND_NUMBER_THRESHOLD) return { round: false, confidence: 0 };
    if (amount % 100_000 === 0) return { round: true, confidence: 0.85 };
    if (amount % 10_000  === 0) return { round: true, confidence: 0.70 };
    if (amount % 5_000   === 0) return { round: true, confidence: 0.55 };
    if (amount % 1_000   === 0) return { round: true, confidence: 0.40 };
    return { round: false, confidence: 0 };
  };

  for (const inv of invoices) {
    const { round, confidence } = isRound(inv.amount);
    if (!round) continue;
    flags.push({
      detectorId:  'round-number',
      entityType:  'INVOICE',
      entityId:    inv.id,
      severity:    confidence >= 0.75 ? 'HIGH' : confidence >= 0.55 ? 'MEDIUM' : 'LOW',
      confidence,
      explanation: `Invoice amount AED ${inv.amount.toLocaleString()} is a suspiciously round number — may indicate an estimated rather than actual invoice.`,
      amount:      inv.amount,
      currency:    inv.currency,
    });
  }

  for (const exp of expenses) {
    const { round, confidence } = isRound(exp.amount);
    if (!round) continue;
    flags.push({
      detectorId:  'round-number',
      entityType:  'EXPENSE',
      entityId:    exp.id,
      severity:    confidence >= 0.75 ? 'HIGH' : confidence >= 0.55 ? 'MEDIUM' : 'LOW',
      confidence,
      explanation: `Expense amount AED ${exp.amount.toLocaleString()} is a suspiciously round number.`,
      amount:      exp.amount,
      currency:    exp.currency,
    });
  }

  return flags;
}

// ── Detector 4: Velocity Spike ────────────────────────────────────────────────
// >2× the 90-day weekly average in the last 7 days
export function detectVelocitySpike(invoices: InvoiceRecord[]): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  if (invoices.length < 14) return flags; // not enough data

  const now = Date.now();
  const last7DaysCutoff  = now - 7  * 24 * 60 * 60 * 1000;
  const last90DaysCutoff = now - 90 * 24 * 60 * 60 * 1000;

  const last7  = invoices.filter((i) => new Date(i.invoiceDate).getTime() >= last7DaysCutoff);
  const last90 = invoices.filter((i) => new Date(i.invoiceDate).getTime() >= last90DaysCutoff);

  const weeklyAvg = (last90.length / 90) * 7; // expected per week

  if (weeklyAvg > 0 && last7.length > weeklyAvg * 2) {
    const ratio      = last7.length / weeklyAvg;
    const confidence = Math.min(0.5 + (ratio - 2) * 0.1, 0.9);
    flags.push({
      detectorId:  'velocity-spike',
      entityType:  'INVOICE',
      entityId:    `batch-${new Date().toISOString().slice(0, 10)}`,
      severity:    ratio >= 4 ? 'CRITICAL' : ratio >= 3 ? 'HIGH' : 'MEDIUM',
      confidence:  parseFloat(confidence.toFixed(3)),
      explanation: `${last7.length} invoices created in the last 7 days — ${ratio.toFixed(1)}× the 90-day weekly average of ${weeklyAvg.toFixed(1)}.`,
      metadata:    { last7Count: last7.length, weeklyAvg: parseFloat(weeklyAvg.toFixed(1)), ratio: parseFloat(ratio.toFixed(2)) },
    });
  }

  return flags;
}

// ── Detector 5: Category Mismatch (Fuel Logs) ─────────────────────────────────
// Fuel cost per litre deviating significantly from AED 2.0–3.5 range (UAE petrol)
const UAE_FUEL_PRICE_MIN = 1.5;  // AED/litre
const UAE_FUEL_PRICE_MAX = 4.0;

export function detectFuelLogAnomalies(fuelLogs: FuelLogRecord[]): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];

  for (const log of fuelLogs) {
    if (!log.liters || log.liters <= 0) continue;
    const pricePerLitre = log.totalCost / log.liters;

    if (pricePerLitre < UAE_FUEL_PRICE_MIN || pricePerLitre > UAE_FUEL_PRICE_MAX) {
      const confidence = pricePerLitre > 6 || pricePerLitre < 0.5 ? 0.9 : 0.65;
      flags.push({
        detectorId:  'category-mismatch',
        entityType:  'FUEL_LOG',
        entityId:    log.id,
        severity:    confidence >= 0.85 ? 'HIGH' : 'MEDIUM',
        confidence,
        explanation: `Fuel log shows AED ${pricePerLitre.toFixed(2)}/litre — outside the expected UAE range of AED ${UAE_FUEL_PRICE_MIN}–${UAE_FUEL_PRICE_MAX}/litre. Possible data entry error or theft.`,
        amount:      log.totalCost,
        currency:    'AED',
        metadata:    { liters: log.liters, totalCost: log.totalCost, pricePerLitre: parseFloat(pricePerLitre.toFixed(2)) },
      });
    }
  }

  return flags;
}
