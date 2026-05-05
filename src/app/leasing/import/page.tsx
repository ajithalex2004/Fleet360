'use client';

import { useState } from 'react';
import { Upload, FileWarning, FileCheck2, Database, Send } from 'lucide-react';

type Resource = 'vehicles' | 'lessees';

interface PreviewRow {
  row: number;
  raw: Record<string, string>;
  parsed?: any;
  errors: { row: number; path: string; message: string }[];
}

interface PreviewResult {
  mode: 'preview';
  totalRows: number;
  validRows: number;
  invalidRows: number;
  detectedHeaders: string[];
  unknownHeaders: string[];
  rows: PreviewRow[];
  errors: { row: number; path: string; message: string }[];
}

interface CommitResult {
  mode: 'commit';
  inserted: number;
  skipped: number;
  errors: { row: number; path: string; message: string }[];
}

const RESOURCE_LABELS: Record<Resource, string> = {
  vehicles: 'Vehicles',
  lessees: 'Lessees (B2B + B2C)',
};

const RESOURCE_HINTS: Record<Resource, string[]> = {
  vehicles: [
    'Required: make, model, licensePlate',
    'Optional: type, year, vin, color, fuelType, vehicleUsage, vehicleGroup, vehicleClass, seatingCapacity, status, currentMileage',
    'Aliases accepted: brand→make, plate→licensePlate, mileage→currentMileage, etc.',
  ],
  lessees: [
    'Required: name, type (corporate|individual)',
    'Corporate: tradeLicense required',
    'Individual: emiratesId + nationality required',
    'Optional: email, phone, address, contactPerson, licenseNo (individual)',
    'Aliases accepted: company name→name, b2b→corporate, b2c→individual, eid→emiratesId, etc.',
  ],
};

export default function LeasingImportPage() {
  const [resource, setResource] = useState<Resource>('vehicles');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(mode: 'preview' | 'commit') {
    if (!file) {
      setError('Pick a CSV file first.');
      return;
    }
    setBusy(true);
    setError(null);
    if (mode === 'preview') {
      setCommitResult(null);
    }

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', mode);
      const res = await fetch(`/api/leasing/import/${resource}`, { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Server returned ${res.status}`);
        return;
      }
      if (mode === 'preview') {
        setPreview(json as PreviewResult);
      } else {
        setCommitResult(json as CommitResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setCommitResult(null);
    setError(null);
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Database className="h-6 w-6" /> Bulk Import
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Upload a CSV → review → commit. Use this once per resource during initial data
          migration. The preview step never writes to the database.
        </p>
      </div>

      {/* Resource picker */}
      <div className="grid grid-cols-2 gap-3">
        {(['vehicles', 'lessees'] as const).map((r) => (
          <button
            key={r}
            onClick={() => { setResource(r); reset(); }}
            className={`p-4 rounded-xl border text-left transition ${
              resource === r
                ? 'bg-violet-600/20 border-violet-500 text-white'
                : 'bg-slate-800/40 border-slate-700 text-slate-300 hover:bg-slate-700/40'
            }`}
          >
            <div className="font-semibold">{RESOURCE_LABELS[r]}</div>
            <div className="text-xs text-slate-400 mt-1">{r}.csv</div>
          </button>
        ))}
      </div>

      {/* Format hint */}
      <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-4 text-xs space-y-1">
        <div className="font-semibold text-slate-300 mb-1">Expected CSV columns:</div>
        {RESOURCE_HINTS[resource].map((line, i) => (
          <div key={i} className="text-slate-400">• {line}</div>
        ))}
      </div>

      {/* File picker + actions */}
      <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-4">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setCommitResult(null); }}
          className="block w-full text-sm text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-slate-700 file:text-slate-200 hover:file:bg-slate-600"
        />
        {file && (
          <div className="mt-3 text-xs text-slate-400">
            Selected: <span className="text-slate-200">{file.name}</span> ({(file.size / 1024).toFixed(1)} KB)
          </div>
        )}
        <div className="mt-4 flex gap-3">
          <button
            disabled={!file || busy}
            onClick={() => handleSubmit('preview')}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2"
          >
            <Upload className="h-4 w-4" />
            {busy ? 'Working…' : '1. Preview'}
          </button>
          <button
            disabled={!preview || preview.validRows === 0 || busy}
            onClick={() => handleSubmit('commit')}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-40 flex items-center gap-2"
            title={!preview ? 'Run preview first' : preview.validRows === 0 ? 'Fix errors before committing' : ''}
          >
            <Send className="h-4 w-4" />
            2. Commit {preview ? `${preview.validRows}` : ''} valid rows
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-900/40 border border-rose-700 text-rose-200 rounded-xl p-4 text-sm">
          {error}
        </div>
      )}

      {/* Preview results */}
      {preview && !commitResult && (
        <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-300">
              <FileCheck2 className="inline h-4 w-4 text-emerald-400 mr-1" />
              {preview.validRows} valid
            </span>
            <span className="text-slate-300">
              <FileWarning className="inline h-4 w-4 text-amber-400 mr-1" />
              {preview.invalidRows} invalid
            </span>
            <span className="text-slate-500">/ {preview.totalRows} total rows</span>
          </div>

          {preview.unknownHeaders.length > 0 && (
            <div className="text-xs text-amber-300">
              ⚠ Unrecognised columns ignored: {preview.unknownHeaders.join(', ')}
            </div>
          )}

          {preview.invalidRows > 0 && (
            <div>
              <div className="text-sm font-semibold text-rose-300 mb-2">Per-row errors:</div>
              <div className="max-h-72 overflow-auto bg-slate-950/60 border border-slate-700 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-900 text-slate-300">
                    <tr>
                      <th className="px-3 py-2 text-left">Row</th>
                      <th className="px-3 py-2 text-left">Field</th>
                      <th className="px-3 py-2 text-left">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows
                      .filter((r) => r.errors.length > 0)
                      .flatMap((r) => r.errors.map((e, i) => (
                        <tr key={`${r.row}-${i}`} className="border-t border-slate-800">
                          <td className="px-3 py-1.5 text-slate-400 font-mono">{r.row}</td>
                          <td className="px-3 py-1.5 text-amber-300 font-mono">{e.path}</td>
                          <td className="px-3 py-1.5 text-slate-300">{e.message}</td>
                        </tr>
                      )))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Commit results */}
      {commitResult && (
        <div className="bg-emerald-900/30 border border-emerald-700 rounded-xl p-4 space-y-2">
          <div className="text-emerald-200 font-semibold">Import complete</div>
          <div className="text-sm text-emerald-100">
            ✓ Inserted: <strong>{commitResult.inserted}</strong> ·{' '}
            ✗ Skipped: <strong>{commitResult.skipped}</strong>
          </div>
          {commitResult.errors.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-emerald-200">
                {commitResult.errors.length} skip reasons
              </summary>
              <div className="mt-2 max-h-48 overflow-auto bg-slate-950/60 rounded">
                {commitResult.errors.map((e, i) => (
                  <div key={i} className="px-2 py-1 border-t border-slate-800">
                    Row {e.row} [{e.path}]: {e.message}
                  </div>
                ))}
              </div>
            </details>
          )}
          <button
            onClick={reset}
            className="mt-2 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs"
          >
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}
