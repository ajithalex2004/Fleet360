import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { generatePeppolUaeInvoiceXml, type PeppolInvoiceData } from '@/lib/finance/peppol-e-invoice';
import { buildPeppolWorkbook } from '@/lib/finance/peppol-xlsx';

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
