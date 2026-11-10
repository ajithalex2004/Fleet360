import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { generatePeppolUaeInvoiceXml, validatePintAeInvoice, type PeppolInvoiceData } from '@/lib/finance/peppol-e-invoice';
import { buildPeppolWorkbook } from '@/lib/finance/peppol-xlsx';
import { generateFtaTlvQrBase64, decodeFtaTlvQrBase64 } from '@/lib/finance/fta-qr';
import { buildFtaFafReport, serializeFtaFafCsv } from '@/lib/finance/fta-faf';

const invoice: PeppolInvoiceData = {
  invoiceNumber: 'INV-T-1',
  issueDate: '2026-09-01',
  currency: 'AED',
  seller: { name: 'Seller LLC', trn: '100123456700003', address: { street: 'Al Quoz', city: 'Dubai', countryCode: 'AE' } },
  buyer: { name: 'Buyer LLC', trn: '', address: { street: 'Musaffah', city: 'Abu Dhabi', countryCode: 'AE' } },
  lines: [
    { id: 1, name: 'Transport', quantity: 2, unitPrice: 500, netAmount: 1000, vatRatePercent: 5, vatAmount: 50, taxCategoryCode: 'S' },
    { id: 2, name: 'Export haulage', quantity: 1, unitPrice: 200, netAmount: 200, vatRatePercent: 0, vatAmount: 0, taxCategoryCode: 'Z' },
  ],
};

describe('buildPeppolWorkbook', () => {
  const result = generatePeppolUaeInvoiceXml(invoice);
  const wb = XLSX.read(buildPeppolWorkbook(invoice, result));

  it('produces the review sheets', () => {
    expect(result.isValid).toBe(true);
    expect(wb.SheetNames).toEqual(['Invoice', 'Lines', 'VAT Summary', 'Validation', 'XML']);
  });

  it('totals the lines and splits VAT by category', () => {
    const vat = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['VAT Summary'], { header: 1 });
    expect(vat).toContainEqual(['S', 'Standard rated', 5, 1000, 50]);
    expect(vat).toContainEqual(['Z', 'Zero rated', 0, 200, 0]);
    const inv = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Invoice, { header: 1 });
    expect(inv).toContainEqual(['Total amount (incl. VAT)', 1250]);
  });

  it('carries the full XML, one line per row', () => {
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.XML, { header: 1, blankrows: true });
    const xml = rows.slice(1).map(r => r[0] ?? '').join('\n');
    expect(xml).toContain('<cbc:ID>INV-T-1</cbc:ID>');
  });

  it('labels a sample', () => {
    const sample = XLSX.read(buildPeppolWorkbook(invoice, result, { sample: true }));
    const inv = XLSX.utils.sheet_to_json<unknown[]>(sample.Sheets.Invoice, { header: 1 });
    expect(inv[1]?.[0]).toBe('SAMPLE');
  });
});

