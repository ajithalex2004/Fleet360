/**
 * UAE Peppol E-Invoicing Engine (UBL 2.1 / PINT-UAE XML)
 * Compliant with UAE Ministry of Finance & FTA Electronic Invoicing Mandate (Phase 1 & 2 / Peppol PINT AE)
 * ISO/IEC 19845 / Peppol BIS Billing 3.0 / PINT-UAE Profile (urn:peppol:pint:billing-1@ae-1)
 */

import { createHash, randomUUID } from 'crypto';
import { toEmirateIsoCode, UAE_PEPPOL_SCHEME_ID } from './uae';
import { generateFtaTlvQrBase64 } from './fta-qr';

export type PeppolTaxCategoryCode = 'S' | 'Z' | 'E' | 'O' | 'AE' | 'G';

export type PeppolInvoiceTypeCode = '380' | '381' | '383' | '386' | '389' | '480';

export interface PeppolParty {
  name: string;
  nameAr?: string;
  trn: string; // 15-digit UAE Tax Registration Number (starts with 100)
  corporateTaxTrn?: string; // 9-15 digit UAE Corporate Tax Registration Number
  crn?: string; // Commercial Registration / Trade License
  crnSchemeId?: string; // e.g. 'TL' or Issuing Authority ('DED-DU', 'ADDED-AZ', 'JAFZA')
  endpointId?: string; // PEPPOL Participant ID (cbc:EndpointID), defaults to TRN
  endpointSchemeId?: string; // Defaults to '0235' (UAE MoF TRN Scheme)
  address: {
    street: string;
    additionalStreet?: string;
    city: string;
    state?: string; // Emirate name or ISO 3166-2:AE code (AE-DU, AE-AZ, etc.)
    postalCode?: string;
    countryCode: string; // 'AE'
  };
  contact?: {
    name?: string;
    phone?: string;
    email?: string;
  };
}

export interface PeppolInvoiceLine {
  id: string | number;
  name: string;
  description?: string;
  itemCode?: string;
  commodityCode?: string;
  quantity: number;
  unitCode?: string; // 'C62' (unit/piece), 'KMT' (kilometre), 'DAY' (day), 'HUR' (hour)
  unitPrice: number;
  allowanceAmount?: number;
  netAmount: number;
  vatRatePercent: number; // 5% standard in UAE or 0% for exempt/zero-rated/reverse-charge
  vatAmount: number;
  taxCategoryCode: PeppolTaxCategoryCode; // S = Standard 5%, Z = Zero, E = Exempt, O = Out of scope, AE = Reverse Charge, G = Export
  taxExemptionReasonCode?: string;
  taxExemptionReason?: string;
}

export interface PeppolBillingReference {
  invoiceNumber: string;
  issueDate?: string;
}

export interface PeppolInvoiceData {
  uuid?: string;
  invoiceNumber: string;
  issueDate: string; // YYYY-MM-DD
  issueTime?: string; // HH:MM:SS
  dueDate?: string; // YYYY-MM-DD
  supplyDate?: string; // YYYY-MM-DD (BT-72 ActualDeliveryDate)
  invoiceTypeCode?: PeppolInvoiceTypeCode; // '380' Tax Invoice, '381' Credit Note, '383' Debit Note
  currency: string; // 'AED'
  taxCurrencyCode?: string; // 'AED'
  exchangeRate?: number; // Foreign currency -> AED rate when currency !== 'AED'
  buyerReference?: string; // BT-10 Buyer Reference / Cost Center
  orderReference?: string; // BT-13 Purchase Order Reference
  billingReference?: PeppolBillingReference; // BG-3 Preceding Invoice Reference (required for 381/383)
  discountAmount?: number; // Document-level allowance (BG-20)
  discountReason?: string;
  discountTaxCategoryCode?: PeppolTaxCategoryCode;
  discountVatRatePercent?: number;
  prepaidAmount?: number;
  qrCodePayload?: string;
  seller: PeppolParty;
  buyer: PeppolParty;
  lines: PeppolInvoiceLine[];
  notes?: string;
  paymentMeansCode?: string; // '30' (credit transfer), '48' (credit card), '10' (cash)
  paymentIban?: string;
  paymentAccountName?: string;
  paymentFinancialInstitutionBic?: string;
  paymentTermsNote?: string;
  referenceContractNo?: string;
}

