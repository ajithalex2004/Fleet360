'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

interface Contract { id: string; contractNumber: string | null; }

export default function FieldFuelPage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractId, setContractId] = useState('');
  const [fuelDate, setFuelDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [liters, setLiters] = useState('');
  const [costPerLiter, setCostPerLiter] = useState('');
  const [station, setStation] = useState('');
  const [mileageAtFuel, setMileageAtFuel] = useState('');
  const [fuelCardNo, setFuelCardNo] = useState('');
  const [billedToLessee, setBilledToLessee] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const totalCost = useMemo(() => {
    const l = parseFloat(liters);
    const c = parseFloat(costPerLiter);
    return Number.isFinite(l) && Number.isFinite(c) ? (l * c).toFixed(2) : '—';
  }, [liters, costPerLiter]);

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
      const res = await fetch('/api/leasing/fuel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractId,
          fuelDate: new Date(fuelDate).toISOString(),
          liters: parseFloat(liters),
          costPerLiter: costPerLiter ? parseFloat(costPerLiter) : null,
          station: station || null,
          mileageAtFuel: mileageAtFuel ? parseInt(mileageAtFuel, 10) : null,
          fuelCardNo: fuelCardNo || null,
          billedToLessee,
          notes: notes || null,
          billingStatus: 'PENDING',
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Save failed');
      }
      setMsg({ kind: 'ok', text: 'Fuel log saved. Will be picked up by the next billing sweep.' });
      setLiters(''); setCostPerLiter(''); setStation(''); setMileageAtFuel(''); setNotes('');
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Fuel Log</h1>
        <p className="text-sm text-slate-400">Capture a refuelling event.</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Field label="Contract *">
          <select required value={contractId} onChange={e => setContractId(e.target.value)} className="input">
            <option value="">Select active contract</option>
            {contracts.map(c => <option key={c.id} value={c.id}>{c.contractNumber ?? c.id.slice(0, 8)}</option>)}
          </select>
        </Field>

        <Field label="Fuel Date">
          <input type="datetime-local" value={fuelDate} onChange={e => setFuelDate(e.target.value)} className="input" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Litres *">
            <input type="number" required inputMode="decimal" min={0} step="0.01" value={liters} onChange={e => setLiters(e.target.value)} placeholder="42.5" className="input text-xl font-mono" />
          </Field>
          <Field label="AED / Litre">
            <input type="number" inputMode="decimal" min={0} step="0.01" value={costPerLiter} onChange={e => setCostPerLiter(e.target.value)} placeholder="2.95" className="input text-xl font-mono" />
          </Field>
        </div>

        <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-3 text-center">
          <div className="text-[10px] uppercase tracking-wide text-amber-300">Total</div>
          <div className="text-2xl font-bold text-amber-200">AED {totalCost}</div>
        </div>

        <Field label="Station">
          <input value={station} onChange={e => setStation(e.target.value)} placeholder="ENOC / ADNOC / ..." className="input" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Odometer (km)">
            <input type="number" inputMode="numeric" min={0} value={mileageAtFuel} onChange={e => setMileageAtFuel(e.target.value)} className="input" />
          </Field>
          <Field label="Fuel Card">
            <input value={fuelCardNo} onChange={e => setFuelCardNo(e.target.value)} placeholder="card no." className="input" />
          </Field>
        </div>

        <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/60 border border-white/10">
          <input type="checkbox" checked={billedToLessee} onChange={e => setBilledToLessee(e.target.checked)} className="w-5 h-5" />
          <div>
            <div className="text-sm font-medium">Bill to lessee</div>
            <div className="text-xs text-slate-400">Uncheck to absorb the cost</div>
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
          <button type="submit" disabled={saving || !contractId || !liters} className="flex-1 py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Fuel Log'}
          </button>
        </div>
      </form>

      <style jsx>{`
        .input { width: 100%; padding: 0.75rem 1rem; border-radius: 0.75rem; background: rgb(30 41 59 / 0.6); border: 1px solid rgb(255 255 255 / 0.1); color: white; }
        .input:focus { outline: none; border-color: rgb(217 119 6); }
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
