/**
 * Excel (.xlsx) rendering of a UAE Peppol PINT-UAE e-invoice.
 *
 * The XML is the document that is exchanged with the Peppol network; this
 * workbook is the human-readable companion for review in Excel: header,
 * parties, lines, VAT summary, validation result, and the XML itself.
 */
import * as XLSX from 'xlsx';
import type { PeppolInvoiceData, PeppolValidationResult } from './peppol-e-invoice';

const TAX_CATEGORY: Record<string, string> = {
  S: 'Standard rated',
  Z: 'Zero rated',
  E: 'Exempt',
  O: 'Out of scope',
};

// Excel caps a cell at 32,767 characters, so the XML goes one line per row.
const MAX_CELL = 32000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sheet(rows: unknown[][], widths: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = widths.map(wch => ({ wch }));
  return ws;
}

export function buildPeppolWorkbook(
  data: PeppolInvoiceData,
  result: PeppolValidationResult,
  opts: { sample?: boolean } = {},
): Buffer {
  const net = round2(data.lines.reduce((s, l) => s + Number(l.netAmount), 0));
  const vat = round2(data.lines.reduce((s, l) => s + Number(l.vatAmount), 0));
  const total = round2(net + vat);

  const party = (label: string, p: PeppolInvoiceData['seller']): unknown[][] => [
    [label, ''],
    ['Legal name', p.name],
    ['TRN', p.trn || ''],
    ['Trade licence / CRN', p.crn || ''],
    ['Street', p.address.street],
    ['City', p.address.city],
    ['Emirate', p.address.state || ''],
    ['Country', p.address.countryCode],
    ['Contact', p.contact?.name || ''],
    ['Email', p.contact?.email || ''],
    ['Phone', p.contact?.phone || ''],
    [],
  ];

  const invoiceRows: unknown[][] = [
    ['UAE MoF & FTA Peppol E-Invoice (PINT-UAE)', ''],
    ...(opts.sample ? [['SAMPLE', 'Illustrative data only — not a real tax invoice']] : []),
    [],
    ['Invoice number', data.invoiceNumber],
    ['Invoice type', '380 — Commercial invoice'],
    ['Issue date', data.issueDate],
    ['Due date', data.dueDate || ''],
    ['Currency', data.currency],
    ['Profile', 'urn:peppol:pint:billing-1@ae-1'],
    ['Contract reference', data.referenceContractNo || ''],
    [],
    ...party('SELLER', data.seller),
    ...party('BUYER', data.buyer),
    ['TOTALS', ''],
    ['Net amount (excl. VAT)', net],
    ['VAT amount', vat],
    ['Total amount (incl. VAT)', total],
    ['Amount payable', total],
    [],
    ['Notes', data.notes || ''],
  ];

  const lineRows: unknown[][] = [
    ['#', 'Item', 'Description', 'Quantity', 'Unit price', 'Net amount', 'VAT %', 'VAT amount', 'Line total', 'Tax category'],
    ...data.lines.map(l => [
      l.id,
      l.name,
      l.description || '',
      Number(l.quantity),
      Number(l.unitPrice),
      Number(l.netAmount),
      Number(l.vatRatePercent),
      Number(l.vatAmount),
      round2(Number(l.netAmount) + Number(l.vatAmount)),
      `${l.taxCategoryCode} — ${TAX_CATEGORY[l.taxCategoryCode] ?? ''}`,
    ]),
    [],
    ['', '', 'Totals', '', '', net, '', vat, total, ''],
  ];

  const byRate = new Map<string, { code: string; rate: number; taxable: number; vat: number }>();
  for (const l of data.lines) {
    const key = `${l.taxCategoryCode}-${l.vatRatePercent}`;
    const cur = byRate.get(key) ?? { code: l.taxCategoryCode, rate: Number(l.vatRatePercent), taxable: 0, vat: 0 };
    cur.taxable += Number(l.netAmount);
    cur.vat += Number(l.vatAmount);
    byRate.set(key, cur);
  }
  const vatRows: unknown[][] = [
    ['Tax category', 'Description', 'VAT rate %', 'Taxable amount', 'VAT amount'],
    ...[...byRate.values()].map(r => [
      r.code, TAX_CATEGORY[r.code] ?? '', r.rate, round2(r.taxable), round2(r.vat),
    ]),
    [],
    ['', 'Total', '', net, vat],
  ];

  const validationRows: unknown[][] = [
    ['Check', 'Result'],
    ['Valid PINT-UAE document', result.isValid ? 'Yes' : 'No'],
    ['SHA-256 digest', result.digestHash || ''],
    ...result.errors.map(e => ['Error', e]),
    ...result.warnings.map(w => ['Warning', w]),
    ...(result.errors.length + result.warnings.length === 0 ? [['Findings', 'None']] : []),
  ];

  const xmlRows: unknown[][] = [['Peppol UBL 2.1 XML']];
  for (const line of (result.xml || '').split('\n')) {
    for (let i = 0; i < Math.max(line.length, 1); i += MAX_CELL) {
      xmlRows.push([line.slice(i, i + MAX_CELL)]);
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(invoiceRows, [28, 60]), 'Invoice');
  XLSX.utils.book_append_sheet(wb, sheet(lineRows, [5, 32, 40, 10, 12, 14, 8, 12, 14, 22]), 'Lines');
  XLSX.utils.book_append_sheet(wb, sheet(vatRows, [14, 18, 12, 16, 14]), 'VAT Summary');
  XLSX.utils.book_append_sheet(wb, sheet(validationRows, [26, 90]), 'Validation');
  XLSX.utils.book_append_sheet(wb, sheet(xmlRows, [140]), 'XML');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
