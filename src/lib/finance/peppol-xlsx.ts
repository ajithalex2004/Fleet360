import * as XLSX from 'xlsx';
import type { PeppolInvoiceData, PeppolTaxCategoryCode, PeppolValidationResult } from './peppol-e-invoice';

const TAX_CATEGORY_NAME: Record<PeppolTaxCategoryCode, string> = {
  S: 'Standard rated',
  Z: 'Zero rated',
  E: 'Exempt',
  O: 'Out of scope',
  AE: 'Reverse charge',
  G: 'Export item',
};

/**
 * Builds a multi-sheet XLSX workbook representing a UAE Peppol e-invoice for
 * human review alongside the UBL 2.1 XML: header & parties, line items, VAT
 * breakdown by category, validation results, and the raw XML.
 */
export function buildPeppolWorkbook(
  invoice: PeppolInvoiceData,
  result: PeppolValidationResult,
  opts: { sample?: boolean } = {},
): Buffer {
  const wb = XLSX.utils.book_new();

  const rawNetTotal = Number(invoice.lines.reduce((s, l) => s + Number(l.netAmount.toFixed(2)), 0).toFixed(2));
  const discountAmount = Math.max(0, Number((invoice.discountAmount ?? 0).toFixed(2)));
  const netTotal = Math.max(0, Number((rawNetTotal - discountAmount).toFixed(2)));

  const byCat = new Map<string, { code: PeppolTaxCategoryCode; rate: number; taxable: number; tax: number }>();
  for (const l of invoice.lines) {
    const code: PeppolTaxCategoryCode = l.taxCategoryCode || (l.vatRatePercent > 0 ? 'S' : 'Z');
    const rate = Number(l.vatRatePercent ?? (code === 'S' ? 5 : 0));
    const key = `${code}:${rate}`;
    const cur = byCat.get(key) ?? { code, rate, taxable: 0, tax: 0 };
    cur.taxable = Number((cur.taxable + Number(l.netAmount.toFixed(2))).toFixed(2));
    cur.tax = Number((cur.tax + Number(l.vatAmount.toFixed(2))).toFixed(2));
    byCat.set(key, cur);
  }

  if (discountAmount > 0) {
    const discountCategory: PeppolTaxCategoryCode = invoice.discountTaxCategoryCode || 'S';
    const discountRate = invoice.discountVatRatePercent ?? (discountCategory === 'S' ? 5 : 0);
    const target =
      byCat.get(`${discountCategory}:${discountRate}`) ||
      Array.from(byCat.values()).find((g) => g.code === 'S') ||
      byCat.values().next().value;
    if (target) {
      target.taxable = Math.max(0, Number((target.taxable - discountAmount).toFixed(2)));
      target.tax = Number((target.taxable * (target.rate / 100)).toFixed(2));
    }
  }

  const vatTotal = Number(Array.from(byCat.values()).reduce((s, g) => s + g.tax, 0).toFixed(2));
  const grossTotal = Number((netTotal + vatTotal).toFixed(2));
  const prepaidAmount = Math.max(0, Number((invoice.prepaidAmount ?? 0).toFixed(2)));
  const payableAmount = Math.max(0, Number((grossTotal - prepaidAmount).toFixed(2)));

  const headerRows: (string | number)[][] = [
    ['UAE Peppol E-Invoice (PINT-UAE / UBL 2.1)', ''],
    ...(opts.sample ? [['SAMPLE', 'Placeholder data — configure your TRN in Admin → Company Profile and open a real invoice to generate a live document.']] : []),
    ['', ''],
    ['Document', ''],
    ['Customization ID', 'urn:peppol:pint:billing-1@ae-1'],
    ['Profile ID', 'urn:peppol:bis:billing'],
    ['Invoice Type Code', invoice.invoiceTypeCode ?? '380'],
    ['Invoice Number', invoice.invoiceNumber],
    ['Issue Date', invoice.issueDate],
    ['Issue Time', invoice.issueTime ?? '12:00:00'],
    ['Supply Date (Tax Point)', invoice.supplyDate ?? invoice.issueDate],
    ['Due Date', invoice.dueDate ?? ''],
    ['Document Currency', invoice.currency],
    ['Tax Currency', invoice.taxCurrencyCode ?? 'AED'],
    ...(invoice.currency !== 'AED' ? [['FX Rate (to AED)', invoice.exchangeRate ?? 3.6725]] : []),
    ['Buyer Reference', invoice.buyerReference ?? invoice.referenceContractNo ?? invoice.invoiceNumber],
    ['Order Reference', invoice.orderReference ?? ''],
    ['Preceding Invoice Ref', invoice.billingReference?.invoiceNumber ?? ''],
    ['Payment Means Code (UNCL4461)', invoice.paymentMeansCode ?? '30'],
    ['Payee IBAN', invoice.paymentIban ?? ''],
    ['Contract Reference', invoice.referenceContractNo ?? ''],
    ['Notes', invoice.notes ?? ''],
    ['', ''],
    ['Seller (AccountingSupplierParty)', ''],
    ['Legal Name (English)', invoice.seller.name],
    ['Legal Name (Arabic)', invoice.seller.nameAr ?? ''],
    ['TRN (15-digit FTA)', invoice.seller.trn],
    ['Corporate Tax TRN', invoice.seller.corporateTaxTrn ?? ''],
    ['PEPPOL Endpoint ID (0235)', invoice.seller.endpointId ?? invoice.seller.trn],
    ['Trade License / CRN', invoice.seller.crn ?? ''],
    ['Street', invoice.seller.address.street],
    ['City', invoice.seller.address.city],
    ['Emirate (ISO 3166-2:AE)', invoice.seller.address.state ?? ''],
    ['Postal Code', invoice.seller.address.postalCode ?? ''],
    ['Country Code', invoice.seller.address.countryCode],
    ['Contact Name', invoice.seller.contact?.name ?? ''],
    ['Contact Email', invoice.seller.contact?.email ?? ''],
    ['Contact Phone', invoice.seller.contact?.phone ?? ''],
    ['', ''],
    ['Buyer (AccountingCustomerParty)', ''],
    ['Legal Name', invoice.buyer.name],
    ['TRN (15-digit FTA)', invoice.buyer.trn || '(unregistered / B2C)'],
    ['PEPPOL Endpoint ID', invoice.buyer.endpointId ?? invoice.buyer.trn ?? ''],
    ['Trade License / CRN', invoice.buyer.crn ?? ''],
    ['Street', invoice.buyer.address.street],
    ['City', invoice.buyer.address.city],
    ['Emirate', invoice.buyer.address.state ?? ''],
    ['Postal Code', invoice.buyer.address.postalCode ?? ''],
    ['Country Code', invoice.buyer.address.countryCode],
    ['Contact Email', invoice.buyer.contact?.email ?? ''],
    ['Contact Phone', invoice.buyer.contact?.phone ?? ''],
    ['', ''],
    ['Legal Monetary Total', invoice.currency],
    ['Line extension amount (excl. VAT)', rawNetTotal],
    ...(discountAmount > 0 ? [['Allowance / Discount amount', discountAmount]] : []),
    ['Tax exclusive amount', netTotal],
    ['VAT amount', vatTotal],
    ['Total amount (incl. VAT)', grossTotal],
    ...(prepaidAmount > 0 ? [['Prepaid amount', prepaidAmount]] : []),
    ['Payable amount', payableAmount],
    ['', ''],
    ['Validation Status', result.isValid ? 'VALID' : 'INVALID'],
    ['SHA-256 Digest', result.digestHash ?? ''],
    ['FTA TLV QR Code (Base64)', result.qrCodeBase64 ?? ''],
  ];
  const wsHeader = XLSX.utils.aoa_to_sheet(headerRows);
  wsHeader['!cols'] = [{ wch: 34 }, { wch: 64 }];
  XLSX.utils.book_append_sheet(wb, wsHeader, 'Invoice');

  const lineRows: (string | number)[][] = [
    ['Line #', 'Item Name', 'Description', 'Quantity', 'Unit Code', 'Unit Price', 'Net Amount', 'Tax Category', 'VAT Rate %', 'VAT Amount', 'Gross Amount'],
    ...invoice.lines.map((l, idx) => [
      l.id || idx + 1,
      l.name,
      l.description ?? l.name,
      l.quantity,
      l.unitCode ?? 'C62',
      Number(l.unitPrice.toFixed(2)),
      Number(l.netAmount.toFixed(2)),
      l.taxCategoryCode,
      l.vatRatePercent,
      Number(l.vatAmount.toFixed(2)),
      Number((l.netAmount + l.vatAmount).toFixed(2)),
    ]),
    ['', 'TOTAL', '', '', '', '', netTotal, '', '', vatTotal, grossTotal],
  ];
  const wsLines = XLSX.utils.aoa_to_sheet(lineRows);
  wsLines['!cols'] = [{ wch: 8 }, { wch: 26 }, { wch: 36 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 11 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsLines, 'Lines');

  const vatRows: (string | number)[][] = [
    ['Tax Category Code', 'Category Description', 'VAT Rate %', `Taxable Amount (${invoice.currency})`, `Tax Amount (${invoice.currency})`],
    ...Array.from(byCat.values()).map(g => [
      g.code,
      TAX_CATEGORY_NAME[g.code] ?? g.code,
      g.rate,
      Number(g.taxable.toFixed(2)),
      Number(g.tax.toFixed(2)),
    ]),
    ['TOTAL', '', '', netTotal, vatTotal],
  ];
  const wsVat = XLSX.utils.aoa_to_sheet(vatRows);
  wsVat['!cols'] = [{ wch: 18 }, { wch: 24 }, { wch: 12 }, { wch: 22 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsVat, 'VAT Summary');

  const valRows: string[][] = [
    ['Severity', 'Message'],
    ...result.errors.map(m => ['ERROR', m]),
    ...result.warnings.map(m => ['WARNING', m]),
    ...(result.errors.length === 0 && result.warnings.length === 0 ? [['OK', 'All UAE MoF / FTA PINT-UAE checks passed.']] : []),
  ];
  const wsVal = XLSX.utils.aoa_to_sheet(valRows);
  wsVal['!cols'] = [{ wch: 12 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, wsVal, 'Validation');

  const xmlLines = (result.xml ?? '<!-- XML not generated due to validation errors -->').split(/\r?\n/);
  const wsXml = XLSX.utils.aoa_to_sheet([['UBL 2.1 / PINT-UAE XML'], ...xmlLines.map(l => [l])]);
  wsXml['!cols'] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, wsXml, 'XML');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
