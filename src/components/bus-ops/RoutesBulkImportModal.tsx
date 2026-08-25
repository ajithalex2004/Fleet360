'use client';

/**
 * RoutesBulkImportModal — bulk-import staff-transport BusRoutes from CSV / XLSX.
 *
 * Flow:
 *   1. User picks a file (.csv, .xlsx, or .xls) via the file input. Rejected
 *      up front on extension and size (see ACCEPTED_EXTENSIONS /
 *      MAX_FILE_SIZE_BYTES) before it's handed to the parser. We then parse
 *      client-side with SheetJS (`xlsx`, installed from SheetJS's own CDN —
 *      see package.json — because the last npm-registry release, 0.18.5,
 *      carries known prototype-pollution and ReDoS advisories that this
 *      pinned 0.20.3 build fixes) — normalise header names to the canonical
 *      set, coerce Excel time cells to HH:MM 24h.
 *   2. Preview panel shows count summary + per-row errors. User can iterate on
 *      the source file and re-pick it; nothing hits the DB yet (dryRun POST).
 *   3. Import button POSTs to /api/bus-ops/routes/bulk-import with an
 *      idempotencyKey (generated per open) so a retry after a network blip
 *      is safe.
 *
 * Each row becomes TWO routes: OUTBOUND (morning fromLocation → unitName)
 * and INBOUND (evening return, swapped). Origin/destination lat/lng ride on
 * RouteStop rows so the Fleet Planner can consume the imports immediately
 * without a re-geocode.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { X, Download, Upload, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

// Rejected before the file ever reaches XLSX.read() — see the comment in
// handleFile for why this matters for a client-side spreadsheet parser.
const ACCEPTED_EXTENSIONS = new Set(['.csv', '.xlsx', '.xls']);
const MAX_FILE_SIZE_BYTES = 10 * 1_048_576; // 10 MB
// Mirrors MAX_ROWS in the bulk-import API route. Enforced here too so an
// oversized file is rejected before the full round trip to the server.
const MAX_IMPORT_ROWS = 2000;

// ── Canonical column set ─────────────────────────────────────────────────────
//
// Header aliases live client-side because ops paste from whatever spreadsheet
// they have and we want to accept it without a schema round-trip. The mapper
// normalises (lowercase + strip non-alphanumerics) both sides before matching.

const CANONICAL_HEADERS = [
  'unitName',
  'fromLocation',
  'fromLat', 'fromLng',
  'dropOffLocation',
  'dropOffLat', 'dropOffLng',
  'pickupTime', 'dropOffTime',
  'returnPickupTime', 'returnArrivalTime',
  'capacity',
  'daysOfWeek',
  'frequency',
  'routeCode',
  'requiredVehicleGroup',
  'requiredLicenseType',
  'notes',
] as const;

const HEADER_ALIASES: Record<string, string[]> = {
  unitName: ['unit name', 'unit', 'workplace', 'destination', 'site', 'workplace name'],
  fromLocation: ['from', 'from location', 'origin', 'pickup location', 'accommodation'],
  fromLat: ['from lat', 'from latitude', 'origin lat', 'pickup lat'],
  fromLng: ['from lng', 'from long', 'from longitude', 'origin lng', 'pickup lng', 'from lon'],
  dropOffLocation: ['drop off location', 'dropoff location', 'destination location', 'to location', 'to'],
  dropOffLat: ['drop off lat', 'dropoff lat', 'drop off latitude', 'destination lat'],
  dropOffLng: ['drop off lng', 'dropoff lng', 'drop off longitude', 'destination lng', 'dropoff lon'],
  pickupTime: ['pick up time', 'pickup time', 'departure time', 'morning pickup'],
  dropOffTime: ['drop off time', 'dropoff time', 'arrival time', 'morning arrival'],
  returnPickupTime: ['return pick up time', 'return pickup time', 'evening pickup', 'return time'],
  returnArrivalTime: ['return arrival time', 'return drop off time', 'evening arrival'],
  capacity: ['staff count', 'total staff count', 'seats', 'headcount', 'capacity',
             'staff count male & female accommodation'],
  daysOfWeek: ['days of the week', 'days', 'weekdays', 'days of week'],
  frequency: ['trip frequency', 'frequency'],
  routeCode: ['route code', 'code'],
  requiredVehicleGroup: ['vehicle group', 'required vehicle group'],
  requiredLicenseType: ['license type', 'required license type', 'licence type'],
  notes: ['notes', 'remarks', 'comments'],
};

function normHeader(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function buildHeaderMap(headers: string[]): Map<string, string | null> {
  const byNorm = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    byNorm.set(normHeader(canonical), canonical);
    for (const a of aliases) byNorm.set(normHeader(a), canonical);
  }
  const map = new Map<string, string | null>();
  for (const h of headers) map.set(h, byNorm.get(normHeader(h)) ?? null);
  return map;
}

// ── Cell coercion ───────────────────────────────────────────────────────────
//
// Excel time cells arrive as numbers (fraction of a day) when the workbook
// was authored with a time format, and as strings ("3:45 AM", "14:45 PM")
// when they were pasted from another source. We accept both.

function excelTimeToHm(cell: unknown): string | null {
  if (cell == null || cell === '') return null;

  // Numeric time: fraction of a 24h day. e.g. 0.15625 == 03:45.
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    const totalMin = Math.round(cell * 24 * 60);
    const clamped = ((totalMin % 1440) + 1440) % 1440;
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  const raw = String(cell).trim();
  if (!raw) return null;

  // "3:45 AM", "5:15 PM", "05:00 am", "14:45 PM" (garbage PM tolerated),
  // "14:30", "1430" — all collapse to HH:MM 24h.
  const m = /^(\d{1,2})[:.]?(\d{2})\s*(am|pm)?\s*$/i.exec(raw);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const meridiem = m[3]?.toLowerCase();
  if (Number.isNaN(h) || Number.isNaN(min) || min < 0 || min > 59) return null;

  if (meridiem === 'am') {
    if (h === 12) h = 0;
  } else if (meridiem === 'pm') {
    // "14:45 PM" is nonsense but common in the wild — trust the 24h reading
    // when the hour is already ≥ 13.
    if (h < 12) h += 12;
  }
  if (h < 0 || h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function coerceNumber(cell: unknown): number | null {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  const n = Number(String(cell).trim());
  return Number.isFinite(n) ? n : null;
}
function coerceString(cell: unknown): string {
  if (cell == null) return '';
  return String(cell).trim();
}

// ── Types ───────────────────────────────────────────────────────────────────

export type CanonicalHeader = typeof CANONICAL_HEADERS[number];

export interface CanonicalRow {
  __row: number;                     // 1-based row number in the sheet (excl header)
  unitName?: string;
  fromLocation?: string;
  fromLat?: number;
  fromLng?: number;
  dropOffLocation?: string;
  dropOffLat?: number;
  dropOffLng?: number;
  pickupTime?: string;
  dropOffTime?: string;
  returnPickupTime?: string;
  returnArrivalTime?: string;
  capacity?: number;
  daysOfWeek?: string;
  frequency?: string;
  routeCode?: string;
  requiredVehicleGroup?: string;
  requiredLicenseType?: string;
  notes?: string;
  __errors: string[];                 // client-side pre-flight errors
}

interface RowError { row: number; direction?: 'OUTBOUND' | 'INBOUND'; input: unknown; error: string }
interface ImportResult {
  total: number;
  plannedRoutes: number;
  created: number;
  skipped: number;
  errored: number;
  errors: RowError[];
  dryRun: boolean;
  idempotencyKey?: string;
  replayed?: boolean;
}

// ── Parser ──────────────────────────────────────────────────────────────────

function parseWorkbook(buffer: ArrayBuffer): { headers: string[]; unknownHeaders: string[]; rows: CanonicalRow[] } {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], unknownHeaders: [], rows: [] };
  const ws = wb.Sheets[sheetName];
  const grid: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
  if (grid.length === 0) return { headers: [], unknownHeaders: [], rows: [] };

  const headerRow = grid[0].map(v => coerceString(v));
  const headerMap = buildHeaderMap(headerRow);
  const unknownHeaders = headerRow.filter(h => h && headerMap.get(h) === null);

  const rows: CanonicalRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const raw = grid[i];
    if (!raw || raw.every(c => c == null || c === '')) continue;
    const canonical: Record<string, unknown> = {};
    headerRow.forEach((h, ci) => {
      const key = headerMap.get(h);
      if (!key) return;
      canonical[key] = raw[ci];
    });
    const errs: string[] = [];
    const cr: CanonicalRow = { __row: i + 1, __errors: errs };

    const timeFields: CanonicalHeader[] = ['pickupTime', 'dropOffTime', 'returnPickupTime', 'returnArrivalTime'];
    for (const f of timeFields) {
      const hm = excelTimeToHm(canonical[f]);
      if (hm) (cr as any)[f] = hm;
      else if (canonical[f] != null && canonical[f] !== '') {
        errs.push(`${f}: could not parse "${String(canonical[f])}" as a time`);
      }
    }

    const numFields: CanonicalHeader[] = ['fromLat', 'fromLng', 'dropOffLat', 'dropOffLng', 'capacity'];
    for (const f of numFields) {
      const n = coerceNumber(canonical[f]);
      if (n != null) (cr as any)[f] = n;
      else if (canonical[f] != null && canonical[f] !== '') {
        errs.push(`${f}: not a number ("${String(canonical[f])}")`);
      }
    }

    const strFields: CanonicalHeader[] = ['unitName', 'fromLocation', 'dropOffLocation', 'daysOfWeek', 'frequency',
      'routeCode', 'requiredVehicleGroup', 'requiredLicenseType', 'notes'];
    for (const f of strFields) {
      const s = coerceString(canonical[f]);
      if (s) (cr as any)[f] = s;
    }

    // Required-field pre-flight (mirrors server; catches obvious problems
    // before the round trip).
    const required: CanonicalHeader[] = ['unitName', 'fromLocation',
      'fromLat', 'fromLng', 'dropOffLocation', 'dropOffLat', 'dropOffLng',
      'pickupTime', 'dropOffTime', 'returnPickupTime'];
    for (const f of required) {
      if (cr[f] == null || cr[f] === '') errs.push(`${f} is required`);
    }

    rows.push(cr);
  }
  return { headers: headerRow, unknownHeaders, rows };
}

// ── Template CSV ────────────────────────────────────────────────────────────

const TEMPLATE_HEADERS = [
  'Unit Name',
  'From Location',
  'From Lat', 'From Lng',
  'Drop Off Location',
  'Drop Off Lat', 'Drop Off Lng',
  'Pick Up Time', 'Drop Off Time',
  'Return Pick Up Time', 'Return Arrival Time',
  'Staff Count',
  'Days of the Week',
  'Trip Frequency',
  'Route Code',
  'Required Vehicle Group',
  'Required License Type',
  'Notes',
];
const TEMPLATE_SAMPLE = [
  'Atlantis the Palm',
  'Al Khail Gate Accommodation',
  '25.1128', '55.1969',
  'Atlantis the Palm',
  '25.1308', '55.1170',
  '03:45', '04:00',
  '12:45', '13:30',
  '16',
  'Mon-Sat',
  'Daily',
  '',
  'BUS',
  'LIGHT',
  'Morning + evening return',
];

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadTemplateCsv() {
  const csv = [
    TEMPLATE_HEADERS.join(','),
    TEMPLATE_SAMPLE.map(v => v.includes(',') ? `"${v}"` : v).join(','),
  ].join('\n') + '\n';
  saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'routes-import-template.csv');
}

function downloadTemplateXlsx() {
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, TEMPLATE_SAMPLE]);
  // Reasonable column widths so ops don't have to auto-fit before entering data.
  ws['!cols'] = [
    { wch: 28 }, { wch: 32 },
    { wch: 12 }, { wch: 12 }, { wch: 28 }, { wch: 12 }, { wch: 12 },
    { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 18 },
    { wch: 12 }, { wch: 18 }, { wch: 14 },
    { wch: 12 }, { wch: 22 }, { wch: 20 }, { wch: 40 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Routes');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  saveBlob(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    'routes-import-template.xlsx',
  );
}

// ── Component ───────────────────────────────────────────────────────────────

export default function RoutesBulkImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<CanonicalRow[]>([]);
  const [unknownHeaders, setUnknownHeaders] = useState<string[]>([]);
  const [previewResult, setPreviewResult] = useState<ImportResult | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One key per modal open — retries within this open share the key, so a
  // duplicate POST caused by a network glitch replays instead of double-importing.
  const idempotencyKey = useMemo(() => `routes-bulk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, []);

  const validRows = useMemo(() => rows.filter(r => r.__errors.length === 0), [rows]);
  const invalidRows = useMemo(() => rows.filter(r => r.__errors.length > 0), [rows]);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setPreviewResult(null);
    setCommitResult(null);
    setFileName(file.name);

    // Checked before XLSX.read ever sees the bytes. The <input accept=...>
    // hint is advisory only — a user can still pick "All files" — and a
    // spreadsheet parser is a real attack surface against a file supplied
    // by any authenticated tenant user. Extension check is defense in
    // depth alongside the size cap, not a replacement for it: a small file
    // can still be adversarially crafted.
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.has(ext)) {
      setError(`Unsupported file type "${ext || file.name}". Use .csv, .xlsx, or .xls.`);
      setRows([]); setUnknownHeaders([]);
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`File is ${(file.size / 1_048_576).toFixed(1)} MB — the limit is ${MAX_FILE_SIZE_BYTES / 1_048_576} MB. Split it into smaller batches (server cap is ${MAX_IMPORT_ROWS} rows per import).`);
      setRows([]); setUnknownHeaders([]);
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseWorkbook(buffer);
      if (parsed.rows.length > MAX_IMPORT_ROWS) {
        setError(`File has ${parsed.rows.length} rows — the limit is ${MAX_IMPORT_ROWS} per import (matches the server's cap). Split it into smaller batches.`);
        setRows([]); setUnknownHeaders([]);
        return;
      }
      setRows(parsed.rows);
      setUnknownHeaders(parsed.unknownHeaders);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]); setUnknownHeaders([]);
    }
  }, []);

  const runPreview = useCallback(async () => {
    if (validRows.length === 0) return;
    setError(null);
    setPreviewResult(null);
    try {
      const res = await fetch('/api/bus-ops/routes/bulk-import?dryRun=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: validRows.map(({ __row, __errors, ...r }) => r) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? `HTTP ${res.status}`); return; }
      setPreviewResult(data as ImportResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [validRows]);

  const runCommit = useCallback(async () => {
    if (validRows.length === 0 || committing) return;
    setError(null);
    setCommitting(true);
    try {
      const res = await fetch(`/api/bus-ops/routes/bulk-import?idempotencyKey=${encodeURIComponent(idempotencyKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: validRows.map(({ __row, __errors, ...r }) => r) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? `HTTP ${res.status}`); return; }
      setCommitResult(data as ImportResult);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  }, [validRows, committing, idempotencyKey, onImported]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div>
            <h2 className="text-xl font-bold text-white">Import Routes</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Each row becomes two routes (morning outbound + evening inbound). Origin/destination lat/lng go on RouteStop rows so the Fleet Planner can use them immediately.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 text-sm font-semibold"
            >
              <Upload className="w-4 h-4" /> Choose file (.csv or .xlsx)
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.currentTarget.value = ''; }}
            />
            <button
              onClick={downloadTemplateXlsx}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 text-sm"
            >
              <Download className="w-4 h-4" /> Download Template (.xlsx)
            </button>
            <button
              onClick={downloadTemplateCsv}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 text-sm"
            >
              <Download className="w-4 h-4" /> Download Template (.csv)
            </button>
            {fileName && <span className="text-xs text-slate-400 truncate">{fileName}</span>}
          </div>

          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 px-3 py-2 text-sm">
              {error}
            </div>
          )}

          {rows.length > 0 && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <StatTile label="Total rows"   value={rows.length}          tone="slate" />
                <StatTile label="Ready to import" value={validRows.length}   tone="emerald" />
                <StatTile label="Rows with errors" value={invalidRows.length} tone="rose" />
              </div>

              {unknownHeaders.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    Unknown columns ignored: {unknownHeaders.join(', ')}. Rename them to match the template if you want them imported.
                  </span>
                </div>
              )}

              {invalidRows.length > 0 && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/5">
                  <div className="px-3 py-2 border-b border-rose-500/20 text-xs font-semibold text-rose-200">
                    {invalidRows.length} row{invalidRows.length === 1 ? '' : 's'} skipped — fix and re-upload
                  </div>
                  <ul className="max-h-32 overflow-y-auto divide-y divide-rose-500/10 text-xs">
                    {invalidRows.slice(0, 30).map(r => (
                      <li key={r.__row} className="px-3 py-1.5 flex gap-2">
                        <span className="text-rose-300 font-mono shrink-0">Row {r.__row}</span>
                        <span className="text-rose-200">{r.__errors.join('; ')}</span>
                      </li>
                    ))}
                    {invalidRows.length > 30 && <li className="px-3 py-1.5 text-rose-400">…and {invalidRows.length - 30} more</li>}
                  </ul>
                </div>
              )}

              {validRows.length > 0 && (
                <div className="rounded-lg border border-slate-700 overflow-hidden">
                  <div className="px-3 py-2 border-b border-slate-700 text-xs text-slate-400 flex items-center justify-between">
                    <span>Preview — will create {validRows.length * 2} routes ({validRows.length} outbound + {validRows.length} inbound)</span>
                  </div>
                  <div className="max-h-56 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-800/60 text-slate-300 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1.5">Row</th>
                          <th className="text-left px-2 py-1.5">From → Unit</th>
                          <th className="text-left px-2 py-1.5">Morning</th>
                          <th className="text-left px-2 py-1.5">Return</th>
                          <th className="text-left px-2 py-1.5">Seats</th>
                          <th className="text-left px-2 py-1.5">Days</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-200">
                        {validRows.slice(0, 100).map(r => (
                          <tr key={r.__row} className="border-t border-slate-800">
                            <td className="px-2 py-1 font-mono text-slate-500">{r.__row}</td>
                            <td className="px-2 py-1 truncate max-w-[220px]">{r.fromLocation} → {r.unitName}</td>
                            <td className="px-2 py-1">{r.pickupTime} → {r.dropOffTime}</td>
                            <td className="px-2 py-1">{r.returnPickupTime}{r.returnArrivalTime ? ` → ${r.returnArrivalTime}` : ''}</td>
                            <td className="px-2 py-1">{r.capacity ?? '—'}</td>
                            <td className="px-2 py-1 text-slate-400">{r.daysOfWeek ?? '—'}</td>
                          </tr>
                        ))}
                        {validRows.length > 100 && (
                          <tr><td colSpan={6} className="px-2 py-1.5 text-slate-500 text-center">…and {validRows.length - 100} more rows</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* A preview and a completed import previously rendered the same
                  layout, differing only in a colour and the words "Server
                  preview: " vs "Import complete: ". A preview reporting
                  "0 created, 14 planned, 0 errored" reads as success, and an
                  operator who stops there leaves believing the routes are
                  saved when nothing was written. The two states are now
                  visually and verbally distinct, and the preview names the
                  exact button still to be pressed. */}
              {(previewResult || commitResult) && (
                <div className={`rounded-lg border px-3 py-2 text-xs ${
                  commitResult
                    ? (commitResult.created === 0 && commitResult.errored > 0
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                        : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200')
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                }`}>
                  <div className="flex items-start gap-1.5">
                    {commitResult && commitResult.created > 0
                      ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />
                      : <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />}
                    <div>
                      <div className="font-semibold">
                        {commitResult
                          ? (commitResult.created === 0 && commitResult.errored > 0
                              ? 'Import failed — nothing was saved'
                              : commitResult.replayed
                                ? 'Already imported — this file was submitted before'
                                : commitResult.errored > 0
                                  ? 'Partially imported — some rows failed'
                                  : 'Import complete — routes saved')
                          : 'Preview only — nothing has been saved yet'}
                      </div>
                      <div className="mt-0.5">
                        {commitResult ? (
                          <>
                            <b>{commitResult.created}</b> created
                            {commitResult.skipped > 0 && <>, <b>{commitResult.skipped}</b> skipped</>}
                            {commitResult.errored > 0 && <>, <b>{commitResult.errored}</b> errored</>}.
                          </>
                        ) : (
                          <>
                            <b>{previewResult!.plannedRoutes}</b> route(s) would be created
                            {previewResult!.errored > 0 && <>, <b>{previewResult!.errored}</b> would fail</>}.
                          </>
                        )}
                      </div>
                      {!commitResult && (
                        <div className="mt-1">
                          Nothing has been written to the database. Click{' '}
                          <b>Import {validRows.length * 2} routes</b> to save them.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-slate-800 px-6 py-4 flex items-center justify-between gap-3 bg-slate-900/70">
          <div className="text-xs text-slate-500">
            {rows.length > 0 ? `${validRows.length}/${rows.length} rows ready` : 'No file loaded'}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={runPreview}
              disabled={validRows.length === 0 || committing}
              className="px-3 py-2 text-sm rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Server preview
            </button>
            <button
              onClick={runCommit}
              disabled={validRows.length === 0 || committing || !!commitResult}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {committing && <Loader2 className="w-4 h-4 animate-spin" />}
              {commitResult ? 'Imported ✓' : `Import ${validRows.length * 2} routes`}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-2 text-sm rounded-lg text-slate-300 hover:bg-slate-800"
            >
              {commitResult ? 'Close' : 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone: 'slate' | 'emerald' | 'rose' }) {
  const toneMap = {
    slate: 'border-slate-700 bg-slate-800/40 text-slate-100',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  } as const;
  return (
    <div className={`rounded-lg border ${toneMap[tone]} px-3 py-2`}>
      <div className="text-[11px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
