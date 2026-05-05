'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Inspection {
  id: string;
  type: 'checkin' | 'checkout';
  mileage: number | null;
  fuelLevel: number | null;
  damages: string | null;
  inspector: string | null;
  notes: string | null;
  createdAt: string;
}

interface Booking {
  id: string;
  bookingRef: string | null;
  vehicleCategory: string | null;
  vehicleId: string | null;
  pickupDate: string;
  dropoffDate: string;
  status: string | null;
  customer?: { fullName: string; phone: string | null } | null;
}

// Damage zones for the vehicle diagram
const DAMAGE_ZONES = [
  { id: 'front',        label: 'Front',         x: 43, y: 5,  w: 14, h: 10 },
  { id: 'rear',         label: 'Rear',           x: 43, y: 85, w: 14, h: 10 },
  { id: 'front_left',  label: 'Front Left',     x: 5,  y: 12, w: 14, h: 10 },
  { id: 'front_right', label: 'Front Right',    x: 81, y: 12, w: 14, h: 10 },
  { id: 'rear_left',   label: 'Rear Left',      x: 5,  y: 75, w: 14, h: 10 },
  { id: 'rear_right',  label: 'Rear Right',     x: 81, y: 75, w: 14, h: 10 },
  { id: 'left_side',   label: 'Left Side',      x: 3,  y: 40, w: 14, h: 18 },
  { id: 'right_side',  label: 'Right Side',     x: 83, y: 40, w: 14, h: 18 },
  { id: 'roof',        label: 'Roof',           x: 33, y: 34, w: 34, h: 28 },
  { id: 'windscreen',  label: 'Windscreen',     x: 33, y: 14, w: 34, h: 14 },
  { id: 'rear_window', label: 'Rear Window',    x: 33, y: 68, w: 34, h: 14 },
];

const CONDITION_GRADES = [
  { grade: 'A', label: 'Excellent',   color: 'text-emerald-400', bg: 'bg-emerald-500/20 border-emerald-500/40', desc: 'No damage, pristine condition' },
  { grade: 'B', label: 'Good',        color: 'text-teal-400',    bg: 'bg-teal-500/20 border-teal-500/40',       desc: 'Minor wear, no significant damage' },
  { grade: 'C', label: 'Fair',        color: 'text-amber-400',   bg: 'bg-amber-500/20 border-amber-500/40',    desc: 'Visible damage, needs attention' },
  { grade: 'D', label: 'Poor',        color: 'text-red-400',     bg: 'bg-red-500/20 border-red-500/40',         desc: 'Major damage, repair required' },
];

// ── Fuel gauge ────────────────────────────────────────────────────────────────