describe('PINT AE / UBL 2.1 e-Invoice & FTA Compliance', () => {
  it('emits Peppol schemeID 0235, ISO 3166-2:AE CountrySubentity, AllowanceCharge discount, and multi-TaxSubtotal', () => {
    const res = generatePeppolUaeInvoiceXml({
      ...invoice,
      supplyDate: '2026-09-01',
      discountAmount: 100,
      paymentIban: 'AE070331234567890123456',
      seller: {
        ...invoice.seller,
        nameAr: 'شركة البائع ذ.م.م',
        corporateTaxTrn: '100123456700001',
        crn: 'CN-998877',
        crnSchemeId: 'DED-DXB',
        address: { street: 'Al Quoz', city: 'Dubai', state: 'AE-DU', postalCode: '00000', countryCode: 'AE' },
      },
      buyer: {
        ...invoice.buyer,
        trn: '100987654300003',
        address: { street: 'Musaffah', city: 'Abu Dhabi', state: 'AE-AZ', countryCode: 'AE' },
      },
    });
    expect(res.isValid).toBe(true);
    expect(res.xml).toContain('<cbc:EndpointID schemeID="0235">100123456700003</cbc:EndpointID>');
    expect(res.xml).toContain('<cbc:EndpointID schemeID="0235">100987654300003</cbc:EndpointID>');
    expect(res.xml).toContain('<cbc:CountrySubentity>AE-DU</cbc:CountrySubentity>');
    expect(res.xml).toContain('<cbc:CountrySubentity>AE-AZ</cbc:CountrySubentity>');
    expect(res.xml).toContain('<cac:AllowanceCharge>');
    expect(res.xml).toContain('<cbc:AllowanceTotalAmount currencyID="AED">100.00</cbc:AllowanceTotalAmount>');
    expect(res.xml).toContain('<cbc:ActualDeliveryDate>2026-09-01</cbc:ActualDeliveryDate>');
    expect(res.xml).toContain('schemeID="DED-DXB">CN-998877</cbc:CompanyID>');
    expect((res.qrCodeBase64 ?? '').length).toBeGreaterThan(20);
  });

  it('enforces BillingReference for Credit Note (381) and foreign currency AED TaxTotal', () => {
    const missingRefCn = validatePintAeInvoice({
      ...invoice,
      invoiceTypeCode: '381',
    });
    expect(missingRefCn.warnings.some(w => w.includes('BillingReference'))).toBe(true);

    const validFxCn = generatePeppolUaeInvoiceXml({
      ...invoice,
      invoiceTypeCode: '381',
      billingReference: {
        invoiceNumber: 'INV-ORIG-01',
        issueDate: '2026-08-15',
      },
      currency: 'USD',
      exchangeRate: 3.6725,
    });
    expect(validFxCn.isValid).toBe(true);
    expect(validFxCn.xml).toContain('<cac:BillingReference>');
    expect(validFxCn.xml).toContain('<cbc:ID>INV-ORIG-01</cbc:ID>');
    expect(validFxCn.xml).toContain('<cac:TaxExchangeRate>');
    expect(validFxCn.xml).toContain('<cbc:TaxAmount currencyID="AED">');
  });

  it('encodes and decodes UAE FTA TLV Base64 QR payload (Tags 1-8)', () => {
    const b64 = generateFtaTlvQrBase64({
      sellerName: 'EXL Solutions LLC',
      sellerTrn: '100123456700003',
      timestamp: '2026-09-01T10:00:00Z',
      totalWithVat: 1050,
      vatTotal: 50,
      xmlHash: 'abc123hash',
    });
    const decoded = decodeFtaTlvQrBase64(b64);
    expect(decoded.sellerName).toBe('EXL Solutions LLC');
    expect(decoded.sellerTrn).toBe('100123456700003');
    expect(decoded.totalWithVat).toBe('1050.00');
    expect(decoded.vatTotal).toBe('50.00');
    expect(decoded.xmlHash).toBe('abc123hash');
  });

  it('builds UAE FTA Audit File (FAF v1.0.0) and Form VAT 201 Box 1a-1g breakdown', () => {
    const faf = buildFtaFafReport(
      {
        companyNameEn: 'Seller LLC',
        trn: '100123456700003',
        periodStart: '2026-07-01',
        periodEnd: '2026-09-30',
        defaultEmirate: 'Dubai',
      },
      [
        {
          customerName: 'Buyer A',
          customerTrn: '100987654300003',
          invoiceDate: '2026-09-01',
          invoiceNo: 'INV-1',
          lineNo: 1,
          description: 'Standard Supply Dubai',
          supplyValueAed: 1000,
          vatValueAed: 50,
          taxCode: 'SR',
          emirate: 'Dubai',
        },
        {
          customerName: 'Buyer B',
          invoiceDate: '2026-09-05',
          invoiceNo: 'INV-2',
          lineNo: 1,
          description: 'Zero Rated Export',
          supplyValueAed: 500,
          vatValueAed: 0,
          taxCode: 'ZR',
          emirate: 'Abu Dhabi',
        },
      ],
      [
        {
          supplierName: 'Fuel Corp',
          supplierTrn: '100111222300003',
          invoiceDate: '2026-09-02',
          invoiceNo: 'BILL-1',
          lineNo: 1,
          description: 'Fleet Diesel',
          purchaseValueAed: 400,
          vatValueAed: 20,
          taxCode: 'SR',
        },
      ],
    );
    const dubaiBox = faf.vat201Boxes.box1StandardRatedByEmirate.find(b => b.box === '1b');
    expect(dubaiBox?.amountAed).toBe(1000);
    expect(dubaiBox?.vatAmountAed).toBe(50);
    expect(faf.vat201Boxes.box6ZeroRatedSupplies.amountAed).toBe(500);
    expect(faf.vat201Boxes.box9StandardRatedExpenses.recoverableVatAed).toBe(20);
    expect(faf.vat201Boxes.box14NetVatPayableOrRefundable).toBe(30);

    const csv = serializeFtaFafCsv(faf);
    expect(csv).toContain('CompInfoStart');
    expect(csv).toContain('FAF v1.0.0');
    expect(csv).toContain('1b,Standard rated supplies in Dubai,Dubai,1000.00,50.00,0.00');
  });
});
