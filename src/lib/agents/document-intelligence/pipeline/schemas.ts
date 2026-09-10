/**
 * Fleet360 Strict Document Schemas & Field Normalizers
 * -----------------------------------------------------
 * Defines typed schema definitions for each supported document category
 * ensuring consistent entity structures and eliminating freeform parsing ambiguity.
 */

import {
  DocIntelligenceCategory,
  ExtractedVehicleInfo,
  ExtractedDriverInfo,
  ExtractedFinancials,
  ExtractedSupplierInfo,
  ContractObligationItem,
} from '../../types';

export interface VehicleRegistrationDocument {
  documentType: 'REGISTRATION_CARD';
  vehiclePlate: string;
  plateCode: string;
  plateEmirate: string;
  vin: string;
  registrationNumber?: string;
  registrationDate?: string;
  expiryDate: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: number;
  vehicleClass?: string;
  ownerName?: string;
  trafficFileNumber?: string;
  issuingAuthority: string;
}

export interface VehicleInsuranceDocument {
  documentType: 'INSURANCE_POLICY';
  policyNumber: string;
  insurer: string;
  insuredVehicle: string;
  vin: string;
  plateNumber?: string;
  coverageType: 'COMPREHENSIVE' | 'THIRD_PARTY' | 'COMMERCIAL_FLEET';
  startDate?: string;
  expiryDate: string;
  premiumAed: number;
  excessAed?: number;
  geographicalCoverage?: string;
  passengerLimit?: number;
}

export interface DriverLicenseDocument {
  documentType: 'DRIVER_LICENSE';
  driverNameEn: string;
  driverNameAr?: string;
  licenseNumber: string;
  emiratesId?: string;
  issueDate?: string;
  expiryDate: string;
  issuingEmirate: string;
  categories: string[];
  heavyBusEligible: boolean;
  restrictions: string[];
}

export interface PartnerTradeLicenseDocument {
  documentType: 'PARTNER_TRADE_LICENSE';
  companyName: string;
  tradeLicenseNumber: string;
  issueAuthority: string; // DED, ADED, JAFZA, etc.
  issueDate?: string;
  expiryDate: string;
  activities: string[];
  legalForm?: string;
  taxRegistrationNumber?: string;
}

export interface InvoiceDocument {
  documentType: 'INVOICE' | 'TAX_INVOICE';
  supplier: string;
  taxRegistrationNumber?: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  purchaseOrderRef?: string;
  workOrderRef?: string;
  vehiclePlateRef?: string;
  subtotalAed: number;
  vatRatePct: number;
  vatAmountAed: number;
  totalAmountAed: number;
  currency: string;
  bankDetails?: {
    iban?: string;
    bankName?: string;
  };
  paymentTerms?: string;
}

export interface QuotationDocument {
  documentType: 'QUOTATION';
  supplier: string;
  quoteReference: string;
  quoteDate: string;
  validUntil: string;
  totalProposedAed: number;
  scopeDescription?: string;
}

export interface WorkOrderJobCardDocument {
  documentType: 'MAINTENANCE_REPORT';
  jobCardNumber: string;
  workshopName: string;
  vehiclePlate: string;
  odometerKm?: number;
  serviceDate: string;
  laborCostAed: number;
  partsCostAed: number;
  vatAmountAed: number;
  totalAmountAed: number;
  workStatus: 'COMPLETED' | 'IN_PROGRESS' | 'ROAD_TEST_PASSED';
}

export interface ContractAgreementDocument {
  documentType: 'CONTRACT';
  contractNumber: string;
  clientName: string;
  contractTitle: string;
  startDate: string;
  expiryDate: string;
  monthlyRateAed?: number;
  terminationNoticeDays: number;
  slaPenalties: Array<{
    violationType: string;
    penaltyAed: number;
  }>;
}

export interface ProofOfDeliveryDocument {
  documentType: 'PROOF_OF_DELIVERY';
  waybillNumber: string;
  trackingReference?: string;
  shipper: string;
  consignee: string;
  recipientName?: string;
  deliveryTimestamp: string;
  status: 'DELIVERED' | 'ATTEMPTED' | 'RETURNED';
}

export interface InspectionSheetDocument {
  documentType: 'INSPECTION_SHEET';
  certificateNumber: string;
  vehiclePlate: string;
  vin?: string;
  odometerKm?: number;
  brakeEfficiencyPct?: number;
  roadworthinessResult: 'PASS' | 'FAIL' | 'CONDITIONAL';
  inspectionDate: string;
  expiryDate: string;
}

/**
 * Normalizes raw date strings into standard ISO YYYY-MM-DD format.
 */
export function normalizeIsoDate(dateStr?: string): string | undefined {
  if (!dateStr) return undefined;
  const clean = dateStr.trim();

  // Handle DD/MM/YYYY or DD-MM-YYYY
  const slashMatch = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashMatch) {
    const day = slashMatch[1].padStart(2, '0');
    const month = slashMatch[2].padStart(2, '0');
    const year = slashMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Handle YYYY-MM-DD
  const isoMatch = clean.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (isoMatch) {
    const year = isoMatch[1];
    const month = isoMatch[2].padStart(2, '0');
    const day = isoMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(clean);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return undefined;
}

/**
 * Normalizes UAE Vehicle Plate numbers to standard format (e.g. Dubai B 78219 -> Plate: 78219, Code: B, Emirate: DUBAI)
 */
export function normalizePlateInfo(plateStr?: string): { emirate?: string; code?: string; number?: string } {
  if (!plateStr) return {};
  const cleaned = plateStr.replace(/[^A-Za-z0-9\s]/g, ' ').trim();
  const parts = cleaned.split(/\s+/);

  let emirate: string | undefined;
  let code: string | undefined;
  let number: string | undefined;

  for (const part of parts) {
    const upper = part.toUpperCase();
    if (['DUBAI', 'DXB', 'ABU_DHABI', 'ABUDHABI', 'SHARJAH', 'AJMAN', 'RAK', 'FUJAIRAH', 'UMM_AL_QUWAIN'].includes(upper)) {
      emirate = upper === 'DXB' ? 'DUBAI' : upper;
    } else if (/^[A-Z]{1,2}$|^\d{1,2}$/.test(upper) && !code) {
      code = upper;
    } else if (/^\d{3,6}$/.test(part)) {
      number = part;
    }
  }

  return { emirate: emirate || 'DUBAI', code: code || 'A', number: number || parts[parts.length - 1] };
}
