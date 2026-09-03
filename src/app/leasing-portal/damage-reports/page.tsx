'use client';

import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, AlertCircle } from 'lucide-react';

interface DamageReport {
  id: string; contractId: string; severity: string; description: string;
  status: string; createdAt: string;
}
interface Contract { id: string; contractNumber: string | null }

const SEVERITY_COLOR: Record<string, string> = {
  MINOR: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  MODERATE: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  SEVERE: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
};

export default function DamageReportsPage() {
  const [reports, setReports] = useState<DamageReport[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [contractId, setContractId] = useState('');
  const [severity, setSeverity] = useState<'MINOR' | 'MODERATE' | 'SEVERE'>('MODERATE');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, cRes] = await Promise.all([
        fetch('/api/leasing-portal/damage-reports'),
        fetch('/api/leasing-portal/contracts'),
      ]);
      setReports(rRes.ok ? await rRes.json() : []);
      setContracts(cRes.ok ? await cRes.json() : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!contractId || !description.trim()) {
      setToast({ type: 'err', msg: 'Pick a contract and describe the damage.' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/leasing-portal/damage-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId, severity, description }),
      });
      const data = await res.json();
      if (!res.ok) { setToast({ type: 'err', msg: data.error ?? 'Failed to submit' }); return; }
      setToast({ type: 'ok', msg: 'Report submitted — your account manager has been notified.' });
      setDescription('');
      void load();
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Damage reports</h1>

      {toast && (
        <div className={`rounded-lg px-3 py-2 text-sm flex items-center gap-2 ${toast.type === 'ok' ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'}`}>
          {toast.type === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Report new damage</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <select value={contractId} onChange={e => setContractId(e.target.value)}
            className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
            <option value="">Select contract…</option>
            {contracts.map(c => <option key={c.id} value={c.id}>{c.contractNumber ?? c.id.slice(0, 8)}</option>)}
          </select>
          <select value={severity} onChange={e => setSeverity(e.target.value as typeof severity)}
            className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
            <option value="MINOR">Minor</option>
            <option value="MODERATE">Moderate</option>
            <option value="SEVERE">Severe</option>
          </select>
        </div>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
          placeholder="Describe what happened…"
          className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
        <button onClick={submit} disabled={submitting}
          className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-medium">
          {submitting ? 'Submitting…' : 'Submit report'}
        </button>
      </div>

      <div className="space-y-2">
        {reports.length === 0 && <div className="text-slate-500">No damage reports filed.</div>}
        {reports.map(r => (
          <div key={r.id} className="p-3 rounded-lg bg-slate-800/40 border border-slate-700">
            <div className="flex items-center justify-between mb-1">
              <span className={`text-xs px-2 py-0.5 rounded-full border ${SEVERITY_COLOR[r.severity]}`}>{r.severity}</span>
              <span className="text-xs text-slate-500">{r.createdAt?.slice(0, 10)} · {r.status}</span>
            </div>
            <p className="text-sm text-slate-300">{r.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