function FuelGauge({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const levels = [0, 12, 25, 37, 50, 62, 75, 87, 100];
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-slate-400">
        <span>Empty</span>
        <span className="text-white font-medium">{value}%</span>
        <span>Full</span>
      </div>
      <div className="relative h-8 bg-slate-800 rounded-full overflow-hidden border border-white/10">
        <div className={`h-full rounded-full transition-all duration-300 ${
          value >= 75 ? 'bg-emerald-500' : value >= 25 ? 'bg-amber-500' : 'bg-red-500'
        }`} style={{ width: `${value}%` }} />
        <input type="range" min={0} max={100} step={12} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer" />
      </div>
      <div className="flex justify-between">
        {levels.map(l => (
          <button key={l} onClick={() => onChange(l)}
            className={`text-xs px-1 py-0.5 rounded transition-colors ${
              value === l ? 'text-white bg-white/10' : 'text-slate-600 hover:text-slate-400'
            }`}>
            {l === 0 ? 'E' : l === 100 ? 'F' : `${l}`}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Vehicle diagram ───────────────────────────────────────────────────────────

function VehicleDiagram({ damaged, onToggle }: {
  damaged: Set<string>;
  onToggle: (zoneId: string) => void;
}) {
  return (
    <div className="relative w-full" style={{ paddingBottom: '100%' }}>
      <div className="absolute inset-0 bg-slate-800/60 border border-white/10 rounded-2xl overflow-hidden">
        {/* Car body outline */}
        <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full p-4">
          {/* Body */}
          <rect x="20" y="10" width="60" height="80" rx="8" fill="#1e293b" stroke="#334155" strokeWidth="0.5" />
          {/* Cabin */}
          <rect x="28" y="28" width="44" height="40" rx="4" fill="#0f172a" stroke="#334155" strokeWidth="0.5" />
          {/* Wheels */}
          {[{x:12,y:20},{x:76,y:20},{x:12,y:68},{x:76,y:68}].map((w,i) => (
            <circle key={i} cx={w.x} cy={w.y} r="8" fill="#0f172a" stroke="#475569" strokeWidth="1.5" />
          ))}
        </svg>

        {/* Damage zone buttons */}
        {DAMAGE_ZONES.map(zone => (
          <button
            key={zone.id}
            onClick={() => onToggle(zone.id)}
            title={zone.label}
            className={`absolute transition-all rounded border text-xs font-bold ${
              damaged.has(zone.id)
                ? 'bg-red-500/70 border-red-400 text-white shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                : 'bg-slate-700/40 border-slate-600/60 text-slate-500 hover:bg-amber-500/20 hover:border-amber-500/60 hover:text-amber-300'
            }`}
            style={{
              left: `${zone.x}%`, top: `${zone.y}%`,
              width: `${zone.w}%`, height: `${zone.h}%`,
              fontSize: '7px',
            }}
          >
            {damaged.has(zone.id) ? '✕' : '+'}
          </button>
        ))}

        <p className="absolute bottom-2 left-0 right-0 text-center text-xs text-slate-600">
          Tap zones to mark damage
        </p>
      </div>
    </div>
  );
}

// ── Existing inspection card ──────────────────────────────────────────────────

function InspectionCard({ insp }: { insp: Inspection }) {
  let damages: string[] = [];
  try { damages = JSON.parse(insp.damages ?? '[]'); } catch { damages = insp.damages ? [insp.damages] : []; }

  return (
    <div className={`rounded-2xl border p-4 space-y-2 ${
      insp.type === 'checkin'
        ? 'bg-blue-500/10 border-blue-500/20'
        : 'bg-amber-500/10 border-amber-500/20'
    }`}>
      <div className="flex items-center justify-between">
        <span className={`text-sm font-semibold ${insp.type === 'checkin' ? 'text-blue-300' : 'text-amber-300'}`}>
          {insp.type === 'checkin' ? '🚗 Check-In' : '🔑 Check-Out'} Inspection
        </span>
        <span className="text-xs text-slate-500">
          {new Date(insp.createdAt).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' })}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div><p className="text-slate-500">Mileage</p><p className="text-white font-mono">{insp.mileage?.toLocaleString() ?? '—'} km</p></div>
        <div><p className="text-slate-500">Fuel Level</p><p className="text-white">{insp.fuelLevel ?? '—'}%</p></div>
        <div><p className="text-slate-500">Inspector</p><p className="text-white">{insp.inspector ?? '—'}</p></div>
      </div>
      {damages.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {damages.map((d, i) => (
            <span key={i} className="text-xs bg-red-500/20 border border-red-500/30 text-red-300 rounded-full px-2 py-0.5">
              ⚠️ {d}
            </span>
          ))}
        </div>
      )}
      {insp.notes && <p className="text-xs text-slate-500 italic">"{insp.notes}"</p>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function InspectionPage() {
  const params    = useParams<{ id: string }>();
  const bookingId = params?.id ?? '';

  const [booking,     setBooking]     = useState<Booking | null>(null);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [success,     setSuccess]     = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing   = useRef(false);
  const [signed,  setSigned] = useState(false);

  // Form state
  const [inspType,   setInspType]   = useState<'checkin' | 'checkout'>('checkin');
  const [mileage,    setMileage]    = useState('');
  const [fuelLevel,  setFuelLevel]  = useState(100);
  const [grade,      setGrade]      = useState('A');
  const [damaged,    setDamaged]    = useState<Set<string>>(new Set());
  const [notes,      setNotes]      = useState('');
  const [inspector,  setInspector]  = useState('');
  const [createClaim, setCreateClaim] = useState(false);
  const [claimNote,  setClaimNote]  = useState('');
  const [claimCost,  setClaimCost]  = useState('');

  const load = useCallback(async () => {
    if (!bookingId) return;
    setLoading(true);
    try {
      const [bRes, iRes] = await Promise.all([
        fetch(`/api/rental/bookings/${bookingId}`),
        fetch(`/api/rental/inspections?bookingId=${bookingId}`),
      ]);
      if (bRes.ok) setBooking(await bRes.json());
      if (iRes.ok) setInspections(await iRes.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [bookingId]);

  useEffect(() => { load(); }, [load]);

  // Auto-set inspection type based on existing inspections
  useEffect(() => {
    const hasCheckin = inspections.some(i => i.type === 'checkin');
    setInspType(hasCheckin ? 'checkout' : 'checkin');
  }, [inspections]);

  // Signature pad
  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const src  = 'touches' in e ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * (canvas.width / rect.width), y: (src.clientY - rect.top) * (canvas.height / rect.height) };
  };
  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current; if (!canvas) return;
    drawing.current = true;
    const ctx = canvas.getContext('2d')!;
    const pos = getPos(e, canvas); ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
  };
  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    const pos = getPos(e, canvas); ctx.lineTo(pos.x, pos.y); ctx.stroke();
    setSigned(true); e.preventDefault();
  };
  const stopDraw = () => { drawing.current = false; };
  const clearSig = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    setSigned(false);
  };

  const toggleZone = (zoneId: string) =>
    setDamaged(prev => { const n = new Set(prev); n.has(zoneId) ? n.delete(zoneId) : n.add(zoneId); return n; });

  const submit = async () => {
    setSaving(true); setError(''); setSuccess('');
    try {
      const damageList = Array.from(damaged).map(id => DAMAGE_ZONES.find(z => z.id === id)?.label ?? id);
      const sigB64 = (signed && canvasRef.current) ? canvasRef.current.toDataURL('image/png') : null;

      const payload = {
        bookingId,
        type: inspType,
        mileage: mileage ? Number(mileage) : null,
        fuelLevel,
        damages: JSON.stringify(damageList),
        inspector: inspector || 'Operations',
        notes: notes || null,
        conditionGrade: grade,
        signatureB64: sigB64,
      };

      const res = await fetch('/api/rental/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());

      // Create damage claim if requested and damage found
      if (createClaim && damageList.length > 0) {
        await fetch('/api/rental/damage-claims', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId,
            description: `${inspType === 'checkin' ? 'Pre-rental' : 'Post-rental'} damage: ${damageList.join(', ')}. ${claimNote}`,
            estimatedCost: claimCost ? parseFloat(claimCost) : null,
            status: 'OPEN',
            insuranceClaim: false,
            billedToCustomer: false,
          }),
        });
      }

      setSuccess('Inspection saved successfully!');
      setDamaged(new Set()); setNotes(''); setMileage(''); clearSig();
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save inspection');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="space-y-4 animate-pulse">{[...Array(3)].map((_,i) => <div key={i} className="h-32 bg-slate-800/60 rounded-2xl" />)}</div>;
  }

  const hasDamage = damaged.size > 0;
  const hasCheckin = inspections.some(i => i.type === 'checkin');
  const hasCheckout = inspections.some(i => i.type === 'checkout');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
            <Link href="/rental/bookings" className="hover:text-slate-300">Bookings</Link>
            <span>/</span>
            <span className="font-mono text-slate-400">{booking?.bookingRef ?? bookingId.slice(0, 8)}</span>
            <span>/</span>
            <span>Inspection</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Vehicle Inspection</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {booking?.customer?.fullName ?? '—'} · {booking?.vehicleCategory ?? 'Vehicle not specified'}
          </p>
        </div>
        <div className="flex gap-2">
          {hasCheckin && <span className="text-xs text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-full px-3 py-1.5">✅ Check-In Done</span>}
          {hasCheckout && <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-3 py-1.5">✅ Check-Out Done</span>}
        </div>
      </div>

      {/* Existing inspections */}
      {inspections.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Previous Inspections</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {inspections.map(insp => <InspectionCard key={insp.id} insp={insp} />)}
          </div>
        </div>
      )}

      {/* New inspection form */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: damage diagram + condition */}
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-white uppercase tracking-wider">Damage Assessment</h2>

          {/* Inspection type toggle */}
          <div className="grid grid-cols-2 gap-2">
            {(['checkin', 'checkout'] as const).map(t => (
              <button key={t} onClick={() => setInspType(t)}
                className={`py-2.5 rounded-xl text-sm font-medium border transition-all ${
                  inspType === t
                    ? t === 'checkin'
                      ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                      : 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                    : 'border-white/10 text-slate-500 hover:border-white/20'
                }`}>
                {t === 'checkin' ? '🚗 Check-In' : '🔑 Check-Out'}
              </button>
            ))}
          </div>

          {/* Vehicle diagram */}
          <VehicleDiagram damaged={damaged} onToggle={toggleZone} />

          {/* Damaged zones list */}
          {hasDamage && (
            <div className="flex flex-wrap gap-1.5">
              {Array.from(damaged).map(id => (
                <span key={id}
                  className="text-xs bg-red-500/20 border border-red-500/30 text-red-300 rounded-full px-2 py-0.5 cursor-pointer hover:bg-red-500/30"
                  onClick={() => toggleZone(id)}>
                  ⚠️ {DAMAGE_ZONES.find(z => z.id === id)?.label ?? id} ✕
                </span>
              ))}
            </div>
          )}

          {/* Condition grade */}
          <div className="space-y-2">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Overall Condition Grade</p>
            <div className="grid grid-cols-4 gap-2">
              {CONDITION_GRADES.map(g => (
                <button key={g.grade} onClick={() => setGrade(g.grade)}
                  className={`py-2 rounded-xl border text-center transition-all ${
                    grade === g.grade ? g.bg : 'border-white/10 bg-slate-800/40 hover:border-white/20'
                  }`}>
                  <p className={`text-xl font-bold ${grade === g.grade ? g.color : 'text-slate-600'}`}>{g.grade}</p>
                  <p className={`text-xs mt-0.5 ${grade === g.grade ? g.color : 'text-slate-600'}`}>{g.label}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-600 italic">
              {CONDITION_GRADES.find(g => g.grade === grade)?.desc}
            </p>
          </div>
        </div>

        {/* Right: details + signature */}
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-white uppercase tracking-wider">Inspection Details</h2>

          {/* Mileage + inspector */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1.5">Odometer (km)</label>
              <input type="number" value={mileage} onChange={e => setMileage(e.target.value)}
                placeholder="e.g. 24500"
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/40" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1.5">Inspector Name</label>
              <input value={inspector} onChange={e => setInspector(e.target.value)}
                placeholder="Staff name"
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/40" />
            </div>
          </div>

          {/* Fuel level */}
          <div>
            <label className="text-xs text-slate-500 block mb-2">Fuel Level</label>
            <FuelGauge value={fuelLevel} onChange={setFuelLevel} />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-slate-500 block mb-1.5">Inspection Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Additional observations…" rows={3}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/40 resize-none" />
          </div>

          {/* Damage claim creation */}
          {hasDamage && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={createClaim} onChange={e => setCreateClaim(e.target.checked)} className="accent-red-500" />
                <span className="text-sm text-red-300 font-medium">Auto-create damage claim</span>
              </label>
              {createClaim && (
                <div className="space-y-2">
                  <input value={claimNote} onChange={e => setClaimNote(e.target.value)}
                    placeholder="Damage claim description (optional)"
                    className="w-full bg-slate-900/60 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none" />
                  <input type="number" value={claimCost} onChange={e => setClaimCost(e.target.value)}
                    placeholder="Estimated repair cost (AED)"
                    className="w-full bg-slate-900/60 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none" />
                </div>
              )}
            </div>
          )}

          {/* Signature */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Customer Signature</span>
              <button onClick={clearSig} className="text-slate-600 hover:text-slate-400">Clear</button>
            </div>
            <canvas ref={canvasRef} width={500} height={120}
              className="w-full h-24 bg-slate-800 border border-white/10 rounded-xl touch-none cursor-crosshair"
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
              onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw} />
            {!signed && <p className="text-xs text-slate-600 text-center">Sign above</p>}
          </div>

          {/* Status messages */}
          {error   && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>}
          {success && <p className="text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">✅ {success}</p>}

          {/* Submit */}
          <button onClick={submit} disabled={saving}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl text-sm transition-colors">
            {saving ? 'Saving…' : `💾 Save ${inspType === 'checkin' ? 'Check-In' : 'Check-Out'} Inspection`}
          </button>
        </div>
      </div>
    </div>
  );
}
