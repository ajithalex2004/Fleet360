'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Contract { id: string; contractNumber: string | null; }

const READING_TYPES = ['DELIVERY', 'MONTHLY', 'EXCHANGE', 'RETURN', 'ADHOC'] as const;

export default function FieldMileagePage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractId, setContractId] = useState('');
  const [mileage, setMileage] = useState('');
  const [readingType, setReadingType] = useState<typeof READING_TYPES[number]>('MONTHLY');
  const [readingDate, setReadingDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [capturedBy, setCapturedBy] = useState('');
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
      const res = await fetch('/api/leasing/mileage-readings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractId,
          mileage: parseInt(mileage, 10),
          readingType,
          readingDate: new Date(readingDate).toISOString(),
          capturedBy: capturedBy || null,
          notes: notes || null,
          source: 'MANUAL',
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Save failed');
      }
      setMsg({ kind: 'ok', text: `Reading saved.${readingType === 'RETURN' || readingType === 'MONTHLY' ? ' Overage auto-billed if cap exceeded.' : ''}` });
      setMileage('');
      setNotes('');
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Mileage Reading</h1>
        <p className="text-sm text-slate-400">Capture odometer for a leased vehicle.</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Field label="Contract *">
          <select required value={contractId} onChange={e => setContractId(e.target.value)} className="input">
            <option value="">Select active contract</option>
            {contracts.map(c => (
              <option key={c.id} value={c.id}>{c.contractNumber ?? c.id.slice(0, 8)}</option>
            ))}
          </select>
        </Field>

        <Field label="Reading Type *">
          <div className="grid grid-cols-3 gap-2">
            {READING_TYPES.map(t => (
              <button
                type="button"
                key={t}
                onClick={() => setReadingType(t)}
                className={`py-2 rounded-lg text-xs font-medium border ${readingType === t ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-800/60 border-white/10 text-slate-300'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Odometer (km) *">
          <input
            type="number" required inputMode="numeric" min={0}
            value={mileage} onChange={e => setMileage(e.target.value)}
            placeholder="e.g. 45230"
            className="input text-2xl font-mono"
          />
        </Field>

        <Field label="Reading Date">
          <input type="datetime-local" value={readingDate} onChange={e => setReadingDate(e.target.value)} className="input" />
        </Field>

        <Field label="Captured by">
          <input value={capturedBy} onChange={e => setCapturedBy(e.target.value)} placeholder="Your name" className="input" />
        </Field>

        <Field label="Notes">
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="input" />
        </Field>

        {msg && (
          <div className={`p-3 rounded-lg text-sm ${msg.kind === 'ok' ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-200 border border-rose-500/40'}`}>
            {msg.text}
          </div>
        )}

        <div className="flex gap-3">
          <button type="button" onClick={() => router.push('/leasing/field')} className="flex-1 py-3 rounded-xl border border-white/10 text-white">
            Cancel
          </button>
          <button type="submit" disabled={saving || !contractId || !mileage} className="flex-1 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Reading'}
          </button>
        </div>
      </form>

      <style jsx>{`
        .input {
          width: 100%;
          padding: 0.75rem 1rem;
          border-radius: 0.75rem;
          background: rgb(30 41 59 / 0.6);
          border: 1px solid rgb(255 255 255 / 0.1);
          color: white;
        }
        .input:focus { outline: none; border-color: rgb(8 145 178); }
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