export interface PeppolValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  digestHash?: string;
  qrCodeBase64?: string;
  xml?: string;
}

const DEFAULT_EXEMPTION_REASONS: Record<Exclude<PeppolTaxCategoryCode, 'S'>, { code: string; reason: string }> = {
  Z: {
    code: 'VATEX-AE-Z',
    reason: 'Zero-rated supply under UAE Federal Decree-Law No. 8 of 2017 Article 45',
  },
  E: {
    code: 'VATEX-AE-E',
    reason: 'Exempt supply under UAE Federal Decree-Law No. 8 of 2017 Article 46',
  },
  O: {
    code: 'VATEX-AE-O',
    reason: 'Supply outside the territorial scope of UAE VAT',
  },
  AE: {
    code: 'VATEX-AE-RC',
    reason: 'Reverse charge mechanism applies under UAE VAT Law Article 48',
  },
  G: {
    code: 'VATEX-AE-G',
    reason: 'Direct/indirect export of goods or services outside the GCC Implementing States',
  },
};

/**
 * Validates UAE FTA TRN format (15 digits, starting with 100)
 */
export function isValidUaeTrn(trn: string | undefined): boolean {
  if (!trn) return false;
  const cleaned = trn.replace(/[-\s]/g, '');
  return /^\d{15}$/.test(cleaned) && cleaned.startsWith('100');
}

/**
 * Escapes special XML characters to prevent injection
 */
