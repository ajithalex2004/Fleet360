'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Contract { id: string; contractNumber: string | null; }

const VIOLATION_TYPES = ['SPEEDING', 'PARKING', 'RED_LIGHT', 'SALIK', 'REGISTRATION', 'OTHER'] as const;
const AUTHORITIES = ['RTA', 'DUBAI_POLICE', 'ABU_DHABI_POLICE', 'SHARJAH_POLICE', 'OTHER'] as const;

export default function FieldFinePage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractId, setContractId] = useState('');
  const [violationDate, setViolationDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [violationType, setViolationType] = useState<typeof VIOLATION_TYPES[number]>('SPEEDING');
  const [authority, setAuthority] = useState<typeof AUTHORITIES[number]>('RTA');
  const [location, setLocation] = useState('');
  const [fineAmount, setFineAmount] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [billedToLessee, setBilledToLessee] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/leasing/contracts-v2')
      .then(r => r.ok ? r.json() : [])
      .then(d => {
        const list = Array.isArray(d) ? d : (d.contracts ?? []);
        setContracts(list.filter((c: { status?: string }) => c.status === 'ACTIVE'));
      })
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const fineAmt = parseFloat(fineAmount);
      const discountAmt = discountAmount ? parseFloat(discountAmount) : 0;
      const res = await fetch('/api/leasing/traffic-fines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractId: contractId || null,
          violationDate: new Date(violationDate).toISOString(),
          violationType,
          authority,
          location: location || null,
          fineAmount: fineAmt,
          discountAmount: discountAmt > 0 ? discountAmt : null,
          finalAmount: fineAmt - discountAmt,
          billedToLessee,
          notes: notes || null,
          billingStatus: 'PENDING',
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Save failed');
      }
      setMsg({ kind: 'ok', text: 'Fine logged. Sweep-bill will consolidate into an invoice.' });
      setFineAmount(''); setDiscountAmount(''); setLocation(''); setNotes('');
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Traffic Fine</h1>
        <p className="text-sm text-slate-400">Log a violation against a leased vehicle.</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Field label="Contract">
          <select value={contractId} onChange={e => setContractId(e.target.value)} className="input">
            <option value="">No contract (orphan fine)</option>
            {contracts.map(c => <option key={c.id} value={c.id}>{c.contractNumber ?? c.id.slice(0, 8)}</option>)}
          </select>
        </Field>

        <Field label="Violation Date">
          <input type="datetime-local" value={violationDate} onChange={e => setViolationDate(e.target.value)} className="input" />
        </Field>

        <Field label="Violation Type *">
          <div className="grid grid-cols-3 gap-2">
            {VIOLATION_TYPES.map(t => (
              <button type="button" key={t} onClick={() => setViolationType(t)}
                className={`py-2 rounded-lg text-xs font-medium border ${violationType === t ? 'bg-rose-600 border-rose-500 text-white' : 'bg-slate-800/60 border-white/10 text-slate-300'}`}>
                {t.replace('_', ' ')}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Authority *">
          <select required value={authority} onChange={e => setAuthority(e.target.value as typeof AUTHORITIES[number])} className="input">
            {AUTHORITIES.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
          </select>
        </Field>

        <Field label="Location">
          <input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. SZR Sector 5" className="input" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Fine Amount (AED) *">
            <input type="number" required inputMode="decimal" min={0} step="0.01" value={fineAmount} onChange={e => setFineAmount(e.target.value)} className="input text-xl font-mono" />
          </Field>
          <Field label="Discount">
            <input type="number" inputMode="decimal" min={0} step="0.01" value={discountAmount} onChange={e => setDiscountAmount(e.target.value)} className="input text-xl font-mono" />
          </Field>
        </div>

        <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/60 border border-white/10">
          <input type="checkbox" checked={billedToLessee} onChange={e => setBilledToLessee(e.target.checked)} className="w-5 h-5" />
          <div>
            <div className="text-sm font-medium">Bill to lessee</div>
            <div className="text-xs text-slate-400">Uncheck to absorb (e.g. company at fault)</div>
          </div>
        </label>

        <Field label="Notes">
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="input" />
        </Field>

        {msg && (
          <div className={`p-3 rounded-lg text-sm ${msg.kind === 'ok' ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-200 border border-rose-500/40'}`}>
            {msg.text}
          </div>
        )}

        <div className="flex gap-3">
          <button type="button" onClick={() => router.push('/leasing/field')} className="flex-1 py-3 rounded-xl border border-white/10 text-white">Cancel</button>
          <button type="submit" disabled={saving || !fineAmount} className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : 'Log Fine'}
          </button>
        </div>
      </form>

      <style jsx>{`
        .input { width: 100%; padding: 0.75rem 1rem; border-radius: 0.75rem; background: rgb(30 41 59 / 0.6); border: 1px solid rgb(255 255 255 / 0.1); color: white; }
        .input:focus { outline: none; border-color: rgb(225 29 72); }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">{label}</label>
      {children}
    </div>
  );
}
