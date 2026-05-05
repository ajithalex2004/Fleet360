'use client';
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface PodData {
  recipientName: string;
  recipientSignature: string;
  photos: string[];
  gps: { lat: number; lng: number; accuracy: number } | null;
  deliveryNote: string;
  submittedBy: string;
  submittedAt: string;
}

interface BookingInfo {
  bookingRef: string | null;
  status: string | null;
  pod: PodData | null;
}

// ── Signature Canvas ──────────────────────────────────────────────────────────

function SignatureCanvas({
  onSign,
  cleared,
}: {
  onSign: (dataUrl: string) => void;
  cleared: number;
}) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const drawing    = useRef(false);
  const hasSigned  = useRef(false);

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top)  * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasSigned.current = false;
  }, [cleared]);

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current; if (!canvas) return;
    drawing.current = true;
    const { x, y } = getPos(e, canvas);
    const ctx = canvas.getContext('2d')!;
    ctx.beginPath(); ctx.moveTo(x, y);
    e.preventDefault();
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const { x, y } = getPos(e, canvas);
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2.5;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineTo(x, y); ctx.stroke();
    hasSigned.current = true;
    e.preventDefault();
  };

  const endDraw = () => {
    drawing.current = false;
    const canvas = canvasRef.current; if (!canvas || !hasSigned.current) return;
    onSign(canvas.toDataURL('image/png'));
  };

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={180}
      className="w-full rounded-xl border border-white/10 bg-slate-900 cursor-crosshair touch-none"
      onMouseDown={startDraw}
      onMouseMove={draw}
      onMouseUp={endDraw}
      onMouseLeave={endDraw}
      onTouchStart={startDraw}
      onTouchMove={draw}
      onTouchEnd={endDraw}
    />
  );
}

// ── Main ePOD Page ────────────────────────────────────────────────────────────

