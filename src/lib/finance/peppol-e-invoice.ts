/**
 * UAE Peppol E-Invoicing Engine (UBL 2.1 / PINT-UAE XML)
 * Compliant with UAE Ministry of Finance & FTA Electronic Invoicing Mandate (Phase 1 / Peppol PINT)
 * ISO/IEC 19845 / Peppol BIS Billing 3.0 / PINT-UAE Profile
 */

import { createHash } from 'crypto';

export interface PeppolParty {
  name: string;
  trn: string; // 15-digit UAE Tax Registration Number (starts with 100)
  crn?: string; // Commercial Registration / Trade License
  address: {
    street: string;
    city: string;
    state?: string; // Emirate (Dubai, Abu Dhabi, Sharjah, etc.)
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
  quantity: number;
  unitCode?: string; // 'C62' (unit/piece), 'KMT' (kilometre), 'DAY' (day), 'HUR' (hour)
  unitPrice: number;
  netAmount: number;
  vatRatePercent: number; // 5% standard in UAE or 0% for exempt/zero-rated
  vatAmount: number;
  taxCategoryCode: 'S' | 'Z' | 'E' | 'O'; // S = Standard 5%, Z = Zero, E = Exempt, O = Out of scope
}

export interface PeppolInvoiceData {
  invoiceNumber: string;
  issueDate: string; // YYYY-MM-DD
  issueTime?: string; // HH:MM:SS
  dueDate?: string; // YYYY-MM-DD
  currency: string; // 'AED'
  seller: PeppolParty;
  buyer: PeppolParty;
  lines: PeppolInvoiceLine[];
  notes?: string;
  paymentMeansCode?: string; // '30' (credit transfer), '48' (credit card), '10' (cash)
  paymentIban?: string;
  referenceContractNo?: string;
}

export interface PeppolValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  digestHash?: string;
  xml?: string;
}

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
 * Generates and validates a PINT-UAE UBL 2.1 E-Invoice XML
 */
