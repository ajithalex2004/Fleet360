/**
 * Compliance & Regulatory Rules Engine
 * -------------------------------------
 * Validates document validity dates, UAE FTA 5% VAT calculation accuracy,
 * mandatory regulatory fields, and driver transport license categories.
 */

import { DocumentExtractionResult } from '../../types';

export interface ComplianceEvaluation {
  isCompliant: boolean;
  isExpired: boolean;
  isExpiringSoon: boolean; // within 30 days
  daysUntilExpiry?: number;
  vatCalculationValid: boolean;
  mandatoryFieldsPresent: boolean;
  missingMandatoryFields: string[];
  complianceScore: number; // 0.00 to 1.00
  notes: string[];
}

export function evaluateComplianceRules(extraction: DocumentExtractionResult): ComplianceEvaluation {
  const notes: string[] = [];
  const missingFields: string[] = [];
  let isExpired = false;
  let isExpiringSoon = false;
  let daysUntilExpiry: number | undefined;

  // 1. Expiry Evaluation
  if (extraction.expiryDate) {
    const expTime = new Date(extraction.expiryDate).getTime();
    const nowTime = Date.now();
    const diffDays = Math.ceil((expTime - nowTime) / (1000 * 60 * 60 * 24));
    daysUntilExpiry = diffDays;

    if (diffDays <= 0) {
      isExpired = true;
      notes.push(`Document is EXPIRED (Expired ${Math.abs(diffDays)} days ago on ${extraction.expiryDate}).`);
    } else if (diffDays <= 30) {
      isExpiringSoon = true;
      notes.push(`Document is EXPIRING SOON (${diffDays} days remaining until ${extraction.expiryDate}).`);
    } else {
      notes.push(`Document validity active (${diffDays} days remaining).`);
    }
  }

  // 2. UAE FTA 5% VAT Accuracy
  let vatCalculationValid = true;
  const financials = extraction.financials;
  if (financials?.totalAmount && financials?.subtotal) {
    const expectedVat = Math.round(financials.subtotal * 0.05 * 100) / 100;
    const actualVat = financials.taxAmount || financials.vatAmountAed || (financials.totalAmount - financials.subtotal);

    if (Math.abs(actualVat - expectedVat) > 1.0) {
      vatCalculationValid = false;
      notes.push(`VAT calculation variance: Expected 5% VAT is AED ${expectedVat}, but document states AED ${actualVat}.`);
    }
  }

  // 3. Mandatory Fields Check per Category
  switch (extraction.docCategory) {
    case 'REGISTRATION_CARD':
      if (!extraction.vehicle?.plateNumber && !extraction.vehicle?.licensePlate) missingFields.push('plateNumber');
      if (!extraction.vehicle?.vin) missingFields.push('vin');
      if (!extraction.expiryDate) missingFields.push('expiryDate');
      break;
    case 'INSURANCE_POLICY':
      if (!extraction.referenceNumber) missingFields.push('policyNumber');
      if (!extraction.expiryDate) missingFields.push('expiryDate');
      break;
    case 'DRIVER_LICENSE':
      if (!extraction.driver?.licenseNumber) missingFields.push('licenseNumber');
      if (!extraction.expiryDate) missingFields.push('expiryDate');
      break;
    case 'INVOICE':
    case 'TAX_INVOICE':
      if (!extraction.referenceNumber) missingFields.push('invoiceNumber');
      if (!financials?.totalAmount && !financials?.totalAmountAed) missingFields.push('totalAmount');
      break;
    default:
      break;
  }

  const mandatoryFieldsPresent = missingFields.length === 0;
  if (!mandatoryFieldsPresent) {
    notes.push(`Missing mandatory fields: ${missingFields.join(', ')}.`);
  }

  const isCompliant = !isExpired && vatCalculationValid && mandatoryFieldsPresent;
  const complianceScore = isCompliant ? 1.0 : isExpired ? 0.2 : 0.65;

  return {
    isCompliant,
    isExpired,
    isExpiringSoon,
    daysUntilExpiry,
    vatCalculationValid,
    mandatoryFieldsPresent,
    missingMandatoryFields: missingFields,
    complianceScore,
    notes,
  };
}
