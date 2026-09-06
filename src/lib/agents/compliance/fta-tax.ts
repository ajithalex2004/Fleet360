/**
 * Finance, Salik & FTA Tax Compliance Validator
 * ---------------------------------------------
 * Deterministic validation engine for UAE Federal Tax Authority (FTA) requirements:
 *  1. 15-digit Tax Registration Number (TRN) syntax and prefix validation.
 *  2. Standard UAE 5% VAT mathematical integrity.
 *  3. Salik / Darb toll tag to vehicle plate link reconciliation.
 */

import { FtaInvoiceValidationRequest, FtaInvoiceValidationResult } from '../types';

export const UAE_STANDARD_VAT_RATE = 0.05;

export function validateFtaInvoice(
  request: FtaInvoiceValidationRequest,
): FtaInvoiceValidationResult {
  const flags: string[] = [];
  let financialRiskAed = 0;

  // ── 1. TRN Syntax & Checksum Validation ───────────────────────────────────
  // UAE FTA TRNs must be exactly 15 digits and start with '100'
  const rawTrn = (request.vendorTrn || '').replace(/[\s-]/g, '');
  const isTrnLengthValid = rawTrn.length === 15;
  const isTrnNumeric = /^\d{15}$/.test(rawTrn);
  const isTrnPrefixValid = rawTrn.startsWith('100');

  const trnValid = isTrnLengthValid && isTrnNumeric && isTrnPrefixValid;

  if (!trnValid) {
    flags.push(
      `Invalid FTA TRN: "${request.vendorTrn}". UAE Tax Registration Numbers must be exactly 15 digits and start with "100".`,
    );
    financialRiskAed += request.vatAmount; // Unrecoverable input VAT risk
  }

  const formattedTrn = trnValid
    ? `${rawTrn.slice(0, 3)}-${rawTrn.slice(3, 7)}-${rawTrn.slice(7, 11)}-${rawTrn.slice(11)}`
    : request.vendorTrn;

  // ── 2. VAT 5% Mathematical Calculation Integrity ───────────────────────────
  const expectedVat = parseFloat((request.subtotal * UAE_STANDARD_VAT_RATE).toFixed(2));
  const actualVat = parseFloat(request.vatAmount.toFixed(2));
  const vatDiff = Math.abs(expectedVat - actualVat);

  const vatMathCorrect = vatDiff <= 0.05; // 5 fils tolerance for rounding
  if (!vatMathCorrect) {
    flags.push(
      `VAT Discrepancy: Expected 5% VAT on AED ${request.subtotal.toFixed(2)} is AED ${expectedVat.toFixed(2)}, but invoice states AED ${actualVat.toFixed(2)} (${vatDiff > 0 ? '+' : ''}${(actualVat - expectedVat).toFixed(2)} AED variance).`,
    );
    financialRiskAed += Math.abs(actualVat - expectedVat);
  }

  // Check Total Amount
  const expectedTotal = parseFloat((request.subtotal + actualVat).toFixed(2));
  const actualTotal = parseFloat(request.totalAmount.toFixed(2));
  if (Math.abs(expectedTotal - actualTotal) > 0.05) {
    flags.push(
      `Invoice Total Mismatch: Subtotal (${request.subtotal}) + VAT (${actualVat}) = ${expectedTotal}, but Total is ${actualTotal}.`,
    );
  }

  // ── 3. Salik / Darb Tag Plate Mapping ──────────────────────────────────────
  let salikTagMatched = true;
  if (request.salikTagNumber && !request.vehiclePlateNumber) {
    salikTagMatched = false;
    flags.push(`Unlinked Toll Transaction: Salik tag ${request.salikTagNumber} is not mapped to any registered vehicle plate.`);
    financialRiskAed += 50.0; // Typical unmapped toll processing penalty
  }

  const isValid = trnValid && vatMathCorrect && salikTagMatched;

  // Summary
  let summary = '';
  if (isValid) {
    summary = `Invoice ${request.invoiceNumber} from ${request.vendorName} is fully FTA compliant (TRN: ${formattedTrn}, 5% VAT: AED ${actualVat.toFixed(2)}).`;
  } else {
    summary = `Invoice ${request.invoiceNumber} NON-COMPLIANT: ${flags.join('; ')}`;
  }

  return {
    isValid,
    trnValid,
    trnFormatted: formattedTrn,
    vatMathCorrect,
    expectedVatAmount: expectedVat,
    vatDiscrepancyAed: parseFloat(vatDiff.toFixed(2)),
    salikTagMatched,
    complianceFlags: flags,
    summary,
    financialRiskAed: parseFloat(financialRiskAed.toFixed(2)),
  };
}
