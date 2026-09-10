/**
 * Forensic Integrity & Deterministic Checksum Validator
 * ------------------------------------------------------
 * Validates official UAE tax and identification credentials:
 *  1. UAE TRN (Tax Registration Number): 15-digit FTA standard
 *  2. UAE Emirates ID: 15-digit (784-YYYY-XXXXXXX-Z) with Modulo-10 checksum
 *  3. Inconsistent Issue / Expiry metadata sanity checks
 */

import { DocumentExtractionResult } from '../../types';

export interface IntegrityCheckResult {
  passed: boolean;
  alerts: string[];
  riskPoints: number;
}

/**
 * Validates a UAE FTA Tax Registration Number (TRN).
 * FTA rules: 15 digits, numeric, begins with '100'.
 */
export function validateUaeTrn(trn?: string): { valid: boolean; reason?: string } {
  if (!trn) return { valid: true }; // Not applicable if absent
  const clean = trn.replace(/[^0-9]/g, '');

  if (clean.length !== 15) {
    return {
      valid: false,
      reason: `UAE TRN must be exactly 15 numeric digits (received ${clean.length} digits: "${trn}").`,
    };
  }

  if (!clean.startsWith('100')) {
    return {
      valid: false,
      reason: `UAE TRN must begin with '100' as per FTA regulations (received: "${clean}").`,
    };
  }

  return { valid: true };
}

/**
 * Validates a UAE Emirates ID number (e.g. 784-1990-1234567-1).
 * Rules:
 *  1. Exactly 15 digits
 *  2. Begins with '784' (UAE ISO numeric country code)
 *  3. Next 4 digits represent a realistic birth year (1900 - current year)
 *  4. Modulo-10 Luhn check on the digit sequence
 */
export function validateEmiratesId(eid?: string): { valid: boolean; reason?: string } {
  if (!eid) return { valid: true };
  const clean = eid.replace(/[^0-9]/g, '');

  if (clean.length !== 15) {
    return {
      valid: false,
      reason: `Emirates ID must be exactly 15 digits in 784-YYYY-XXXXXXX-Z format (received ${clean.length} digits).`,
    };
  }

  if (!clean.startsWith('784')) {
    return {
      valid: false,
      reason: `Emirates ID must start with UAE country code '784' (received: "${clean.slice(0, 3)}").`,
    };
  }

  const birthYear = parseInt(clean.slice(3, 7), 10);
  const currentYear = new Date().getFullYear();
  if (isNaN(birthYear) || birthYear < 1900 || birthYear > currentYear) {
    return {
      valid: false,
      reason: `Invalid birth year in Emirates ID: "${birthYear}". Must be between 1900 and ${currentYear}.`,
    };
  }

  // Modulo-10 (Luhn) Check Digit calculation on the 15-digit sequence
  let sum = 0;
  let alternate = false;
  for (let i = clean.length - 1; i >= 0; i--) {
    let n = parseInt(clean.charAt(i), 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }

  if (sum % 10 !== 0) {
    return {
      valid: false,
      reason: `Emirates ID failed Modulo-10 checksum validation (possible typo or counterfeit number).`,
    };
  }

  return { valid: true };
}

/**
 * Evaluates document integrity indicators and calculates risk penalties.
 */
export function evaluateIntegrityIndicators(extraction: DocumentExtractionResult): IntegrityCheckResult {
  const alerts: string[] = [];
  let riskPoints = 0;

  // 1. Validate Supplier TRN if Tax Invoice or Quotation
  const trn = extraction.supplier?.trnNumber || extraction.supplier?.taxNumber;
  if (trn) {
    const trnResult = validateUaeTrn(trn);
    if (!trnResult.valid && trnResult.reason) {
      alerts.push(`INTEGRITY_ALERT: ${trnResult.reason}`);
      riskPoints += 30;
    }
  }

  // 2. Validate Driver Emirates ID if Driver License
  const eid = extraction.driver?.emiratesId;
  if (eid) {
    const eidResult = validateEmiratesId(eid);
    if (!eidResult.valid && eidResult.reason) {
      alerts.push(`INTEGRITY_ALERT: ${eidResult.reason}`);
      riskPoints += 35;
    }
  }

  // 3. Temporal Sanity Check (Issue Date cannot be in the future, Expiry cannot precede Issue Date)
  if (extraction.issueDate && extraction.expiryDate) {
    const issueTime = new Date(extraction.issueDate).getTime();
    const expiryTime = new Date(extraction.expiryDate).getTime();
    const nowTime = Date.now();

    // 1-day grace buffer for timezone differences
    if (issueTime > nowTime + 86400000) {
      alerts.push(`INTEGRITY_ALERT: Document issue date is in the future (${extraction.issueDate}).`);
      riskPoints += 25;
    }

    if (expiryTime < issueTime) {
      alerts.push(`INTEGRITY_ALERT: Expiry date (${extraction.expiryDate}) precedes issue date (${extraction.issueDate}).`);
      riskPoints += 40;
    }
  }

  return {
    passed: alerts.length === 0,
    alerts,
    riskPoints,
  };
}
