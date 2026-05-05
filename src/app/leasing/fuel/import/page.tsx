'use client';

import React, { useState } from 'react';
import Link from 'next/link';

interface ImportSummary {
  detectedFormat: string;
  totalRows: number;
  imported: number;
  skippedDuplicate: number;
  skippedUnmatchedPlate: number;
  parseErrors: { row: number; reason: string }[];
  importErrors: { row: number; reason: string }[];
}

interface Contract { id: string; contractNumber: string | null; }

export default function FuelImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [defaultContractId, setDefaultContractId] = useState('');
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [wasDry, setWasDry] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    fetch('/api/leasing/contracts-v2')
      .then(r => r.ok ? r.json() : [])
      .then(d => {
        const list = Array.isArray(d) ? d : (d.contracts ?? []);
        setContracts(list.filter((c: { status?: string }) => c.status === 'ACTIVE'));
      })
      .catch(() => {});
  }, []);

  const upload = async (dryRun: boolean) => {
    if (!file) { setError('Pick a CSV file first'); return; }
    setBusy(true); setError(null); setSummary(null); setWasDry(dryRun);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (dryRun) fd.append('dryRun', '1');
      if (defaultContractId) fd.append('defaultContractId', defaultContractId);
      const res = await fetch('/api/leasing/fuel/import', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Import failed');
      setSummary(json.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white">Fuel CSV Import</h1>
          <p className="text-sm text-slate-400 mt-1">Bulk-load fuel-card transactions. ENOC SmartTAG, ADNOC Voyager, EMARAT FleetCard, and generic CSVs auto-detected.</p>
        </div>
        <Link href="/leasing/fuel" className="text-sm text-emerald-400 hover:underline">← Back to Fuel</Link>
      </div>

      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-2 font-semibold">CSV File *</label>
          <input
            type="file" accept=".csv,text/csv"
            onChange={e => { setFile(e.target.files?.[0] ?? null); setSummary(null); setError(null); }}
            className="block w-full text-sm text-white file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-emerald-600 file:text-white file:cursor-pointer hover:file:bg-emerald-500"
          />
          {file && <div className="text-xs text-slate-400 mt-2">Selected: <span className="font-mono">{file.name}</span> ({Math.round(file.size / 1024)} KB)</div>}
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-2 font-semibold">Fallback Contract</label>
          <select
            value={defaultContractId}
            onChange={e => setDefaultContractId(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white"
          >
            <option value="">None — skip rows with unmatched plates</option>
            {contracts.map(c => <option key={c.id} value={c.id}>{c.contractNumber ?? c.id.slice(0, 8)}</option>)}
          </select>
          <p className="text-[11px] text-slate-500 mt-1">Used when a row's plate doesn't match any LeaseContractVehicle.</p>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={() => upload(true)} disabled={!file || busy} className="px-5 py-2.5 rounded-xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-sm font-medium hover:bg-cyan-500/20 disabled:opacity-50">
            {busy && wasDry ? 'Previewing…' : 'Preview (Dry Run)'}
          </button>
          <button onClick={() => upload(false)} disabled={!file || busy} className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50">
            {busy && !wasDry ? 'Importing…' : 'Import'}
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-200 text-sm">{error}</div>
        )}
      </div>

      {summary && (
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold text-white">Result</h2>
            {wasDry && <span className="px-2 py-0.5 rounded-full text-xs bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">DRY RUN</span>}
            <span className="px-2 py-0.5 rounded-full text-xs bg-violet-500/20 text-violet-300 border border-violet-500/40">{summary.detectedFormat}</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Rows in file" value={summary.totalRows} />
            <Stat label={wasDry ? 'Would import' : 'Imported'} value={summary.imported} accent="emerald" />
            <Stat label="Duplicates skipped" value={summary.skippedDuplicate} accent="amber" />
            <Stat label="Unmatched plates" value={summary.skippedUnmatchedPlate} accent="rose" />
          </div>

          {summary.parseErrors.length > 0 && (
            <Errors title="Parse errors" rows={summary.parseErrors} />
          )}
          {summary.importErrors.length > 0 && (
            <Errors title="Import errors" rows={summary.importErrors} />
          )}

          {!wasDry && summary.imported > 0 && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/40 text-emerald-200 text-sm">
              ✓ Import complete. New rows are PENDING — run the fuel sweep-bill to consolidate into invoices.
            </div>
          )}
        </div>
      )}

      <div className="bg-slate-800/30 border border-white/5 rounded-xl p-5 text-xs text-slate-400 space-y-1">
        <p className="text-white font-semibold mb-1">Notes</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Headers are sniffed case-insensitive. Common variants: <code>Date / TransactionDate / TxnDate</code>, <code>Litres / Liters / Quantity / VolumeL</code>, <code>Amount / TotalAmount / Total AED</code>, <code>Plate / VehiclePlate</code>, <code>CardNumber / CardNo</code>.</li>
          <li>Dates accepted: ISO, DD/MM/YYYY, DD-MM-YYYY (with optional time / AM-PM).</li>
          <li>Dedup key: <code>(contractId, fuelDate, liters, fuelCardNo)</code> — re-uploading the same statement is safe.</li>
          <li>All imported rows default to <code>billedToLessee=true</code>, <code>billingStatus=PENDING</code>.</li>
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value, accent = 'slate' }: { label: string; value: number; accent?: string }) {
  const cls: Record<string, string> = { slate: 'text-white', emerald: 'text-emerald-300', amber: 'text-amber-300', rose: 'text-rose-300' };
  return (
    <div className="rounded-xl bg-slate-900/60 border border-white/10 p-4">
      <div className={`text-3xl font-bold ${cls[accent]}`}>{value}</div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  );
}

function Errors({ title, rows }: { title: string; rows: { row: number; reason: string }[] }) {
  return (
    <details className="rounded-xl bg-rose-500/5 border border-rose-500/30 p-3">
      <summary className="text-sm font-medium text-rose-300 cursor-pointer">{title} ({rows.length})</summary>
      <div className="mt-2 max-h-60 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="text-slate-400">
            <tr><th className="text-left pr-3">Row</th><th className="text-left">Reason</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-rose-500/10">
                <td className="py-1 pr-3 font-mono">{r.row}</td>
                <td className="py-1 text-slate-300">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
