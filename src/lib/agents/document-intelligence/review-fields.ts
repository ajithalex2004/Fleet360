/**
 * Documents that create financial or operational records from OCR are never
 * applied automatically: they wait in the Document Intelligence review queue
 * until a person checks the extracted fields and approves (see
 * staged-records.ts for what approval writes). Pure helpers, safe to import
 * from the browser.
 */
import type { DocumentExtractionResult } from '../types';

/** What approving a staged document creates. */
export type StagedRecordKind = 'PAYABLE' | 'WORK_ORDER' | 'POD' | 'QUOTATION';

const STAGED: Record<string, StagedRecordKind> = {
  INVOICE: 'PAYABLE',
  TAX_INVOICE: 'PAYABLE',
  QUOTATION: 'QUOTATION',
  MAINTENANCE_REPORT: 'WORK_ORDER',
  PROOF_OF_DELIVERY: 'POD',
};

export function stagedRecordKind(docCategory: string | null | undefined): StagedRecordKind | null {
  return STAGED[(docCategory ?? '').toUpperCase()] ?? null;
}

export interface PayableReviewFields {
  vendorName: string;
  vendorTrn: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  subtotal: string;
  vatAmount: string;
  totalAmount: string;
  currency: string;
}

export interface WorkOrderReviewFields {
  vehiclePlate: string;
  jobCardNumber: string;
  description: string;
  garageName: string;
  cost: string;
  repairDate: string;
}

export interface PodReviewFields {
  jobReference: string;
  receiverName: string;
}

export type ReviewFields = Partial<PayableReviewFields & WorkOrderReviewFields & PodReviewFields>;

/** The fields a reviewer confirms, per kind, with labels for the review form. */
export const REVIEW_FIELD_LABELS: Record<StagedRecordKind, Array<[keyof ReviewFields, string]>> = {
  PAYABLE: [
    ['vendorName', 'Vendor name'],
    ['vendorTrn', 'Vendor TRN (15 digits)'],
    ['invoiceNumber', 'Invoice number'],
    ['issueDate', 'Invoice date (YYYY-MM-DD)'],
    ['dueDate', 'Due date (optional)'],
    ['subtotal', 'Subtotal'],
    ['vatAmount', 'VAT amount'],
    ['totalAmount', 'Total amount'],
    ['currency', 'Currency'],
  ],
  WORK_ORDER: [
    ['vehiclePlate', 'Vehicle plate or code'],
    ['jobCardNumber', 'Job card number'],
    ['description', 'Work done'],
    ['garageName', 'Garage'],
    ['cost', 'Cost'],
    ['repairDate', 'Repair date (YYYY-MM-DD)'],
  ],
  POD: [
    ['jobReference', 'Drayage job code or container number'],
    ['receiverName', 'Received / signed by'],
  ],
  QUOTATION: [],
};

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const kv = (e: DocumentExtractionResult, ...keys: string[]) => {
  const values = e.extractedKeyValues ?? {};
  for (const k of keys) if (values[k] !== undefined && values[k] !== null && values[k] !== '') return s(values[k]);
  return '';
};

/** The review form's starting values, taken from the extraction. */
export function reviewFieldsFrom(e: DocumentExtractionResult): ReviewFields {
  const f = e.financials ?? {};
  const kind = stagedRecordKind(e.docCategory);
  if (kind === 'PAYABLE' || kind === 'QUOTATION') {
    return {
      vendorName: s(e.supplier?.name ?? e.supplier?.supplierName),
      vendorTrn: s(e.supplier?.trnNumber ?? e.supplier?.taxNumber),
      invoiceNumber: s(e.referenceNumber),
      issueDate: s(e.issueDate),
      dueDate: '',
      subtotal: s(f.subtotalAed ?? f.subtotal),
      vatAmount: s(f.vatAmountAed ?? f.taxAmount),
      totalAmount: s(f.totalAmountAed ?? f.totalAmount),
      currency: s(f.currency) || 'AED',
    };
  }
  if (kind === 'WORK_ORDER') {
    return {
      vehiclePlate: s(e.vehicle?.licensePlate ?? e.vehicle?.plateNumber),
      jobCardNumber: s(e.referenceNumber),
      description: s(e.summary),
      garageName: s(e.supplier?.name ?? e.supplier?.supplierName),
      cost: s(f.totalAmountAed ?? f.totalAmount),
      repairDate: s(e.issueDate),
    };
  }
  if (kind === 'POD') {
    return {
      jobReference: s(e.referenceNumber) || kv(e, 'containerNumber', 'container_number', 'jobCode'),
      receiverName: kv(e, 'receiverName', 'receivedBy', 'signedBy', 'consigneeName'),
    };
  }
  return {};
}
