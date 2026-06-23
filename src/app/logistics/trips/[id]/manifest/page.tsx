'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { LogisticsConfirmDialog, LogisticsMessage, readLogisticsApiError } from '@/components/logistics/master-data-fields';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CargoItem { desc: string; qty: number; unit: string; weightKg?: number; }

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
  signature_b64: string | null;
}

interface BookingMeta {
  id: string;
  bookingRef: string | null;
  status: string | null;
  customerName: string | null;
  origin: string | null;
  driverName: string | null;
  vehiclePlate: string | null;
  scheduledDate: string | null;
}

interface ManifestData {
  booking: BookingMeta;
  stops: ManifestStop[];
  summary: { totalStops: number; delivered: number; pending: number; skipped: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function totalWeight(items: CargoItem[]) {
  const kg = items.reduce((s, i) => s + (i.weightKg ?? 0) * i.qty, 0);
  return kg > 0 ? `${kg.toLocaleString()} kg` : null;
}

function totalUnits(items: CargoItem[]) {
  return items.reduce((s, i) => s + i.qty, 0);
}

const STATUS_CONFIG = {
  PENDING:   { label: 'Pending',   color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20',   icon: '⏳' },
  DELIVERED: { label: 'Delivered', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: '✅' },
  SKIPPED:   { label: 'Skipped',   color: 'text-slate-500',   bg: 'bg-slate-500/10 border-slate-500/20',   icon: '⏭' },
};

// ── Add Stop Modal ────────────────────────────────────────────────────────────

function AddStopModal({ onClose, onSaved, bookingId }: {
  bookingId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [stopName,    setStopName]    = useState('');
  const [stopAddress, setStopAddress] = useState('');
  const [recipient,   setRecipient]   = useState('');
  const [recipPhone,  setRecipPhone]  = useState('');
  const [items,       setItems]       = useState<CargoItem[]>([
    { desc: '', qty: 1, unit: 'boxes', weightKg: undefined },
  ]);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const addItem = () => setItems(p => [...p, { desc: '', qty: 1, unit: 'boxes', weightKg: undefined }]);
  const updateItem = (i: number, k: keyof CargoItem, v: string | number) =>
    setItems(p => p.map((it, idx) => idx === i ? { ...it, [k]: v } : it));
  const removeItem = (i: number) => setItems(p => p.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!stopName.trim()) { setError('Stop name is required'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/logistics/trips/${bookingId}/manifest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_stop',
          stopName, stopAddress, recipient,
          recipientPhone: recipPhone,
          cargoItems: items.filter(i => i.desc.trim()),
        }),
      });
      if (!res.ok) throw new Error((await readLogisticsApiError(res)).message);
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-white/15 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-slate-900 border-b border-white/10 px-5 py-4 flex items-center justify-between">
          <h2 className="font-semibold text-white">Add Delivery Stop</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Stop info */}
          <div className="space-y-3">
            <h3 className="text-xs text-slate-500 uppercase tracking-wider font-medium">Stop Details</h3>
            <input value={stopName}    onChange={e => setStopName(e.target.value)}    placeholder="Stop name (e.g. Warehouse A) *"
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
            <input value={stopAddress} onChange={e => setStopAddress(e.target.value)} placeholder="Address"
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
            <div className="grid grid-cols-2 gap-2">
              <input value={recipient}  onChange={e => setRecipient(e.target.value)}  placeholder="Recipient name"
                className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
              <input value={recipPhone} onChange={e => setRecipPhone(e.target.value)} placeholder="Recipient phone"
                className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
            </div>
          </div>

          {/* Cargo items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs text-slate-500 uppercase tracking-wider font-medium">Cargo Items</h3>
              <button onClick={addItem} className="text-xs text-amber-400 hover:text-amber-300">+ Add item</button>
            </div>
            {items.map((item, i) => (
              <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
                <input value={item.desc} onChange={e => updateItem(i, 'desc', e.target.value)} placeholder="Description"
                  className="col-span-4 bg-slate-800 border border-white/10 rounded-lg px-2 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40" />
                <input type="number" value={item.qty} min={1} onChange={e => updateItem(i, 'qty', Number(e.target.value))}
                  className="col-span-2 bg-slate-800 border border-white/10 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-amber-500/40" />
                <input value={item.unit} onChange={e => updateItem(i, 'unit', e.target.value)} placeholder="Unit"
                  className="col-span-2 bg-slate-800 border border-white/10 rounded-lg px-2 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40" />
                <input type="number" value={item.weightKg ?? ''} min={0} onChange={e => updateItem(i, 'weightKg', e.target.value === '' ? 0 : Number(e.target.value))}
                  placeholder="kg"
                  className="col-span-3 bg-slate-800 border border-white/10 rounded-lg px-2 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40" />
                <button onClick={() => removeItem(i)} className="col-span-1 text-slate-600 hover:text-red-400 text-xs text-center">✕</button>
              </div>
            ))}
            <div className="grid grid-cols-12 gap-1.5 text-xs text-slate-600 px-0.5">
              <span className="col-span-4">Description</span>
              <span className="col-span-2">Qty</span>
              <span className="col-span-2">Unit</span>
              <span className="col-span-3">Weight/unit (kg)</span>
            </div>
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button onClick={save} disabled={saving}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
            {saving ? 'Saving…' : 'Add Stop'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Confirm Delivery Modal ────────────────────────────────────────────────────

function DeliveryModal({ stop, bookingId, onClose, onSaved }: {
  stop: ManifestStop;
  bookingId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const drawing    = useRef(false);
  const [note,     setNote]     = useState('');
  const [status,   setStatus]   = useState<'DELIVERED' | 'SKIPPED'>('DELIVERED');
  const [saving,   setSaving]   = useState(false);
  const [signed,   setSigned]   = useState(false);

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const src  = 'touches' in e ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current; if (!canvas) return;
    drawing.current = true;
    const ctx = canvas.getContext('2d')!;
    const pos = getPos(e, canvas);
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y); ctx.stroke();
    setSigned(true); e.preventDefault();
  };

  const stopDraw = () => { drawing.current = false; };
  const clearSig = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    setSigned(false);
  };

  const confirm = async () => {
    setSaving(true);
    const sigB64 = (signed && canvasRef.current) ? canvasRef.current.toDataURL('image/png') : null;
    try {
      const res = await fetch(`/api/logistics/trips/${bookingId}/manifest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm_delivery',
          stopId: stop.id, status,
          deliveryNote: note || null,
          signatureB64: sigB64,
        }),
      });
      if (!res.ok) throw new Error();
      onSaved();
    } catch { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-white/15 rounded-2xl w-full max-w-md">
        <div className="border-b border-white/10 px-5 py-4 flex items-center justify-between">
          <h2 className="font-semibold text-white">Confirm Delivery — Stop #{stop.stop_number}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-300">{stop.stop_name ?? `Stop #${stop.stop_number}`}</p>
          {stop.stop_address && <p className="text-xs text-slate-500">📍 {stop.stop_address}</p>}

          {/* Status selector */}
          <div className="flex gap-2">
            {(['DELIVERED', 'SKIPPED'] as const).map(s => (
              <button key={s} onClick={() => setStatus(s)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all ${
                  status === s
                    ? s === 'DELIVERED'
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-slate-500/20 border-slate-500/40 text-slate-300'
                    : 'border-white/10 text-slate-500 hover:border-white/20'
                }`}>
                {s === 'DELIVERED' ? '✅ Delivered' : '⏭ Skipped'}
              </button>
            ))}
          </div>

          {status === 'DELIVERED' && (
            <>
              {/* Signature pad */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Recipient signature</span>
                  <button onClick={clearSig} className="text-slate-600 hover:text-slate-400">Clear</button>
                </div>
                <canvas ref={canvasRef} width={380} height={100}
                  className="w-full h-24 bg-slate-800 border border-white/10 rounded-xl touch-none cursor-crosshair"
                  onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                  onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw} />
              </div>
            </>
          )}

          {/* Note */}
          <textarea value={note} onChange={e => setNote(e.target.value)}
            placeholder="Delivery note (optional)"
            rows={2}
            className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40 resize-none" />

          <button onClick={confirm} disabled={saving}
            className={`w-full font-semibold py-2.5 rounded-xl text-sm transition-colors disabled:opacity-40 ${
              status === 'DELIVERED'
                ? 'bg-emerald-500 hover:bg-emerald-400 text-white'
                : 'bg-slate-600 hover:bg-slate-500 text-white'
            }`}>
            {saving ? 'Saving…' : status === 'DELIVERED' ? '✅ Confirm Delivery' : '⏭ Mark Skipped'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Stop Card ─────────────────────────────────────────────────────────────────

function StopCard({ stop, onConfirm, onDelete }: {
  stop: ManifestStop;
  onConfirm: (stop: ManifestStop) => void;
  onDelete: (stopId: string) => void;
}) {
  const cfg = STATUS_CONFIG[stop.status];

  return (
    <div className={`rounded-2xl border p-4 space-y-3 ${cfg.bg}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center text-xs font-bold text-slate-300 flex-shrink-0">
            {stop.stop_number}
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{stop.stop_name ?? `Stop #${stop.stop_number}`}</p>
            {stop.stop_address && <p className="text-xs text-slate-500 mt-0.5">📍 {stop.stop_address}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${cfg.color}`}>{cfg.icon} {cfg.label}</span>
          {stop.status === 'PENDING' && (
            <button onClick={() => onDelete(stop.id)} className="text-slate-700 hover:text-red-400 text-xs transition-colors" title="Remove stop">✕</button>
          )}
        </div>
      </div>

      {/* Recipient */}
      {(stop.recipient || stop.recipient_phone) && (
        <div className="flex items-center gap-3 text-xs text-slate-400">
          {stop.recipient      && <span>👤 {stop.recipient}</span>}
          {stop.recipient_phone && <span>📞 {stop.recipient_phone}</span>}
        </div>
      )}

      {/* Cargo items */}
      {stop.cargo_items.length > 0 && (
        <div className="bg-slate-900/40 rounded-xl p-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span className="font-medium">Cargo</span>
            <span>{totalUnits(stop.cargo_items)} units{totalWeight(stop.cargo_items) ? ` · ${totalWeight(stop.cargo_items)}` : ''}</span>
          </div>
          {stop.cargo_items.map((item, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-slate-300">{item.desc}</span>
              <span className="text-slate-500 font-mono">{item.qty} {item.unit}{item.weightKg ? ` · ${item.weightKg}kg` : ''}</span>
            </div>
          ))}
        </div>
      )}

      {/* Delivery info */}
      {stop.status === 'DELIVERED' && (
        <div className="text-xs text-emerald-400 space-y-1">
          {stop.delivered_at && <p>✅ Delivered: {new Date(stop.delivered_at).toLocaleString('en-AE')}</p>}
          {stop.delivery_note && <p className="text-slate-500 italic">"{stop.delivery_note}"</p>}
          {stop.signature_b64 && <p>🖊 Signature captured</p>}
        </div>
      )}

      {/* Action */}
      {stop.status === 'PENDING' && (
        <button onClick={() => onConfirm(stop)}
          className="w-full text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 py-2 rounded-xl font-medium transition-colors">
          ✅ Confirm Delivery
        </button>
      )}
    </div>
  );
}

// ── Print-friendly manifest ───────────────────────────────────────────────────

function PrintManifest({ data }: { data: ManifestData }) {
  return (
    <div id="print-manifest" className="hidden print:block bg-white text-black p-8 space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Cargo Manifest</h1>
          <p className="text-sm text-gray-600 mt-1">Booking Ref: {data.booking.bookingRef ?? '—'}</p>
        </div>
        <div className="text-right text-sm text-gray-600">
          <p>XL Smart Mobility</p>
          {data.booking.vehiclePlate && <p>Vehicle: {data.booking.vehiclePlate}</p>}
          {data.booking.driverName   && <p>Driver:  {data.booking.driverName}</p>}
          {data.booking.scheduledDate && <p>Date: {new Date(data.booking.scheduledDate).toLocaleDateString('en-AE')}</p>}
        </div>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-black">
            <th className="text-left py-2 w-8">#</th>
            <th className="text-left py-2">Stop / Address</th>
            <th className="text-left py-2">Recipient</th>
            <th className="text-left py-2">Cargo</th>
            <th className="text-left py-2">Status</th>
            <th className="text-left py-2">Signature</th>
          </tr>
        </thead>
        <tbody>
          {data.stops.map(stop => (
            <tr key={stop.id} className="border-b border-gray-200">
              <td className="py-3 align-top font-bold">{stop.stop_number}</td>
              <td className="py-3 align-top">
                <p className="font-medium">{stop.stop_name}</p>
                {stop.stop_address && <p className="text-gray-600 text-xs mt-0.5">{stop.stop_address}</p>}
              </td>
              <td className="py-3 align-top text-sm">
                <p>{stop.recipient ?? '—'}</p>
                {stop.recipient_phone && <p className="text-gray-500 text-xs">{stop.recipient_phone}</p>}
              </td>
              <td className="py-3 align-top text-xs">
                {stop.cargo_items.map((item, i) => (
                  <p key={i}>{item.qty} {item.unit} — {item.desc}</p>
                ))}
                {totalWeight(stop.cargo_items) && (
                  <p className="text-gray-500 mt-0.5">Total: {totalWeight(stop.cargo_items)}</p>
                )}
              </td>
              <td className="py-3 align-top text-sm">{stop.status}</td>
              <td className="py-3 align-top">
                {stop.signature_b64 ? (
                  <img src={stop.signature_b64} alt="sig" className="h-12 border border-gray-300" />
                ) : (
                  <div className="h-12 w-32 border border-gray-300" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="text-xs text-gray-500 border-t pt-3">
        Generated: {new Date().toLocaleString('en-AE')} · XL Smart Mobility Platform
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ManifestPage() {
  const params    = useParams<{ id: string }>();
  const bookingId = params?.id ?? '';

  const [data,         setData]         = useState<ManifestData | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [showAdd,      setShowAdd]      = useState(false);
  const [confirmStop,  setConfirmStop]  = useState<ManifestStop | null>(null);
  const [deleteStopTarget, setDeleteStopTarget] = useState<ManifestStop | null>(null);
  const [deletingStop, setDeletingStop] = useState(false);
  const [pageError, setPageError] = useState('');

  const load = useCallback(async () => {
    if (!bookingId) return;
    try {
      const res = await fetch(`/api/logistics/trips/${bookingId}/manifest`, { cache: 'no-store' });
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [bookingId]);

  useEffect(() => { load(); }, [load]);

  const deleteStop = async (stopId: string) => {
    setDeletingStop(true);
    setPageError('');
    try {
      const res = await fetch(`/api/logistics/trips/${bookingId}/manifest`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopId }),
      });
      if (!res.ok) throw new Error((await readLogisticsApiError(res)).message);
      setDeleteStopTarget(null);
      await load();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed to remove manifest stop');
    } finally {
      setDeletingStop(false);
    }
  };

  const handlePrint = () => window.print();

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-10 w-72 bg-slate-800 rounded-xl" />
        <div className="grid grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-40 bg-slate-800 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20 space-y-3">
        <div className="text-5xl">📋</div>
        <p className="text-slate-400">Trip not found.</p>
        <Link href="/logistics/trips" className="text-amber-400 text-sm hover:text-amber-300">← All Trips</Link>
      </div>
    );
  }

  const { booking, stops, summary } = data;
  const progressPct = summary.totalStops > 0
    ? Math.round(((summary.delivered + summary.skipped) / summary.totalStops) * 100)
    : 0;

  return (
    <>
      {showAdd && (
        <AddStopModal bookingId={bookingId} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />
      )}
      {confirmStop && (
        <DeliveryModal stop={confirmStop} bookingId={bookingId}
          onClose={() => setConfirmStop(null)} onSaved={() => { setConfirmStop(null); load(); }} />
      )}
      {deleteStopTarget && (
        <LogisticsConfirmDialog
          title="Remove manifest stop"
          message={`Remove stop ${deleteStopTarget.stop_number}: ${deleteStopTarget.stop_name}?`}
          confirmLabel={deletingStop ? 'Removing...' : 'Remove stop'}
          tone="danger"
          busy={deletingStop}
          onCancel={() => {
            if (!deletingStop) setDeleteStopTarget(null);
          }}
          onConfirm={() => deleteStop(deleteStopTarget.id)}
        />
      )}

      {/* Print view (hidden on screen) */}
      {data && <PrintManifest data={data} />}

      <div className="space-y-6 print:hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
              <Link href="/logistics/trips" className="hover:text-slate-300">Trips</Link>
              <span>/</span>
              <span className="font-mono text-slate-400">{booking.bookingRef ?? bookingId.slice(0, 8)}</span>
              <span>/</span>
              <span>Manifest</span>
            </div>
            <h1 className="text-2xl font-bold text-white">Cargo Manifest</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {summary.totalStops} stop{summary.totalStops !== 1 ? 's' : ''} · {summary.delivered} delivered · {summary.pending} pending
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint}
              className="text-xs text-slate-400 border border-white/10 px-3 py-2 rounded-lg hover:border-white/20 hover:text-white transition-colors">
              🖨 Print
            </button>
            <button onClick={() => setShowAdd(true)}
              className="bg-amber-500 hover:bg-amber-400 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors">
              ➕ Add Stop
            </button>
          </div>
        </div>

        {/* Trip meta card */}
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><p className="text-xs text-slate-500">Booking</p><p className="text-white font-mono">{booking.bookingRef ?? '—'}</p></div>
          <div><p className="text-xs text-slate-500">Customer</p><p className="text-white">{booking.customerName ?? '—'}</p></div>
          <div><p className="text-xs text-slate-500">Driver</p><p className="text-white">{booking.driverName ?? '—'}</p></div>
          <div><p className="text-xs text-slate-500">Vehicle</p><p className="text-amber-400">{booking.vehiclePlate ?? '—'}</p></div>
        </div>
        {pageError && (
          <LogisticsMessage type="error" title="Manifest action failed" message={pageError} />
        )}

        {/* Progress */}
        {summary.totalStops > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-slate-500">
              <span>Delivery progress</span>
              <span>{summary.delivered + summary.skipped} / {summary.totalStops} stops completed</span>
            </div>
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-amber-500 to-emerald-500 rounded-full transition-all duration-700"
                style={{ width: `${progressPct}%` }} />
            </div>
            <div className="flex gap-4 text-xs text-slate-600">
              <span className="text-emerald-400">{summary.delivered} delivered</span>
              <span className="text-amber-400">{summary.pending} pending</span>
              {summary.skipped > 0 && <span className="text-slate-500">{summary.skipped} skipped</span>}
            </div>
          </div>
        )}

        {/* Stops */}
        {stops.length === 0 ? (
          <div className="bg-slate-900/60 border border-white/10 border-dashed rounded-2xl p-16 text-center space-y-3">
            <div className="text-5xl">🗺️</div>
            <p className="text-slate-400">No delivery stops yet</p>
            <p className="text-slate-600 text-xs">Add stops to build the cargo manifest for this trip</p>
            <button onClick={() => setShowAdd(true)}
              className="mt-2 text-sm text-amber-400 border border-amber-500/30 px-4 py-2 rounded-xl hover:bg-amber-500/10 transition-colors">
              ➕ Add First Stop
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {stops.map(stop => (
              <StopCard key={stop.id} stop={stop}
                onConfirm={setConfirmStop}
                onDelete={stopId => setDeleteStopTarget(stops.find(item => item.id === stopId) ?? null)}
              />
            ))}
          </div>
        )}

        {/* Summary totals */}
        {stops.length > 0 && (
          <div className="bg-slate-900/40 border border-white/5 rounded-2xl p-4 text-xs text-slate-400 space-y-1">
            <p className="font-medium text-slate-300 mb-2">Manifest Summary</p>
            <p>Total stops: {summary.totalStops}</p>
            <p>Total cargo items: {stops.reduce((s, st) => s + totalUnits(st.cargo_items), 0)} units</p>
            {(() => {
              const allItems = stops.flatMap(s => s.cargo_items);
              const w = totalWeight(allItems);
              return w ? <p>Total weight: {w}</p> : null;
            })()}
          </div>
        )}

        {/* Back link */}
        <Link href={`/logistics/dispatch`}
          className="inline-block text-xs text-slate-500 hover:text-slate-300 transition-colors">
          ← Back to Dispatch Board
        </Link>
      </div>
    </>
  );
}