export function generatePeppolUaeInvoiceXml(data: PeppolInvoiceData): PeppolValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Mandatory Validations according to UAE MoF / FTA
  if (!data.invoiceNumber) errors.push('Invoice number is required.');
  if (!data.issueDate) errors.push('Issue date is required.');
  if (data.currency !== 'AED') warnings.push(`Currency is '${data.currency}'. UAE domestic invoices should typically be 'AED'.`);

  if (!isValidUaeTrn(data.seller.trn)) {
    errors.push(`Seller TRN '${data.seller.trn}' is invalid. UAE TRN must be 15 digits starting with '100'.`);
  }
  if (!data.seller.name) errors.push('Seller legal name is required.');
  if (!data.buyer.name) errors.push('Buyer legal name is required.');
  if (data.buyer.trn && !isValidUaeTrn(data.buyer.trn)) {
    warnings.push(`Buyer TRN '${data.buyer.trn}' does not follow UAE 15-digit standard.`);
  }

  if (!data.lines || data.lines.length === 0) {
    errors.push('Invoice must contain at least one invoice line item.');
  }

  // Calculate totals
  let lineExtensionTotal = 0;
  let vatTotal = 0;

  for (let i = 0; i < (data.lines || []).length; i++) {
    const line = data.lines[i];
    const expectedLineNet = Number((line.quantity * line.unitPrice).toFixed(2));
    const lineNet = Number(line.netAmount.toFixed(2));
    if (Math.abs(expectedLineNet - lineNet) > 0.05) {
      warnings.push(`Line ${i + 1} net amount (${lineNet}) differs from Qty x Price (${expectedLineNet}).`);
    }

    const expectedVat = Number((lineNet * (line.vatRatePercent / 100)).toFixed(2));
    const lineVat = Number(line.vatAmount.toFixed(2));
    if (Math.abs(expectedVat - lineVat) > 0.05) {
      warnings.push(`Line ${i + 1} VAT (${lineVat}) differs from ${line.vatRatePercent}% calculation (${expectedVat}).`);
    }

    lineExtensionTotal += lineNet;
    vatTotal += lineVat;
  }

  lineExtensionTotal = Number(lineExtensionTotal.toFixed(2));
  vatTotal = Number(vatTotal.toFixed(2));
  const taxInclusiveTotal = Number((lineExtensionTotal + vatTotal).toFixed(2));
  const payableAmount = taxInclusiveTotal;

  if (errors.length > 0) {
    return {
      isValid: false,
      errors,
      warnings,
    };
  }

  const issueTime = data.issueTime || '12:00:00';
  const unitCodeDefault = 'C62'; // Standard unit

  // Construct standard PINT-UAE UBL 2.1 XML
  const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:peppol:pint:billing-1@ae-1</cbc:CustomizationID>
  <cbc:ProfileID>urn:peppol:bis:billing</cbc:ProfileID>
  <cbc:ID>${escapeXml(data.invoiceNumber)}</cbc:ID>
  <cbc:IssueDate>${escapeXml(data.issueDate)}</cbc:IssueDate>
  <cbc:IssueTime>${escapeXml(issueTime)}</cbc:IssueTime>
  ${data.dueDate ? `<cbc:DueDate>${escapeXml(data.dueDate)}</cbc:DueDate>` : ''}
  <cbc:InvoiceTypeCode listID="UNCL1001">380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${escapeXml(data.currency)}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>AED</cbc:TaxCurrencyCode>
  ${data.notes ? `<cbc:Note>${escapeXml(data.notes)}</cbc:Note>` : ''}
  ${data.referenceContractNo ? `
  <cac:ContractDocumentReference>
    <cbc:ID>${escapeXml(data.referenceContractNo)}</cbc:ID>
  </cac:ContractDocumentReference>` : ''}

  <!-- Accounting Supplier Party (Seller) -->
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(data.seller.address.street)}</cbc:StreetName>
        <cbc:CityName>${escapeXml(data.seller.address.city)}</cbc:CityName>
        ${data.seller.address.state ? `<cbc:CountrySubentity>${escapeXml(data.seller.address.state)}</cbc:CountrySubentity>` : ''}
        <cac:Country>
          <cbc:IdentificationCode>${escapeXml(data.seller.address.countryCode)}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(data.seller.trn)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(data.seller.name)}</cbc:RegistrationName>
        ${data.seller.crn ? `<cbc:CompanyID>${escapeXml(data.seller.crn)}</cbc:CompanyID>` : ''}
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
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(data.buyer.address.street)}</cbc:StreetName>
        <cbc:CityName>${escapeXml(data.buyer.address.city)}</cbc:CityName>
        ${data.buyer.address.state ? `<cbc:CountrySubentity>${escapeXml(data.buyer.address.state)}</cbc:CountrySubentity>` : ''}
        <cac:Country>
          <cbc:IdentificationCode>${escapeXml(data.buyer.address.countryCode)}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      ${data.buyer.trn ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(data.buyer.trn)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(data.buyer.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
      ${data.buyer.contact ? `
      <cac:Contact>
        ${data.buyer.contact.name ? `<cbc:Name>${escapeXml(data.buyer.contact.name)}</cbc:Name>` : ''}
        ${data.buyer.contact.phone ? `<cbc:Telephone>${escapeXml(data.buyer.contact.phone)}</cbc:Telephone>` : ''}
        ${data.buyer.contact.email ? `<cbc:ElectronicMail>${escapeXml(data.buyer.contact.email)}</cbc:ElectronicMail>` : ''}
      </cac:Contact>` : ''}
    </cac:Party>
  </cac:AccountingCustomerParty>

  <!-- Payment Means -->
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode listID="UNCL4461">${escapeXml(data.paymentMeansCode || '30')}</cbc:PaymentMeansCode>
    ${data.paymentIban ? `
    <cac:PayeeFinancialAccount>
      <cbc:ID>${escapeXml(data.paymentIban)}</cbc:ID>
    </cac:PayeeFinancialAccount>` : ''}
  </cac:PaymentMeans>

  <!-- Tax Total -->
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${escapeXml(data.currency)}">${vatTotal.toFixed(2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${escapeXml(data.currency)}">${lineExtensionTotal.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${escapeXml(data.currency)}">${vatTotal.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>5</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>

  <!-- Legal Monetary Total -->
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${escapeXml(data.currency)}">${lineExtensionTotal.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${escapeXml(data.currency)}">${lineExtensionTotal.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${escapeXml(data.currency)}">${taxInclusiveTotal.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${escapeXml(data.currency)}">${payableAmount.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  <!-- Invoice Lines -->
  ${data.lines.map((line, idx) => `
  <cac:InvoiceLine>
    <cbc:ID>${escapeXml(line.id || idx + 1)}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${escapeXml(line.unitCode || unitCodeDefault)}">${line.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${escapeXml(data.currency)}">${line.netAmount.toFixed(2)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Description>${escapeXml(line.description || line.name)}</cbc:Description>
      <cbc:Name>${escapeXml(line.name)}</cbc:Name>
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

  return {
    isValid: true,
    errors: [],
    warnings,
    digestHash,
    xml: xmlBody,
  };
}
