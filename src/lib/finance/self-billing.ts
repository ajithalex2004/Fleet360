/**
 * UAE VAT Art. 59(9) Self-Billing Engine for Small Transporters & Sub-contractors
 * Implements statutory self-billing tax invoice generation pursuant to
 * Article 59(9) of the Executive Regulations of Federal Decree-Law No. 8 of 2017 on Value Added Tax.
 */

import { isValidUaeTrn } from './peppol-e-invoice';

export interface TransporterParty {
  supplierName: string; // Sub-contractor / Transporter Legal Name
  supplierTrn?: string; // 15-digit TRN (if VAT registered) or empty for unregistered individual
  tradeLicenseNo?: string;
  address: string;
  city: string;
  emirate: string;
  contactPhone?: string;
  contactEmail?: string;
}

export interface FleetOperatorRecipient {
  companyName: string;
  trn: string; // 15-digit UAE TRN
  tradeLicenseNo: string;
  address: string;
  city: string;
  emirate: string;
  phone: string;
  email: string;
}

export interface SelfBillLineItem {
  tripId?: string;
  tripNumber?: string;
  description: string;
  serviceDate: string;
  quantity: number;
  ratePerUnit: number;
  netAmount: number;
  vatRatePct: number; // 5% standard or 0%
  vatAmount: number;
  grossAmount: number;
}

export interface SelfBilledTaxInvoice {
  selfBillNumber: string; // e.g. SB-2026-00891
  issueDate: string; // ISO Date YYYY-MM-DD
  settlementPeriod: string; // e.g. "AUG-2026"
  supplier: TransporterParty;
  recipient: FleetOperatorRecipient;
  statutoryDeclaration: string;
  items: SelfBillLineItem[];
  subtotalNet: number;
  vatTotal: number;
  grandTotalGross: number;
  paymentDueDate: string;
  paymentMethod: string;
  beneficiaryIban?: string;
  status: 'ISSUED' | 'APPROVED' | 'DISBURSED' | 'CANCELLED';
}

export const MANDATORY_STATUTORY_DECLARATION = 
  'This is a Self-Billed Tax Invoice issued by the recipient on behalf of the supplier pursuant to Article 59(9) of the UAE Cabinet Decision No. 52 of 2017 on the Executive Regulations of Federal Decree-Law No. 8 of 2017 on Value Added Tax. The supplier undertakes not to issue a separate Tax Invoice for the supplies listed herein.';

export const MANDATORY_STATUTORY_DECLARATION_AR =
  'هذه فاتورة ضريبية ذاتية صادرة من المستلم نيابة عن المورد وفقاً للمادة 59(9) من قرار مجلس الوزراء رقم 52 لسنة 2017 في شأن اللائحة التنفيذية للمرسوم بقانون اتحادي رقم 8 لسنة 2017 بشأن ضريبة القيمة المضافة. يتعهد المورد بعدم إصدار فاتورة ضريبية منفصلة للتوريدات الواردة في هذه الفاتورة.';

/**
 * Generates a compliant Self-Billed Tax Invoice
 */
export function generateSelfBilledTaxInvoice(params: {
  selfBillNumber: string;
  supplier: TransporterParty;
  recipient?: Partial<FleetOperatorRecipient>;
  items: Array<{
    tripId?: string;
    tripNumber?: string;
    description: string;
    serviceDate: string;
    quantity?: number;
    ratePerUnit: number;
    vatRatePct?: number;
  }>;
  settlementPeriod?: string;
  beneficiaryIban?: string;
  paymentDueDate?: string;
}): SelfBilledTaxInvoice {
  const recipient: FleetOperatorRecipient = {
    companyName: params.recipient?.companyName || 'Fleet360 Smart Mobility Solutions LLC',
    trn: params.recipient?.trn || '100456789012345',
    tradeLicenseNo: params.recipient?.tradeLicenseNo || 'CN-1029384',
    address: params.recipient?.address || 'Sheikh Zayed Road, Al Quoz 1, Building 4',
    city: params.recipient?.city || 'Dubai',
    emirate: params.recipient?.emirate || 'Dubai',
    phone: params.recipient?.phone || '+971 4 300 9999',
    email: params.recipient?.email || 'settlements@fleet360.ae',
  };

  const isSupplierVatRegistered = isValidUaeTrn(params.supplier.supplierTrn);

  let subtotalNet = 0;
  let vatTotal = 0;

  const processedItems: SelfBillLineItem[] = params.items.map(item => {
    const qty = item.quantity ?? 1;
    const net = Number((qty * item.ratePerUnit).toFixed(2));
    const vatPct = isSupplierVatRegistered ? (item.vatRatePct ?? 5) : 0;
    const vat = Number((net * (vatPct / 100)).toFixed(2));
    const gross = Number((net + vat).toFixed(2));

    subtotalNet += net;
    vatTotal += vat;

    return {
      tripId: item.tripId,
      tripNumber: item.tripNumber,
      description: item.description,
      serviceDate: item.serviceDate,
      quantity: qty,
      ratePerUnit: item.ratePerUnit,
      netAmount: net,
      vatRatePct: vatPct,
      vatAmount: vat,
      grossAmount: gross,
    };
  });

  subtotalNet = Number(subtotalNet.toFixed(2));
  vatTotal = Number(vatTotal.toFixed(2));
  const grandTotalGross = Number((subtotalNet + vatTotal).toFixed(2));

  const now = new Date();
  const issueDate = now.toISOString().split('T')[0];
  const dueDate = params.paymentDueDate || new Date(now.getTime() + 15 * 86400000).toISOString().split('T')[0];

  return {
    selfBillNumber: params.selfBillNumber,
    issueDate,
    settlementPeriod: params.settlementPeriod || `${now.toLocaleString('default', { month: 'short' }).toUpperCase()}-${now.getFullYear()}`,
    supplier: params.supplier,
    recipient,
    statutoryDeclaration: MANDATORY_STATUTORY_DECLARATION,
    items: processedItems,
    subtotalNet,
    vatTotal,
    grandTotalGross,
    paymentDueDate: dueDate,
    paymentMethod: 'WPS_DIRECT_TRANSFER',
    beneficiaryIban: params.beneficiaryIban,
    status: 'ISSUED',
  };
}
