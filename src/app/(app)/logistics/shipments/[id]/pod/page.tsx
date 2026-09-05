'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Camera, CheckCircle2, Crosshair, PenLine, RefreshCw, Truck } from 'lucide-react';

interface PodRecord {
  id: string;
  deliveredAt: string | null;
  recipientName: string | null;
  signatureUrl: string | null;
  photoUrls: string[];
  gps: { lat?: number; lng?: number; accuracy?: number } | null;
  createdBy: string | null;
  metadata: { deliveryNote?: string; submittedBy?: string; gpsAccuracy?: number | null };
}

interface ShipmentSummary {
  id: string;
  shipment_no: string;
  status: string;
  cargo_owner_name: string | null;
  origin_name: string | null;
  origin_address: string | null;
  destination_name: string | null;
  destination_address: string | null;
}

function SignatureCanvas({ onSign, cleared }: { onSign: (value: string) => void; cleared: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasSigned = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasSigned.current = false;
  }, [cleared]);

  const pos = (event: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const point = 'touches' in event ? event.touches[0] : event;
    return {
      x: (point.clientX - rect.left) * (canvas.width / rect.width),
      y: (point.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const start = (event: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    const ctx = canvas.getContext('2d');
    const p = pos(event, canvas);
    ctx?.beginPath();
    ctx?.moveTo(p.x, p.y);
    event.preventDefault();
  };

  const move = (event: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!drawing.current || !canvas || !ctx) return;
    const p = pos(event, canvas);
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    hasSigned.current = true;
    event.preventDefault();
  };

  const end = () => {
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas && hasSigned.current) onSign(canvas.toDataURL('image/png'));
  };

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={180}
      className="h-44 w-full touch-none rounded-xl border border-white/10 bg-slate-950"
      onMouseDown={start}
      onMouseMove={move}
      onMouseUp={end}
      onMouseLeave={end}
      onTouchStart={start}
      onTouchMove={move}
      onTouchEnd={end}
    />
  );
}

export default function ShipmentPodPage() {
  const { id } = useParams<{ id: string }>() ?? {};
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [shipment, setShipment] = useState<ShipmentSummary | null>(null);
  const [pod, setPod] = useState<PodRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [recipientName, setRecipientName] = useState('');
  const [submittedBy, setSubmittedBy] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [signature, setSignature] = useState('');
  const [clearCount, setClearCount] = useState(0);
  const [photos, setPhotos] = useState<string[]>([]);
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/logistics/shipments/${id}/pod`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setShipment(body.shipment ?? null);
        setPod(body.pod ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const captureGps = () => {
    setError(null);
    if (!navigator.geolocation) {
      setError('GPS is not available on this device.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => setError('GPS permission denied or unavailable.'),
    );
  };

  const addPhotos = (event: React.ChangeEvent<HTMLInputElement>) => {
    for (const file of Array.from(event.target.files ?? [])) {
      const reader = new FileReader();
      reader.onload = e => setPhotos(prev => [...prev, String(e.target?.result ?? '')].filter(Boolean));
      reader.readAsDataURL(file);
    }
    event.target.value = '';
  };

  const submit = async () => {
    setError(null);
    if (!recipientName.trim()) {
      setError('Recipient name is required.');
      return;
    }
    if (!signature) {
      setError('Recipient signature is required.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/logistics/shipments/${id}/pod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientName: recipientName.trim(),
          recipientSignature: signature,
          photos,
          gpsLat: gps?.lat,
          gpsLng: gps?.lng,
          gpsAccuracy: gps?.accuracy,
          deliveryNote: deliveryNote.trim(),
          submittedBy: submittedBy.trim() || 'Driver',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to submit POD');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit POD');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-8 text-slate-400">Loading ePOD...</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
            <Link href="/logistics/trips" className="hover:text-white">Shipment orders</Link>
            <span>/</span>
            <span className="font-mono text-slate-300">{shipment?.shipment_no ?? id?.slice(0, 8) ?? '—'}</span>
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white"><PenLine className="h-6 w-6 text-emerald-300" /> Electronic POD</h1>
          <p className="mt-1 text-xs text-slate-400">{shipment?.cargo_owner_name ?? 'Customer'} - {shipment?.origin_name ?? shipment?.origin_address ?? '-'} to {shipment?.destination_name ?? shipment?.destination_address ?? '-'}</p>
        </div>
        <button type="button" onClick={() => router.push('/logistics/dispatch')} className="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5">Back to dispatch</button>
      </div>

      {pod ? (
        <div className="space-y-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-5">
          <div className="flex items-center gap-2 text-emerald-200"><CheckCircle2 className="h-5 w-5" /> POD submitted</div>
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <Info label="Received by" value={pod.recipientName ?? '-'} />
            <Info label="Submitted by" value={pod.metadata?.submittedBy ?? pod.createdBy ?? '-'} />
            <Info label="Delivered at" value={pod.deliveredAt ? new Date(pod.deliveredAt).toLocaleString('en-AE') : '-'} />
            <Info label="GPS" value={pod.gps?.lat != null && pod.gps?.lng != null ? `${Number(pod.gps.lat).toFixed(6)}, ${Number(pod.gps.lng).toFixed(6)}` : '-'} />
          </div>
          {pod.metadata?.deliveryNote && <p className="rounded-xl bg-slate-950/50 p-3 text-sm text-slate-200">{pod.metadata.deliveryNote}</p>}
          {pod.signatureUrl && <img src={pod.signatureUrl} alt="Recipient signature" className="max-h-36 rounded-xl border border-white/10 bg-slate-950 p-3" />}
          {pod.photoUrls?.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {pod.photoUrls.map((photo, index) => <img key={index} src={photo} alt={`Delivery photo ${index + 1}`} className="aspect-square rounded-lg border border-white/10 object-cover" />)}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <Input label="Recipient name" value={recipientName} onChange={setRecipientName} required />
            <Input label="Submitted by" value={submittedBy} onChange={setSubmittedBy} placeholder="Driver name" />
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Delivery note</span>
            <textarea value={deliveryNote} onChange={e => setDeliveryNote(e.target.value)} className="min-h-24 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40" />
          </label>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">Recipient signature</span>
              <button type="button" onClick={() => { setClearCount(c => c + 1); setSignature(''); }} className="text-xs text-slate-500 hover:text-white">Clear</button>
            </div>
            <SignatureCanvas onSign={setSignature} cleared={clearCount} />
            {signature && <p className="mt-1 text-xs text-emerald-300">Signature captured.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={captureGps} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5"><Crosshair className="h-4 w-4" /> {gps ? 'GPS captured' : 'Capture GPS'}</button>
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5"><Camera className="h-4 w-4" /> Add photos ({photos.length})</button>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={addPhotos} />
          </div>
          {photos.length > 0 && <div className="grid grid-cols-4 gap-2">{photos.map((photo, index) => <img key={index} src={photo} alt={`Photo ${index + 1}`} className="aspect-square rounded-lg object-cover" />)}</div>}
          {error && <p className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
          <button type="button" disabled={saving} onClick={() => void submit()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />} Submit POD
          </button>
        </div>
      )}
    </div>
  );
}

function Input({ label, value, onChange, placeholder, required }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">{label} {required && <span className="text-rose-300">*</span>}</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40" />
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-slate-500">{label}</p><p className="text-white">{value}</p></div>;
}
