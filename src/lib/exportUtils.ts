/**
 * Client-side export utilities — CSV and basic XLSX (tab-separated with BOM)
 * No server round-trip needed. Import in any 'use client' page.
 */

/** Download any data as CSV */
export function downloadCSV(filename: string, rows: Record<string, unknown>[], columns?: string[]) {
  if (!rows.length) return;
  const cols = columns ?? Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const header = cols.join(',');
  const body   = rows.map(r => cols.map(c => escape(r[c])).join(',')).join('\n');
  const blob   = new Blob(['\uFEFF' + header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
}

/** Download as TSV (opens cleanly in Excel on all locales) */
export function downloadTSV(filename: string, rows: Record<string, unknown>[], columns?: string[]) {
  if (!rows.length) return;
  const cols = columns ?? Object.keys(rows[0]);
  const escape = (v: unknown) => String(v ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ');
  const header = cols.join('\t');
  const body   = rows.map(r => cols.map(c => escape(r[c])).join('\t')).join('\n');
  const blob   = new Blob(['\uFEFF' + header + '\n' + body], { type: 'text/tab-separated-values;charset=utf-8;' });
  triggerDownload(blob, filename);
}

/** Minimal XLSX (SpreadsheetML XML — opens in Excel, LibreOffice, Google Sheets) */
export function downloadXLSX(filename: string, rows: Record<string, unknown>[], columns?: string[]) {
  if (!rows.length) return;
  const cols = columns ?? Object.keys(rows[0]);

  const xmlEsc = (v: unknown) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const cellType = (v: unknown) => typeof v === 'number' ? 'n' : 's';

  const headerRow = cols.map((c, i) => {
    const col = colLetter(i);
    return `<Cell ss:StyleID="header"><Data ss:Type="String">${xmlEsc(c)}</Data></Cell>`;
  }).join('');

  const dataRows = rows.map(r =>
    '<Row>' + cols.map((c, i) => {
      const v = r[c];
      const t = cellType(v);
      return `<Cell><Data ss:Type="${t === 'n' ? 'Number' : 'String'}">${xmlEsc(v)}</Data></Cell>`;
    }).join('') + '</Row>'
  ).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
          xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#1a5e47" ss:Pattern="Solid"/>
      <Font ss:Color="#FFFFFF" ss:Bold="1"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Export">
    <Table>
      <Row>${headerRow}</Row>
      ${dataRows}
    </Table>
  </Worksheet>
</Workbook>`;

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  triggerDownload(blob, filename.endsWith('.xls') ? filename : filename + '.xls');
}

/** UAE FTA VAT Return format (CSV as per FTA VAT201 structure) */
export function downloadFTAFormat(
  filename: string,
  data: {
    trn: string; period: string; taxable_supplies: number; output_vat: number;
    input_vat: number; net_vat: number; branches: Array<{ branch: string; taxable: number; vat: number }>;
  }
) {
  const rows = [
    { Field: 'TRN',                     Value: data.trn },
    { Field: 'Tax Period',              Value: data.period },
    { Field: 'Box 1 - Taxable Supplies (AED)', Value: data.taxable_supplies.toFixed(2) },
    { Field: 'Box 1a - Output VAT (AED)',      Value: data.output_vat.toFixed(2) },
    { Field: 'Box 9 - Input VAT (AED)',        Value: data.input_vat.toFixed(2) },
    { Field: 'Box 10 - Net VAT Payable (AED)', Value: data.net_vat.toFixed(2) },
    { Field: '', Value: '' },
    { Field: '--- Branch Breakdown ---', Value: '' },
    ...data.branches.map(b => ({ Field: b.branch, Value: `Taxable: ${b.taxable.toFixed(2)}  VAT: ${b.vat.toFixed(2)}` })),
  ];
  downloadCSV(filename, rows, ['Field', 'Value']);
}

function colLetter(n: number): string {
  let s = '';
  n++;
  while (n > 0) {
    s = String.fromCharCode(64 + (n % 26 || 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href    = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
