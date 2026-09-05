'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CheckCircle2, ClipboardList, Plus, Printer, Trash2, X } from 'lucide-react';

interface CargoItem { desc: string; qty: number; unit: string; weightKg?: number | null }
interface ManifestStop {
  id: string;
  stop_number: number;
  stop_name: string | null;
  stop_address: string | null;
  recipient: string | null;
  recipient_phone: string | null;
  cargo_items: CargoItem[];
  status: 'PENDING' | 'DELIVERED' | 'SKIPPED';
  delivered_at: string | null;
  delivery_note: string | null;
}
interface ManifestData {
  shipment: { id: string; shipmentNo: string | null; status: string; customerName: string | null; origin: string | null; destination: string | null };
  stops: ManifestStop[];
  summary: { totalStops: number; delivered: number; pending: number; skipped: number };
}

export default function ShipmentManifestPage() {
  const { id } = useParams<{ id: string }>() ?? {};
  const [data, setData] = useState<ManifestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [confirming, setConfirming] = useState<ManifestStop | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/logistics/shipments/${id}/manifest`, { cache: 'no-store' });
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const deleteStop = async (stopId: string) => {
    if (!confirm('Remove this manifest stop?')) return;
    await fetch(`/api/logistics/shipments/${id}/manifest`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stopId }),
    });
    await load();
  };

  if (loading) return <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-8 text-slate-400">Loading manifest...</div>;
  if (!data) return <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-8 text-slate-400">Shipment manifest not found.</div>;

  const progress = data.summary.totalStops > 0 ? Math.round(((data.summary.delivered + data.summary.skipped) / data.summary.totalStops) * 100) : 0;

  return (
    <div className="space-y-5">
      {showAdd && <StopModal shipmentId={id ?? ''} onClose={() => setShowAdd(false)} onSaved={async () => { setShowAdd(false); await load(); }} />}
      {confirming && <ConfirmModal shipmentId={id ?? ''} stop={confirming} onClose={() => setConfirming(null)} onSaved={async () => { setConfirming(null); await load(); }} />}

      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
            <Link href="/logistics/trips" className="hover:text-white">Shipment orders</Link>
            <span>/</span>
            <span className="font-mono text-slate-300">{data.shipment.shipmentNo ?? id?.slice(0, 8)}</span>
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white"><ClipboardList className="h-6 w-6 text-amber-300" /> Cargo Manifest</h1>
          <p className="mt-1 text-xs text-slate-400">{data.summary.totalStops} stops - {data.summary.delivered} delivered - {data.summary.pending} pending</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5"><Printer className="h-4 w-4" /> Print</button>
          <button type="button" onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400"><Plus className="h-4 w-4" /> Add stop</button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
        <div className="grid gap-3 text-sm md:grid-cols-4">
          <Info label="Shipment" value={data.shipment.shipmentNo ?? id?.slice(0, 8) ?? '—'} />
          <Info label="Customer" value={data.shipment.customerName ?? '-'} />
          <Info label="Origin" value={data.shipment.origin ?? '-'} />
          <Info label="Destination" value={data.shipment.destination ?? '-'} />
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-emerald-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {data.stops.map(stop => (
          <article key={stop.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Stop {stop.stop_number}</p>
                <h2 className="mt-1 text-lg font-semibold text-white">{stop.stop_name ?? 'Stop'}</h2>
                <p className="text-sm text-slate-400">{stop.stop_address ?? '-'}</p>
              </div>
              <span className={`rounded-full border px-2 py-1 text-xs ${stop.status === 'DELIVERED' ? 'border-emerald-500/30 text-emerald-300' : stop.status === 'SKIPPED' ? 'border-slate-500/30 text-slate-400' : 'border-amber-500/30 text-amber-300'}`}>{stop.status}</span>
            </div>
            <div className="mt-3 grid gap-2 text-sm text-slate-400">
              <p>Recipient: <span className="text-slate-200">{stop.recipient ?? '-'}</span></p>
              {stop.delivery_note && <p>Note: <span className="text-slate-200">{stop.delivery_note}</span></p>}
              {stop.cargo_items.length > 0 && <p>Cargo: {stop.cargo_items.map(item => `${item.qty} ${item.unit} ${item.desc}`).join(', ')}</p>}
            </div>
            <div className="mt-4 flex gap-2 print:hidden">
              <button type="button" onClick={() => setConfirming(stop)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/25 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/10"><CheckCircle2 className="h-3.5 w-3.5" /> Confirm</button>
              <button type="button" onClick={() => void deleteStop(stop.id)} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/25 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function StopModal({ shipmentId, onClose, onSaved }: { shipmentId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ stopName: '', stopAddress: '', recipient: '', recipientPhone: '', cargo: '' });
  const save = async () => {
    await fetch(`/api/logistics/shipments/${shipmentId}/manifest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add_stop',
        stopName: form.stopName,
        stopAddress: form.stopAddress,
        recipient: form.recipient,
        recipientPhone: form.recipientPhone,
        cargoItems: form.cargo ? [{ desc: form.cargo, qty: 1, unit: 'unit' }] : [],
      }),
    });
    await onSaved();
  };
  return <Modal title="Add manifest stop" onClose={onClose}><div className="grid gap-3 md:grid-cols-2"><Input label="Stop name" value={form.stopName} onChange={v => setForm(f => ({ ...f, stopName: v }))} /><Input label="Address" value={form.stopAddress} onChange={v => setForm(f => ({ ...f, stopAddress: v }))} /><Input label="Recipient" value={form.recipient} onChange={v => setForm(f => ({ ...f, recipient: v }))} /><Input label="Phone" value={form.recipientPhone} onChange={v => setForm(f => ({ ...f, recipientPhone: v }))} /><Input label="Cargo" value={form.cargo} onChange={v => setForm(f => ({ ...f, cargo: v }))} /></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300">Cancel</button><button type="button" onClick={() => void save()} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950">Save</button></div></Modal>;
}

function ConfirmModal({ shipmentId, stop, onClose, onSaved }: { shipmentId: string; stop: ManifestStop; onClose: () => void; onSaved: () => Promise<void> }) {
  const [note, setNote] = useState('');
  const save = async () => {
    await fetch(`/api/logistics/shipments/${shipmentId}/manifest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm_delivery', stopId: stop.id, status: 'DELIVERED', deliveryNote: note }),
    });
    await onSaved();
  };
  return <Modal title={`Confirm stop ${stop.stop_number}`} onClose={onClose}><label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Delivery note</span><textarea value={note} onChange={e => setNote(e.target.value)} className="min-h-24 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white" /></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300">Cancel</button><button type="button" onClick={() => void save()} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950">Confirm delivered</button></div></Modal>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="w-full max-w-xl rounded-2xl border border-white/10 bg-slate-950 p-5 shadow-2xl"><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold text-white">{title}</h2><button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-white"><X className="h-5 w-5" /></button></div>{children}</div></div>;
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">{label}</span><input value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-500/40" /></label>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-slate-500">{label}</p><p className="text-white">{value}</p></div>;
}