export default function EpodPage() {
  const { id }  = useParams<{ id: string }>();
  const router  = useRouter();

  const [booking,       setBooking]       = useState<BookingInfo | null>(null);
  const [loadingInfo,   setLoadingInfo]   = useState(true);

  const [recipientName, setRecipientName] = useState('');
  const [signature,     setSignature]     = useState('');
  const [sigCleared,    setSigCleared]    = useState(0);
  const [photos,        setPhotos]        = useState<string[]>([]);
  const [gps,           setGps]           = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsLoading,    setGpsLoading]    = useState(false);
  const [deliveryNote,  setDeliveryNote]  = useState('');
  const [submittedBy,   setSubmittedBy]   = useState('');

  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState('');
  const [submitted,     setSubmitted]     = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  // Load booking info
  useEffect(() => {
    if (!id) return;
    fetch(`/api/logistics/trips/${id}/pod`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) setBooking(data);
        if (data?.pod) setSubmitted(true); // already submitted
      })
      .catch(() => {})
      .finally(() => setLoadingInfo(false));
  }, [id]);

  // GPS capture
  const captureGPS = useCallback(() => {
    if (!navigator.geolocation) { setError('GPS not available on this device'); return; }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setGpsLoading(false);
      },
      () => { setError('GPS permission denied or unavailable'); setGpsLoading(false); }
    );
  }, []);

  // Photo upload
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        const result = ev.target?.result as string;
        setPhotos(prev => [...prev, result]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handleSubmit = async () => {
    if (!recipientName.trim()) { setError('Recipient name is required'); return; }
    if (!signature) { setError('Please capture the recipient signature'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/logistics/trips/${id}/pod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientName: recipientName.trim(),
          recipientSignature: signature,
          photos,
          gpsLat:     gps?.lat,
          gpsLng:     gps?.lng,
          gpsAccuracy:gps?.accuracy,
          deliveryNote: deliveryNote.trim(),
          submittedBy:  submittedBy.trim() || 'Driver',
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed');
    } finally {
      setSaving(false);
    }
  };

  if (loadingInfo) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-slate-400 animate-pulse">Loading POD…</div>
      </div>
    );
  }

  // Already submitted view
  if (submitted && booking?.pod) {
    const pod = booking.pod;
    return (
      <div className="max-w-lg mx-auto space-y-6 py-8 px-4">
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6 text-center space-y-3">
          <div className="text-5xl">✅</div>
          <h2 className="text-xl font-bold text-emerald-400">Proof of Delivery Submitted</h2>
          <p className="text-slate-400 text-sm">
            Booking <span className="font-mono text-white">{booking.bookingRef}</span>
          </p>
          <p className="text-slate-500 text-xs">
            Submitted: {new Date(pod.submittedAt).toLocaleString('en-AE')}
          </p>
        </div>

        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-white">Delivery Details</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-slate-500 text-xs">Received by</p>
              <p className="text-white">{pod.recipientName}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs">Submitted by</p>
              <p className="text-white">{pod.submittedBy}</p>
            </div>
            {pod.gps && (
              <div className="col-span-2">
                <p className="text-slate-500 text-xs">GPS Location</p>
                <p className="text-white font-mono text-xs">
                  {pod.gps.lat.toFixed(6)}, {pod.gps.lng.toFixed(6)}
                  <span className="text-slate-500 ml-2">(±{Math.round(pod.gps.accuracy)}m)</span>
                </p>
              </div>
            )}
            {pod.deliveryNote && (
              <div className="col-span-2">
                <p className="text-slate-500 text-xs">Note</p>
                <p className="text-white text-sm">{pod.deliveryNote}</p>
              </div>
            )}
          </div>
          {pod.recipientSignature && (
            <div>
              <p className="text-slate-500 text-xs mb-2">Signature</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pod.recipientSignature} alt="Recipient signature"
                className="w-full max-h-24 object-contain bg-slate-900 rounded-xl border border-white/10 p-2" />
            </div>
          )}
          {pod.photos && pod.photos.length > 0 && (
            <div>
              <p className="text-slate-500 text-xs mb-2">Delivery Photos ({pod.photos.length})</p>
              <div className="grid grid-cols-3 gap-2">
                {pod.photos.map((p, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={p} alt={`Photo ${i + 1}`}
                    className="w-full aspect-square object-cover rounded-lg border border-white/10" />
                ))}
              </div>
            </div>
          )}
        </div>

        <button onClick={() => router.push('/logistics/dispatch')}
          className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-semibold text-sm transition-colors">
          Back to Dispatch Board
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6 py-6 px-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">📝 Electronic POD</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          Proof of Delivery — Booking{' '}
          <span className="font-mono text-white">{booking?.bookingRef ?? id.slice(0, 8)}</span>
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          Timestamp: {new Date().toLocaleString('en-AE')}
        </p>
      </div>

      {/* Recipient Info */}
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">Recipient Information</h2>
        <div>
          <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">
            Recipient Name <span className="text-red-400">*</span>
          </label>
          <input
            value={recipientName}
            onChange={e => setRecipientName(e.target.value)}
            placeholder="Full name of person receiving delivery"
            className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/40"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Submitted By (Driver)</label>
          <input
            value={submittedBy}
            onChange={e => setSubmittedBy(e.target.value)}
            placeholder="Driver name"
            className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/40"
          />
        </div>
      </div>

      {/* Signature */}
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">
            Recipient Signature <span className="text-red-400">*</span>
          </h2>
          <button
            onClick={() => { setSigCleared(c => c + 1); setSignature(''); }}
            className="text-xs text-slate-500 hover:text-white transition-colors">
            Clear
          </button>
        </div>
        <p className="text-xs text-slate-500">Sign in the box below using mouse or touch</p>
        <SignatureCanvas onSign={setSignature} cleared={sigCleared} />
        {signature && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Signature captured
          </div>
        )}
      </div>

      {/* GPS */}
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-white">GPS Stamp</h2>
        {gps ? (
          <div className="flex items-start gap-3">
            <span className="text-emerald-400 text-xl mt-0.5">📍</span>
            <div>
              <p className="text-emerald-400 text-sm font-medium">Location Captured</p>
              <p className="text-white font-mono text-xs mt-0.5">
                {gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}
              </p>
              <p className="text-slate-500 text-xs">Accuracy: ±{Math.round(gps.accuracy)} m</p>
            </div>
            <button onClick={() => setGps(null)} className="ml-auto text-xs text-slate-600 hover:text-slate-400">Reset</button>
          </div>
        ) : (
          <button
            onClick={captureGPS}
            disabled={gpsLoading}
            className="w-full py-2.5 rounded-xl border border-white/10 text-slate-300 text-sm hover:bg-slate-800 transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
            {gpsLoading ? (
              <><span className="animate-spin">⏳</span> Getting location…</>
            ) : (
              <><span>📍</span> Capture GPS Location</>
            )}
          </button>
        )}
      </div>

      {/* Photos */}
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Delivery Photos</h2>
          <span className="text-xs text-slate-500">{photos.length} photo{photos.length !== 1 ? 's' : ''}</span>
        </div>
        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p} alt={`Photo ${i + 1}`}
                  className="w-full aspect-square object-cover rounded-lg border border-white/10" />
                <button
                  onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                  className="absolute top-1 right-1 bg-red-500/80 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center hover:bg-red-500">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full py-2.5 rounded-xl border border-dashed border-white/10 text-slate-400 text-sm hover:border-white/20 hover:text-white transition-all flex items-center justify-center gap-2">
          📷 Add Photo
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple capture="environment"
          className="hidden" onChange={handlePhotoUpload} />
      </div>

      {/* Delivery Note */}
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-white">Delivery Note</h2>
        <textarea
          value={deliveryNote}
          onChange={e => setDeliveryNote(e.target.value)}
          rows={3}
          placeholder="Any notes about the delivery condition, partial delivery, exceptions…"
          className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/40 resize-none"
        />
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={saving}
        className="w-full py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-base transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
        {saving ? (
          <><span className="animate-spin">⏳</span> Submitting POD…</>
        ) : (
          <>✅ Submit Proof of Delivery</>
        )}
      </button>
      <p className="text-xs text-slate-600 text-center">
        By submitting, the recipient confirms delivery of the goods described in this shipment.
      </p>
    </div>
  );
}
