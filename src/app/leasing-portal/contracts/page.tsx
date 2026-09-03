'use client';

import { useEffect, useState, useCallback } from 'react';
import { FileText, CheckCircle2, AlertCircle } from 'lucide-react';

interface Vehicle { id: string; vehicleType: string; make: string | null; model: string | null; year: number | null }
interface Contract {
  id: string; contractNumber: string | null; status: string; leaseType: string | null;
  startDate: string; endDate: string; monthlyRate: number | string; currency: string | null;
  vehicles: Vehicle[];
}
interface Renewal {
  id: string; status: string; proposedStartDate: string; proposedEndDate: string;
  proposedMonthlyRate: number | string | null; newContractId: string | null;
  originalContractId: string;
  originalContract: { contractNumber: string | null };
}

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState<string | null>(null);
  const [signerName, setSignerName] = useState('');
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [requesting, setRequesting] = useState<{ contractId: string; type: 'RENEWAL' | 'TERMINATION' } | null>(null);
  const [requestNotes, setRequestNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, rRes] = await Promise.all([
        fetch('/api/leasing-portal/contracts'),
        fetch('/api/leasing-portal/renewals'),
      ]);
      setContracts(cRes.ok ? await cRes.json() : []);
      setRenewals(rRes.ok ? await rRes.json() : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const signRenewal = async (renewalId: string) => {
    if (!signerName.trim()) { setToast({ type: 'err', msg: 'Enter your full name to sign.' }); return; }
    const res = await fetch(`/api/leasing-portal/renewals/${renewalId}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signerName }),
    });
    const data = await res.json();
    if (!res.ok) { setToast({ type: 'err', msg: data.error ?? 'Failed to sign' }); return; }
    setToast({ type: 'ok', msg: 'Renewal signed — your new contract has been created.' });
    setSigning(null);
    setSignerName('');
    void load();
  };

  const submitRequest = async () => {
    if (!requesting) return;
    const res = await fetch('/api/leasing-portal/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractId: requesting.contractId, type: requesting.type, notes: requestNotes }),
    });
    const data = await res.json();
    if (!res.ok) { setToast({ type: 'err', msg: data.error ?? 'Failed to submit request' }); return; }
    setToast({ type: 'ok', msg: `Your ${requesting.type.toLowerCase()} request has been sent to your account manager.` });
    setRequesting(null);
    setRequestNotes('');
  };

  const pendingRenewalsFor = (contractId: string) =>
    renewals.filter(r => r.originalContractId === contractId && r.status !== 'ACCEPTED' && r.status !== 'REJECTED');

  if (loading) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Contracts</h1>

      {toast && (
        <div className={`rounded-lg px-3 py-2 text-sm flex items-center gap-2 ${toast.type === 'ok' ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'}`}>
          {toast.type === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {contracts.length === 0 && <div className="text-slate-500">No contracts on record.</div>}

      {contracts.map(c => {
        const myRenewals = pendingRenewalsFor(c.id);
        return (
          <div key={c.id} className="bg-slate-800/40 border border-slate-700 rounded-xl p-5 space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-cyan-400" />
                <div>
                  <div className="font-semibold">{c.contractNumber ?? c.id.slice(0, 8)}</div>
                  <div className="text-xs text-slate-400">{c.leaseType ?? '—'} · {c.startDate?.slice(0, 10)} → {c.endDate?.slice(0, 10)}</div>
                </div>
              </div>
              <span className="text-xs px-2 py-1 rounded-full bg-slate-700/60 border border-slate-600">{c.status}</span>
            </div>

            <div className="text-sm text-slate-300">
              {c.currency ?? 'AED'} {Number(c.monthlyRate).toLocaleString()}/month · {c.vehicles.length} vehicle{c.vehicles.length === 1 ? '' : 's'}
            </div>

            {c.vehicles.length > 0 && (
              <div className="text-xs text-slate-400">
                {c.vehicles.map(v => `${v.vehicleType}${v.make ? ` ${v.make}` : ''}${v.model ? ` ${v.model}` : ''}`).join(', ')}
              </div>
            )}

            {myRenewals.map(r => (
              <div key={r.id} className="mt-2 p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/20 space-y-2">
                <p className="text-sm text-cyan-200">
                  Renewal proposed: {r.proposedStartDate.slice(0, 10)} → {r.proposedEndDate.slice(0, 10)} at AED {Number(r.proposedMonthlyRate ?? 0).toLocaleString()}/month.
                </p>
                {signing === r.id ? (
                  <div className="flex gap-2">
                    <input
                      value={signerName}
                      onChange={e => setSignerName(e.target.value)}
                      placeholder="Type your full name to sign"
                      className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white"
                    />
                    <button onClick={() => signRenewal(r.id)} className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium">
                      Confirm & sign
                    </button>
                    <button onClick={() => setSigning(null)} className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 text-sm">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setSigning(r.id)} className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium">
                    Review & sign renewal
                  </button>
                )}
              </div>
            ))}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setRequesting({ contractId: c.id, type: 'RENEWAL' })}
                className="text-xs px-3 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-300"
              >
                Request renewal
              </button>
              <button
                onClick={() => setRequesting({ contractId: c.id, type: 'TERMINATION' })}
                className="text-xs px-3 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-300"
              >
                Request early termination
              </button>
            </div>
          </div>
        );
      })}

      {requesting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-md space-y-4">
            <h2 className="text-lg font-bold">
              {requesting.type === 'RENEWAL' ? 'Request a renewal' : 'Request early termination'}
            </h2>
            <p className="text-xs text-slate-400">
              Your account manager will review this and follow up with the details.
            </p>
            <textarea
              value={requestNotes}
              onChange={e => setRequestNotes(e.target.value)}
              rows={3}
              placeholder="Anything specific you'd like us to know?"
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
            />
            <div className="flex gap-2">
              <button onClick={submitRequest} className="flex-1 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium">
                Submit request
              </button>
              <button onClick={() => setRequesting(null)} className="flex-1 py-2 rounded-lg bg-slate-700 text-slate-300 text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