function escapeXml(unsafe: string | number | undefined | null): string {
  if (unsafe === undefined || unsafe === null) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Performs comprehensive UAE PINT AE business-rule validation (IBR-AE-* / IBR-*).
 */
export function validatePintAeInvoice(data: PeppolInvoiceData): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!data.invoiceNumber) errors.push('[IBR-002] Invoice number (cbc:ID) is required.');
  if (!data.issueDate) errors.push('[IBR-003] Issue date (cbc:IssueDate) is required.');
  if (data.currency !== 'AED') {
    warnings.push(`[IBR-AE-05] Document currency is '${data.currency}'. Tax amounts are reported in 'AED' using exchange rate ${data.exchangeRate ?? 3.6725}.`);
  }

  if (!isValidUaeTrn(data.seller.trn)) {
    errors.push(`[IBR-AE-01] Seller TRN '${data.seller.trn}' is invalid. UAE TRN must be 15 digits starting with '100'.`);
  }
  if (!data.seller.name) errors.push('[IBR-006] Seller legal registration name is required.');
  if (!data.buyer.name) errors.push('[IBR-007] Buyer legal registration name is required.');

  if (data.buyer.trn && !isValidUaeTrn(data.buyer.trn)) {
    warnings.push(`[IBR-AE-02] Buyer TRN '${data.buyer.trn}' does not follow UAE 15-digit standard.`);
  }

  const invoiceType = data.invoiceTypeCode || '380';
  if ((invoiceType === '381' || invoiceType === '383') && !data.billingReference?.invoiceNumber) {
    warnings.push(`[IBR-AE-08] Credit/Debit Note (${invoiceType}) should reference the preceding invoice number in cac:BillingReference.`);
  }

  if (!data.lines || data.lines.length === 0) {
    errors.push('[IBR-016] Invoice must contain at least one invoice line item.');
  }

  for (let i = 0; i < (data.lines || []).length; i++) {
    const line = data.lines[i];
    if (line.unitPrice < 0) {
      errors.push(`[IBR-046] Line ${i + 1} item net price (${line.unitPrice}) cannot be negative. Use document-level discountAmount or AllowanceCharge instead.`);
    }
    const allowance = Number(line.allowanceAmount ?? 0);
    const expectedLineNet = Number((line.quantity * line.unitPrice - allowance).toFixed(2));
    const lineNet = Number(line.netAmount.toFixed(2));
    if (Math.abs(expectedLineNet - lineNet) > 0.05) {
      warnings.push(`Line ${i + 1} net amount (${lineNet}) differs from Qty x Price (${expectedLineNet}).`);
    }

    const expectedVat = Number((lineNet * (line.vatRatePercent / 100)).toFixed(2));
    const lineVat = Number(line.vatAmount.toFixed(2));
    if (Math.abs(expectedVat - lineVat) > 0.05) {
      warnings.push(`Line ${i + 1} VAT (${lineVat}) differs from ${line.vatRatePercent}% calculation (${expectedVat}).`);
    }

    if (line.taxCategoryCode === 'S' && line.vatRatePercent !== 5) {
      warnings.push(`[IBR-AE-06] Line ${i + 1} has standard category 'S' with non-standard VAT rate ${line.vatRatePercent}% (expected 5%).`);
    }
    if (line.taxCategoryCode !== 'S' && line.vatRatePercent !== 0) {
      warnings.push(`[IBR-AE-07] Line ${i + 1} has category '${line.taxCategoryCode}' with non-zero VAT rate ${line.vatRatePercent}% (expected 0%).`);
    }
    if (line.taxCategoryCode === 'AE' && !isValidUaeTrn(data.buyer.trn)) {
      warnings.push(`[IBR-AE-09] Line ${i + 1} uses Reverse Charge ('AE'), which requires a valid 15-digit Buyer VAT TRN.`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Generates and validates a PINT-UAE UBL 2.1 E-Invoice XML
 */
export function generatePeppolUaeInvoiceXml(data: PeppolInvoiceData): PeppolValidationResult {
  const validation = validatePintAeInvoice(data);
  const { errors, warnings } = validation;

  if (!validation.isValid) {
    return {
      isValid: false,
      errors,
      warnings,
    };
  }

  // Group tax subtotals by (taxCategoryCode, vatRatePercent)
  interface TaxGroup {
    categoryCode: PeppolTaxCategoryCode;
    ratePercent: number;
    taxableAmount: number;
    taxAmount: number;
    exemptionReasonCode?: string;
    exemptionReason?: string;
  }

  const taxGroupMap = new Map<string, TaxGroup>();
  let lineExtensionTotal = 0;

  for (const line of data.lines) {
    const lineNet = Number(line.netAmount.toFixed(2));
    const lineVat = Number(line.vatAmount.toFixed(2));
    const categoryCode: PeppolTaxCategoryCode = line.taxCategoryCode || (line.vatRatePercent > 0 ? 'S' : 'Z');
    const ratePercent = Number(line.vatRatePercent ?? (categoryCode === 'S' ? 5 : 0));

    lineExtensionTotal += lineNet;

    const key = `${categoryCode}:${ratePercent}`;
    const existing = taxGroupMap.get(key);
    if (existing) {
      existing.taxableAmount = Number((existing.taxableAmount + lineNet).toFixed(2));
      existing.taxAmount = Number((existing.taxAmount + lineVat).toFixed(2));
      if (!existing.exemptionReason && line.taxExemptionReason) {
        existing.exemptionReason = line.taxExemptionReason;
      }
      if (!existing.exemptionReasonCode && line.taxExemptionReasonCode) {
        existing.exemptionReasonCode = line.taxExemptionReasonCode;
      }
    } else {
      taxGroupMap.set(key, {
        categoryCode,
        ratePercent,
        taxableAmount: lineNet,
        taxAmount: lineVat,
        exemptionReasonCode: line.taxExemptionReasonCode,
        exemptionReason: line.taxExemptionReason,
      });
    }
  }

  lineExtensionTotal = Number(lineExtensionTotal.toFixed(2));

  // Handle document-level discount / allowance (BG-20) so we never emit negative line prices
  const discountAmount = Math.max(0, Number((data.discountAmount ?? 0).toFixed(2)));
  const discountCategory: PeppolTaxCategoryCode = data.discountTaxCategoryCode || 'S';
  const discountRate = data.discountVatRatePercent ?? (discountCategory === 'S' ? 5 : 0);

  if (discountAmount > 0) {
    const discountKey = `${discountCategory}:${discountRate}`;
    const targetGroup = taxGroupMap.get(discountKey) || taxGroupMap.values().next().value;
    if (targetGroup) {
      targetGroup.taxableAmount = Math.max(0, Number((targetGroup.taxableAmount - discountAmount).toFixed(2)));
      targetGroup.taxAmount = Number((targetGroup.taxableAmount * (targetGroup.ratePercent / 100)).toFixed(2));
    }
  }

  const taxGroups = Array.from(taxGroupMap.values());
  const vatTotal = Number(taxGroups.reduce((sum, g) => sum + g.taxAmount, 0).toFixed(2));
  const taxExclusiveTotal = Math.max(0, Number((lineExtensionTotal - discountAmount).toFixed(2)));
  const taxInclusiveTotal = Number((taxExclusiveTotal + vatTotal).toFixed(2));
  const prepaidAmount = Math.max(0, Number((data.prepaidAmount ?? 0).toFixed(2)));
  const payableAmount = Math.max(0, Number((taxInclusiveTotal - prepaidAmount).toFixed(2)));

  const issueTime = data.issueTime || '12:00:00';
  const unitCodeDefault = 'C62'; // Standard unit
  const invoiceTypeCode: PeppolInvoiceTypeCode = data.invoiceTypeCode || '380';
  const taxCurrencyCode = data.taxCurrencyCode || 'AED';
  const exchangeRate = data.currency !== 'AED' ? (data.exchangeRate && data.exchangeRate > 0 ? data.exchangeRate : 3.6725) : 1;
  const vatTotalAed = Number((vatTotal * exchangeRate).toFixed(2));

  const sellerCountry = (data.seller.address.countryCode || 'AE').toUpperCase();
  const buyerCountry = (data.buyer.address.countryCode || 'AE').toUpperCase();
  const sellerSubentity = data.seller.address.state
    ? (sellerCountry === 'AE' ? toEmirateIsoCode(data.seller.address.state) : data.seller.address.state)
    : (sellerCountry === 'AE' ? toEmirateIsoCode(data.seller.address.city) : undefined);
  const buyerSubentity = data.buyer.address.state
    ? (buyerCountry === 'AE' ? toEmirateIsoCode(data.buyer.address.state) : data.buyer.address.state)
    : undefined;

  const sellerEndpointId = (data.seller.endpointId || data.seller.trn || '').replace(/[-\s]/g, '');
  const sellerEndpointScheme = data.seller.endpointSchemeId || UAE_PEPPOL_SCHEME_ID;
  const buyerEndpointId = (data.buyer.endpointId || data.buyer.trn || data.buyer.crn || '').replace(/[-\s]/g, '');
  const buyerEndpointScheme = data.buyer.endpointSchemeId || UAE_PEPPOL_SCHEME_ID;
  const buyerRef = data.buyerReference || data.referenceContractNo || data.orderReference || data.invoiceNumber;
  const docUuid = data.uuid || randomUUID();

  // Compute preliminary FTA TLV QR code payload if not explicitly provided
  const preliminaryQrPayload =
    data.qrCodePayload ||
    generateFtaTlvQrBase64({
      sellerName: data.seller.name,
      sellerTrn: data.seller.trn,
      timestamp: `${data.issueDate}T${issueTime.endsWith('Z') ? issueTime : `${issueTime}Z`}`,
      totalWithVat: taxInclusiveTotal,
      vatTotal: data.currency === 'AED' ? vatTotal : vatTotalAed,
    });

  const renderTaxSubtotal = (group: TaxGroup) => {
    const isExemptOrZero = group.categoryCode !== 'S';
    const fallbackExemption = isExemptOrZero
      ? DEFAULT_EXEMPTION_REASONS[group.categoryCode as Exclude<PeppolTaxCategoryCode, 'S'>]
      : undefined;
    const reasonCode = group.exemptionReasonCode || fallbackExemption?.code;
    const reasonText = group.exemptionReason || fallbackExemption?.reason;

    return `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${escapeXml(data.currency)}">${group.taxableAmount.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${escapeXml(data.currency)}">${group.taxAmount.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${escapeXml(group.categoryCode)}</cbc:ID>
        <cbc:Percent>${group.ratePercent}</cbc:Percent>${
          isExemptOrZero && reasonCode
            ? `\n        <cbc:TaxExemptionReasonCode>${escapeXml(reasonCode)}</cbc:TaxExemptionReasonCode>`
            : ''
        }${
          isExemptOrZero && reasonText
            ? `\n        <cbc:TaxExemptionReason>${escapeXml(reasonText)}</cbc:TaxExemptionReason>`
            : ''
        }
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`;
  };

  // Construct standard PINT-UAE UBL 2.1 XML
  const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:peppol:pint:billing-1@ae-1</cbc:CustomizationID>
  <cbc:ProfileID>urn:peppol:bis:billing</cbc:ProfileID>
  <cbc:ID>${escapeXml(data.invoiceNumber)}</cbc:ID>
  <cbc:UUID>${escapeXml(docUuid)}</cbc:UUID>
  <cbc:IssueDate>${escapeXml(data.issueDate)}</cbc:IssueDate>
  <cbc:IssueTime>${escapeXml(issueTime)}</cbc:IssueTime>
  ${data.dueDate ? `<cbc:DueDate>${escapeXml(data.dueDate)}</cbc:DueDate>` : ''}
  <cbc:InvoiceTypeCode listID="UNCL1001">${escapeXml(invoiceTypeCode)}</cbc:InvoiceTypeCode>
  ${data.notes ? `<cbc:Note>${escapeXml(data.notes)}</cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>${escapeXml(data.currency)}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>${escapeXml(taxCurrencyCode)}</cbc:TaxCurrencyCode>
  <cbc:BuyerReference>${escapeXml(buyerRef)}</cbc:BuyerReference>
  ${data.orderReference ? `
  <cac:OrderReference>
    <cbc:ID>${escapeXml(data.orderReference)}</cbc:ID>
  </cac:OrderReference>` : ''}
  ${data.billingReference?.invoiceNumber ? `
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${escapeXml(data.billingReference.invoiceNumber)}</cbc:ID>
      ${data.billingReference.issueDate ? `<cbc:IssueDate>${escapeXml(data.billingReference.issueDate)}</cbc:IssueDate>` : ''}
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>` : ''}
  ${data.referenceContractNo ? `
  <cac:ContractDocumentReference>
    <cbc:ID>${escapeXml(data.referenceContractNo)}</cbc:ID>
  </cac:ContractDocumentReference>` : ''}
  <cac:AdditionalDocumentReference>
    <cbc:ID>QR</cbc:ID>
    <cbc:DocumentDescription>FTA-TLV-QR</cbc:DocumentDescription>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain" filename="qr.txt">${escapeXml(preliminaryQrPayload)}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>

  <!-- Accounting Supplier Party (Seller) -->
  <cac:AccountingSupplierParty>
    <cac:Party>
      ${sellerEndpointId ? `<cbc:EndpointID schemeID="${escapeXml(sellerEndpointScheme)}">${escapeXml(sellerEndpointId)}</cbc:EndpointID>` : ''}
      ${data.seller.nameAr ? `
      <cac:PartyName>
        <cbc:Name>${escapeXml(data.seller.nameAr)}</cbc:Name>
      </cac:PartyName>` : ''}
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(data.seller.address.street)}</cbc:StreetName>
        ${data.seller.address.additionalStreet ? `<cbc:AdditionalStreetName>${escapeXml(data.seller.address.additionalStreet)}</cbc:AdditionalStreetName>` : ''}
        <cbc:CityName>${escapeXml(data.seller.address.city)}</cbc:CityName>
        ${data.seller.address.postalCode ? `<cbc:PostalZone>${escapeXml(data.seller.address.postalCode)}</cbc:PostalZone>` : ''}
        ${sellerSubentity ? `<cbc:CountrySubentity>${escapeXml(sellerSubentity)}</cbc:CountrySubentity>` : ''}
        <cac:Country>
          <cbc:IdentificationCode>${escapeXml(sellerCountry)}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(data.seller.trn.replace(/[-\s]/g, ''))}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      ${data.seller.corporateTaxTrn ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(data.seller.corporateTaxTrn.replace(/[-\s]/g, ''))}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>CT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(data.seller.name)}</cbc:RegistrationName>
        ${data.seller.crn ? `<cbc:CompanyID${data.seller.crnSchemeId ? ` schemeID="${escapeXml(data.seller.crnSchemeId)}"` : ''}>${escapeXml(data.seller.crn)}</cbc:CompanyID>` : ''}
      </cac:PartyLegalEntity>
      ${data.seller.contact ? `
      <cac:Contact>
        ${data.seller.contact.name ? `<cbc:Name>${escapeXml(data.seller.contact.name)}</cbc:Name>` : ''}
        ${data.seller.contact.phone ? `<cbc:Telephone>${escapeXml(data.seller.contact.phone)}</cbc:Telephone>` : ''}
        ${data.seller.contact.email ? `<cbc:ElectronicMail>${escapeXml(data.seller.contact.email)}</cbc:ElectronicMail>` : ''}
      </cac:Contact>` : ''}
    </cac:Party>
  </cac:AccountingSupplierParty>

  <!-- Accounting Customer Party (Buyer) -->
  <cac:AccountingCustomerParty>
    <cac:Party>
      ${buyerEndpointId ? `<cbc:EndpointID schemeID="${escapeXml(buyerEndpointScheme)}">${escapeXml(buyerEndpointId)}</cbc:EndpointID>` : ''}
      ${data.buyer.nameAr ? `
      <cac:PartyName>
        <cbc:Name>${escapeXml(data.buyer.nameAr)}</cbc:Name>
      </cac:PartyName>` : ''}
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(data.buyer.address.street)}</cbc:StreetName>
        ${data.buyer.address.additionalStreet ? `<cbc:AdditionalStreetName>${escapeXml(data.buyer.address.additionalStreet)}</cbc:AdditionalStreetName>` : ''}
        <cbc:CityName>${escapeXml(data.buyer.address.city)}</cbc:CityName>
        ${data.buyer.address.postalCode ? `<cbc:PostalZone>${escapeXml(data.buyer.address.postalCode)}</cbc:PostalZone>` : ''}
        ${buyerSubentity ? `<cbc:CountrySubentity>${escapeXml(buyerSubentity)}</cbc:CountrySubentity>` : ''}
        <cac:Country>
          <cbc:IdentificationCode>${escapeXml(buyerCountry)}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      ${data.buyer.trn ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(data.buyer.trn.replace(/[-\s]/g, ''))}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(data.buyer.name)}</cbc:RegistrationName>
        ${data.buyer.crn ? `<cbc:CompanyID${data.buyer.crnSchemeId ? ` schemeID="${escapeXml(data.buyer.crnSchemeId)}"` : ''}>${escapeXml(data.buyer.crn)}</cbc:CompanyID>` : ''}
      </cac:PartyLegalEntity>
      ${data.buyer.contact ? `
      <cac:Contact>
        ${data.buyer.contact.name ? `<cbc:Name>${escapeXml(data.buyer.contact.name)}</cbc:Name>` : ''}
        ${data.buyer.contact.phone ? `<cbc:Telephone>${escapeXml(data.buyer.contact.phone)}</cbc:Telephone>` : ''}
        ${data.buyer.contact.email ? `<cbc:ElectronicMail>${escapeXml(data.buyer.contact.email)}</cbc:ElectronicMail>` : ''}
      </cac:Contact>` : ''}
    </cac:Party>
  </cac:AccountingCustomerParty>
  ${data.supplyDate ? `
  <!-- Delivery / Tax Point Date (BT-72) -->
  <cac:Delivery>
    <cbc:ActualDeliveryDate>${escapeXml(data.supplyDate)}</cbc:ActualDeliveryDate>
  </cac:Delivery>` : ''}

  <!-- Payment Means -->
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode listID="UNCL4461">${escapeXml(data.paymentMeansCode || '30')}</cbc:PaymentMeansCode>
    ${data.paymentIban ? `
    <cac:PayeeFinancialAccount>
      <cbc:ID>${escapeXml(data.paymentIban)}</cbc:ID>
      ${data.paymentAccountName ? `<cbc:Name>${escapeXml(data.paymentAccountName)}</cbc:Name>` : ''}
      ${data.paymentFinancialInstitutionBic ? `
      <cac:FinancialInstitutionBranch>
        <cbc:ID>${escapeXml(data.paymentFinancialInstitutionBic)}</cbc:ID>
      </cac:FinancialInstitutionBranch>` : ''}
    </cac:PayeeFinancialAccount>` : ''}
  </cac:PaymentMeans>
  ${data.paymentTermsNote ? `
  <cac:PaymentTerms>
    <cbc:Note>${escapeXml(data.paymentTermsNote)}</cbc:Note>
  </cac:PaymentTerms>` : ''}
  ${discountAmount > 0 ? `
  <!-- Document-Level Allowance / Discount (BG-20) -->
  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>${escapeXml(data.discountReason || 'Commercial Discount')}</cbc:AllowanceChargeReason>
    <cbc:Amount currencyID="${escapeXml(data.currency)}">${discountAmount.toFixed(2)}</cbc:Amount>
    <cac:TaxCategory>
      <cbc:ID>${escapeXml(discountCategory)}</cbc:ID>
      <cbc:Percent>${discountRate}</cbc:Percent>
      <cac:TaxScheme>
        <cbc:ID>VAT</cbc:ID>
      </cac:TaxScheme>
    </cac:TaxCategory>
  </cac:AllowanceCharge>` : ''}
  ${data.currency !== 'AED' ? `
  <!-- UAE VAT Art. 69 Foreign Currency to AED Tax Exchange Rate -->
  <cac:TaxExchangeRate>
    <cbc:SourceCurrencyCode>${escapeXml(data.currency)}</cbc:SourceCurrencyCode>
    <cbc:TargetCurrencyCode>AED</cbc:TargetCurrencyCode>
    <cbc:CalculationRate>${exchangeRate.toFixed(6)}</cbc:CalculationRate>
  </cac:TaxExchangeRate>` : ''}

  <!-- Tax Total -->
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${escapeXml(data.currency)}">${vatTotal.toFixed(2)}</cbc:TaxAmount>${taxGroups.map(renderTaxSubtotal).join('')}
  </cac:TaxTotal>
  ${data.currency !== 'AED' ? `
  <!-- Tax Total in Tax Accounting Currency (AED) -->
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="AED">${vatTotalAed.toFixed(2)}</cbc:TaxAmount>
  </cac:TaxTotal>` : ''}

  <!-- Legal Monetary Total -->
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${escapeXml(data.currency)}">${lineExtensionTotal.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${escapeXml(data.currency)}">${taxExclusiveTotal.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${escapeXml(data.currency)}">${taxInclusiveTotal.toFixed(2)}</cbc:TaxInclusiveAmount>
    ${discountAmount > 0 ? `<cbc:AllowanceTotalAmount currencyID="${escapeXml(data.currency)}">${discountAmount.toFixed(2)}</cbc:AllowanceTotalAmount>` : ''}
    ${prepaidAmount > 0 ? `<cbc:PrepaidAmount currencyID="${escapeXml(data.currency)}">${prepaidAmount.toFixed(2)}</cbc:PrepaidAmount>` : ''}
    <cbc:PayableAmount currencyID="${escapeXml(data.currency)}">${payableAmount.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  <!-- Invoice Lines -->
  ${data.lines.map((line, idx) => `
  <cac:InvoiceLine>
    <cbc:ID>${escapeXml(line.id || idx + 1)}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${escapeXml(line.unitCode || unitCodeDefault)}">${line.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${escapeXml(data.currency)}">${line.netAmount.toFixed(2)}</cbc:LineExtensionAmount>
    ${line.allowanceAmount && line.allowanceAmount > 0 ? `
    <cac:AllowanceCharge>
      <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
      <cbc:AllowanceChargeReason>Line Discount</cbc:AllowanceChargeReason>
      <cbc:Amount currencyID="${escapeXml(data.currency)}">${line.allowanceAmount.toFixed(2)}</cbc:Amount>
    </cac:AllowanceCharge>` : ''}
    <cac:Item>
      <cbc:Description>${escapeXml(line.description || line.name)}</cbc:Description>
      <cbc:Name>${escapeXml(line.name)}</cbc:Name>
      ${line.itemCode ? `
      <cac:SellersItemIdentification>
        <cbc:ID>${escapeXml(line.itemCode)}</cbc:ID>
      </cac:SellersItemIdentification>` : ''}
      ${line.commodityCode ? `
      <cac:CommodityClassification>
        <cbc:ItemClassificationCode listID="HS">${escapeXml(line.commodityCode)}</cbc:ItemClassificationCode>
      </cac:CommodityClassification>` : ''}
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${escapeXml(line.taxCategoryCode || 'S')}</cbc:ID>
        <cbc:Percent>${line.vatRatePercent}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${escapeXml(data.currency)}">${line.unitPrice.toFixed(2)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`).join('')}
</Invoice>`;

  // Cryptographic invoice digest (SHA-256) for audit trails & Peppol transport
  const digestHash = createHash('sha256').update(xmlBody, 'utf8').digest('hex');

  // Generate Phase 2 QR code including Tag 6 XML SHA-256 digest
  const qrCodeBase64 =
    data.qrCodePayload ||
    generateFtaTlvQrBase64({
      sellerName: data.seller.name,
      sellerTrn: data.seller.trn,
      timestamp: `${data.issueDate}T${issueTime.endsWith('Z') ? issueTime : `${issueTime}Z`}`,
      totalWithVat: taxInclusiveTotal,
      vatTotal: data.currency === 'AED' ? vatTotal : vatTotalAed,
      xmlHash: digestHash,
    });

  return {
    isValid: true,
    errors: [],
    warnings,
    digestHash,
    qrCodeBase64,
    xml: xmlBody,
  };
}
