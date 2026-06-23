/**
 * Client-side export utilities.
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
  const body = rows.map((r) => cols.map((c) => escape(r[c])).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, normalizeFilename(filename, '.csv'));
}

/** Download as TSV (opens cleanly in Excel on all locales) */
export function downloadTSV(filename: string, rows: Record<string, unknown>[], columns?: string[]) {
  if (!rows.length) return;
  const cols = columns ?? Object.keys(rows[0]);
  const escape = (v: unknown) => String(v ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ');
  const header = cols.join('\t');
  const body = rows.map((r) => cols.map((c) => escape(r[c])).join('\t')).join('\n');
  const blob = new Blob(['\uFEFF' + header + '\n' + body], { type: 'text/tab-separated-values;charset=utf-8;' });
  triggerDownload(blob, normalizeFilename(filename, '.tsv'));
}

/** Real XLSX workbook export */
export async function downloadXLSX(filename: string, rows: Record<string, unknown>[], columns?: string[]) {
  if (!rows.length) return;
  const cols = columns ?? Object.keys(rows[0]);
  const XLSX = await import('xlsx');

  const tableData = [
    cols,
    ...rows.map((row) => cols.map((column) => row[column] ?? '')),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(tableData);
  worksheet['!cols'] = cols.map((column) => ({
    wch: Math.max(
      column.length + 2,
      ...rows.map((row) => String(row[column] ?? '').length + 2),
    ),
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Export');
  XLSX.writeFileXLSX(workbook, normalizeFilename(filename, '.xlsx'), {
    compression: true,
  });
}

/** UAE FTA VAT Return format (CSV as per FTA VAT201 structure) */
export function downloadFTAFormat(
  filename: string,
  data: {
    trn: string;
    period: string;
    taxable_supplies: number;
    output_vat: number;
    input_vat: number;
    net_vat: number;
    branches: Array<{ branch: string; taxable: number; vat: number }>;
  },
) {
  const rows = [
    { Field: 'TRN', Value: data.trn },
    { Field: 'Tax Period', Value: data.period },
    { Field: 'Box 1 - Taxable Supplies (AED)', Value: data.taxable_supplies.toFixed(2) },
    { Field: 'Box 1a - Output VAT (AED)', Value: data.output_vat.toFixed(2) },
    { Field: 'Box 9 - Input VAT (AED)', Value: data.input_vat.toFixed(2) },
    { Field: 'Box 10 - Net VAT Payable (AED)', Value: data.net_vat.toFixed(2) },
    { Field: '', Value: '' },
    { Field: '--- Branch Breakdown ---', Value: '' },
    ...data.branches.map((b) => ({
      Field: b.branch,
      Value: `Taxable: ${b.taxable.toFixed(2)}  VAT: ${b.vat.toFixed(2)}`,
    })),
  ];
  downloadCSV(filename, rows, ['Field', 'Value']);
}

function normalizeFilename(filename: string, extension: '.csv' | '.tsv' | '.xlsx') {
  return filename.toLowerCase().endsWith(extension)
    ? filename
    : `${filename.replace(/\.(csv|tsv|xls|xlsx)$/i, '')}${extension}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
