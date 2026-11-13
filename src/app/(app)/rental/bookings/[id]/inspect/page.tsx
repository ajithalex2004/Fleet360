'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Camera, Loader, Trash2 } from 'lucide-react';
import { SignaturePad } from '@/components/rental-counter/SignaturePad';
import { formatCanonicalFuelDisplay } from '@/lib/rental/fuel-odometer';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Inspection {
  id: string;
  type: 'pickup' | 'return' | 'checkin' | 'checkout' | string;
  mileage: number | null;
  fuelLevel: number | null;
  damages: string | null;
  damageMarkers?: unknown;
  photos?: string[] | string | null;
  conditionGrade?: string | null;
  signatureUrl?: string | null;
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

interface UploadedPhoto {
  url: string;
  name: string;
}

function isPickupInspection(type: string | null | undefined): boolean {
  return ['pickup', 'checkin', 'pre_rental'].includes((type ?? '').toLowerCase());
}

function isReturnInspection(type: string | null | undefined): boolean {
  return ['return', 'checkout', 'post_rental'].includes((type ?? '').toLowerCase());
}

// Damage zones for the vehicle diagram
const DAMAGE_ZONES = [
  { id: 'front', label: 'Front', x: 43, y: 5, w: 14, h: 10 },
  { id: 'rear', label: 'Rear', x: 43, y: 85, w: 14, h: 10 },
  { id: 'front_left', label: 'Front Left', x: 5, y: 12, w: 14, h: 10 },
  { id: 'front_right', label: 'Front Right', x: 81, y: 12, w: 14, h: 10 },
  { id: 'rear_left', label: 'Rear Left', x: 5, y: 75, w: 14, h: 10 },
  { id: 'rear_right', label: 'Rear Right', x: 81, y: 75, w: 14, h: 10 },
  { id: 'left_side', label: 'Left Side', x: 3, y: 40, w: 14, h: 18 },
  { id: 'right_side', label: 'Right Side', x: 83, y: 40, w: 14, h: 18 },
  { id: 'roof', label: 'Roof', x: 33, y: 34, w: 34, h: 28 },
  { id: 'windscreen', label: 'Windscreen', x: 33, y: 14, w: 34, h: 14 },
  { id: 'rear_window', label: 'Rear Window', x: 33, y: 68, w: 34, h: 14 },
];

const CONDITION_GRADES = [
  { grade: 'A', label: 'Excellent', color: 'text-emerald-400', bg: 'bg-emerald-500/20 border-emerald-500/40', desc: 'No damage, pristine condition' },
  { grade: 'B', label: 'Good', color: 'text-teal-400', bg: 'bg-teal-500/20 border-teal-500/40', desc: 'Minor wear, no significant damage' },
  { grade: 'C', label: 'Fair', color: 'text-amber-400', bg: 'bg-amber-500/20 border-amber-500/40', desc: 'Visible damage, needs attention' },
  { grade: 'D', label: 'Poor', color: 'text-red-400', bg: 'bg-red-500/20 border-red-500/40', desc: 'Major damage, repair required' },
];

// ── Fuel gauge ────────────────────────────────────────────────────────────────

function FuelGauge({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const levels = [0, 10, 25, 40, 50, 65, 75, 90, 100];
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-[var(--text-muted)]">
        <span>Empty</span>
        <span className="text-[var(--text-main)] font-medium">{formatCanonicalFuelDisplay(value)}</span>
        <span>Full</span>
      </div>
      <div className="relative h-8 bg-[var(--bg-surface)] rounded-full overflow-hidden border border-[var(--border-subtle)]">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            value >= 75 ? 'bg-emerald-500' : value >= 25 ? 'bg-amber-500' : 'bg-red-500'
          }`}
          style={{ width: `${value}%` }}
        />
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
        />
      </div>
      <div className="flex justify-between">
        {levels.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => onChange(l)}
            className={`text-xs px-1 py-0.5 rounded transition-colors ${
              value === l
                ? 'text-[var(--text-main)] bg-[var(--bg-surface-hover)]'
                : 'text-[var(--text-faint)] hover:text-[var(--text-muted)]'
            }`}
          >
            {l === 0 ? 'E' : l === 100 ? 'F' : `${l}`}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Vehicle diagram ───────────────────────────────────────────────────────────

function VehicleDiagram({
  damaged,
  onToggle,
}: {
  damaged: Set<string>;
  onToggle: (zoneId: string) => void;
}) {
  return (
    <div className="relative w-full" style={{ paddingBottom: '100%' }}>
      <div className="absolute inset-0 bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
        {/* Car body outline */}
        <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full p-4">
          {/* Body */}
          <rect x="20" y="10" width="60" height="80" rx="8" fill="#1e293b" stroke="#334155" strokeWidth="0.5" />
          {/* Cabin */}
          <rect x="28" y="28" width="44" height="40" rx="4" fill="#0f172a" stroke="#334155" strokeWidth="0.5" />
          {/* Wheels */}
          {[
            { x: 12, y: 20 },
            { x: 76, y: 20 },
            { x: 12, y: 68 },
            { x: 76, y: 68 },
          ].map((w, i) => (
            <circle key={i} cx={w.x} cy={w.y} r="8" fill="#0f172a" stroke="#475569" strokeWidth="1.5" />
          ))}
        </svg>

        {/* Damage zone buttons */}
        {DAMAGE_ZONES.map((zone) => (
          <button
            key={zone.id}
            type="button"
            onClick={() => onToggle(zone.id)}
            title={zone.label}
            className={`absolute transition-all rounded border text-xs font-bold ${
              damaged.has(zone.id)
                ? 'bg-red-500/70 border-red-400 text-[var(--text-main)] shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                : 'bg-[var(--bg-surface-hover)]/40 border-[var(--border-strong)]/60 text-[var(--text-faint)] hover:bg-amber-500/20 hover:border-amber-500/60 hover:text-amber-300'
            }`}
            style={{
              left: `${zone.x}%`,
              top: `${zone.y}%`,
              width: `${zone.w}%`,
              height: `${zone.h}%`,
              fontSize: '7px',
            }}
          >
            {damaged.has(zone.id) ? '✕' : '+'}
          </button>
        ))}

        <p className="absolute bottom-2 left-0 right-0 text-center text-xs text-[var(--text-faint)]">
          Tap zones to mark damage
        </p>
      </div>
    </div>
  );
}

// ── Existing inspection card ──────────────────────────────────────────────────

function InspectionCard({ insp }: { insp: Inspection }) {
  let damages: string[] = [];
  try {
    const parsed = JSON.parse(insp.damages ?? '[]');
    damages = Array.isArray(parsed) ? parsed.map(String) : insp.damages ? [insp.damages] : [];
  } catch {
    damages = insp.damages ? [insp.damages] : [];
  }

  let photos: string[] = [];
  if (Array.isArray(insp.photos)) {
    photos = insp.photos.filter((p): p is string => typeof p === 'string' && p.length > 0);
  } else if (typeof insp.photos === 'string' && insp.photos.trim()) {
    try {
      const parsedPhotos = JSON.parse(insp.photos);
      if (Array.isArray(parsedPhotos)) {
        photos = parsedPhotos.filter((p): p is string => typeof p === 'string' && p.length > 0);
      }
    } catch {
      photos = [insp.photos];
    }
  }

  const isPickup = isPickupInspection(insp.type);

  return (
    <div
      className={`rounded-2xl border p-4 space-y-2.5 ${
        isPickup ? 'bg-blue-500/10 border-blue-500/20' : 'bg-amber-500/10 border-amber-500/20'
      }`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${isPickup ? 'text-blue-300' : 'text-amber-300'}`}>
            {isPickup ? '🚗 Pre-Rental (Pick-Up)' : '🔑 Post-Rental (Return)'} Inspection
          </span>
          {insp.conditionGrade && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[var(--bg-surface)]/70 border border-[var(--border-subtle)] text-[var(--text-main)]">
              Grade {insp.conditionGrade}
            </span>
          )}
        </div>
        <span className="text-xs text-[var(--text-faint)]">
          {new Date(insp.createdAt).toLocaleDateString('en-AE', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-[var(--text-faint)]">Mileage</p>
          <p className="text-[var(--text-main)] font-mono">{insp.mileage?.toLocaleString() ?? '—'} km</p>
        </div>
        <div>
          <p className="text-[var(--text-faint)]">Fuel Level</p>
          <p className="text-[var(--text-main)]">{formatCanonicalFuelDisplay(insp.fuelLevel)}</p>
        </div>
        <div>
          <p className="text-[var(--text-faint)]">Inspector</p>
          <p className="text-[var(--text-main)]">{insp.inspector ?? '—'}</p>
        </div>
      </div>
      {damages.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {damages.map((d, i) => (
            <span
              key={i}
              className="text-xs bg-red-500/20 border border-red-500/30 text-red-300 rounded-full px-2 py-0.5"
            >
              ⚠️ {d}
            </span>
          ))}
        </div>
      )}
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {photos.map((url, idx) => (
            <a
              key={idx}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="block w-14 h-14 rounded-lg overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:opacity-90"
              title={`Inspection photo ${idx + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />
            </a>
          ))}
        </div>
      )}
      {insp.notes && <p className="text-xs text-[var(--text-faint)] italic">&quot;{insp.notes}&quot;</p>}
      {insp.signatureUrl && (
        <p className="text-[11px] text-emerald-400">✓ Customer signature captured</p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function InspectionPage() {
  const params = useParams<{ id: string }>();
  const bookingId = params?.id ?? '';

  const [booking, setBooking] = useState<Booking | null>(null);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Shared SignaturePad state
  const [sigDataUrl, setSigDataUrl] = useState<string | null>(null);
  const [sigResetKey, setSigResetKey] = useState(0);

  // Walkaround photos state
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);

  // Form state: 'pickup' = Pre-Rental (Pick-Up), 'return' = Post-Rental (Return)
  const [inspType, setInspType] = useState<'pickup' | 'return'>('pickup');
  const [mileage, setMileage] = useState('');
  const [fuelLevel, setFuelLevel] = useState(100);
  const [grade, setGrade] = useState('A');
  const [damaged, setDamaged] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [inspector, setInspector] = useState('');
  const [createClaim, setCreateClaim] = useState(false);
  const [claimNote, setClaimNote] = useState('');
  const [claimCost, setClaimCost] = useState('');

  const load = useCallback(async () => {
    if (!bookingId) return;
    setLoading(true);
    try {
      const [bRes, iRes] = await Promise.all([
        fetch(`/api/rental/bookings/${bookingId}`),
        fetch(`/api/rental/inspections?bookingId=${bookingId}`),
      ]);
      if (bRes.ok) {
        const bData = await bRes.json();
        setBooking(bData?.booking ?? bData);
      }
      if (iRes.ok) {
        const d = await iRes.json();
        const list = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : [];
        setInspections(list);
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-set inspection type based on existing inspections
  useEffect(() => {
    const hasPickup = inspections.some((i) => isPickupInspection(i.type));
    setInspType(hasPickup ? 'return' : 'pickup');
  }, [inspections]);

  const toggleZone = (zoneId: string) =>
    setDamaged((prev) => {
      const n = new Set(prev);
      if (n.has(zoneId)) {
        n.delete(zoneId);
      } else {
        n.add(zoneId);
      }
      return n;
    });

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadingPhoto(true);
    setError('');
    try {
      const uploaded: UploadedPhoto[] = [];
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('entityType', 'INSPECTION');
        formData.append('entityId', bookingId);
        formData.append('docType', 'VEHICLE_PHOTO');
        formData.append('docName', file.name);

        const res = await fetch('/api/rental/documents/upload', {
          method: 'POST',
          body: formData,
        });
        const resJson = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(resJson?.error || `Failed to upload ${file.name}`);
        }
        const fileUrl =
          resJson?.url ??
          resJson?.fileUrl ??
          resJson?.document?.fileUrl ??
          resJson?.storage?.url ??
          '';
        if (!fileUrl) {
          throw new Error(`Upload succeeded for ${file.name} but returned no URL`);
        }
        uploaded.push({ url: String(fileUrl), name: file.name });
      }
      setPhotos((prev) => [...prev, ...uploaded]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to upload inspection photo');
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) {
        photoInputRef.current.value = '';
      }
    }
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const submit = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const damageList = Array.from(damaged).map(
        (id) => DAMAGE_ZONES.find((z) => z.id === id)?.label ?? id,
      );
      const damageMarkers = Array.from(damaged).map((id) => {
        const zone = DAMAGE_ZONES.find((z) => z.id === id);
        return {
          zoneId: id,
          label: zone?.label ?? id,
          x: zone?.x ?? 0,
          y: zone?.y ?? 0,
        };
      });
      const photoUrls = photos.map((p) => p.url);

      const payload = {
        bookingId,
        vehicleId: booking?.vehicleId ?? undefined,
        type: inspType,
        mileage: mileage ? Number(mileage) : null,
        fuelLevel: Math.min(100, Math.max(0, Math.round(fuelLevel))),
        fuelUnit: 'PCT',
        damages: JSON.stringify(damageList),
        damageMarkers,
        photos: photoUrls,
        inspector: inspector || 'Operations',
        notes: notes || null,
        conditionGrade: grade,
        signatureUrl: sigDataUrl,
        signatureB64: sigDataUrl,
      };

      const res = await fetch('/api/rental/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error || (await res.text()) || 'Failed to save inspection');
      }

      // Create damage claim if requested and damage found — verify claimRes.ok!
      if (createClaim && damageList.length > 0) {
        const claimRes = await fetch('/api/rental/damage-claims', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId,
            vehicleId: booking?.vehicleId ?? undefined,
            description: `${inspType === 'pickup' ? 'Pre-rental (pick-up)' : 'Post-rental (return)'} damage: ${damageList.join(', ')}.${claimNote ? ` ${claimNote}` : ''}`,
            estimatedCost: claimCost ? parseFloat(claimCost) : null,
            photos: photoUrls,
            status: 'OPEN',
            insuranceClaim: false,
            billedToCustomer: false,
          }),
        });
        if (!claimRes.ok) {
          const claimErr = await claimRes.json().catch(() => ({}));
          await load();
          throw new Error(
            claimErr?.error ||
              `Inspection recorded, but damage claim creation failed (${claimRes.status})`,
          );
        }
      }

      setSuccess(
        createClaim && damageList.length > 0
          ? 'Inspection & damage claim saved successfully!'
          : 'Inspection saved successfully!',
      );
      setDamaged(new Set());
      setPhotos([]);
      setNotes('');
      setMileage('');
      setClaimNote('');
      setClaimCost('');
      setCreateClaim(false);
      setSigDataUrl(null);
      setSigResetKey((k) => k + 1);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save inspection');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 bg-[var(--bg-surface)]/60 rounded-2xl" />
        ))}
      </div>
    );
  }

  const hasDamage = damaged.size > 0;
  const hasPickupDone = inspections.some((i) => isPickupInspection(i.type));
  const hasReturnDone = inspections.some((i) => isReturnInspection(i.type));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-sm text-[var(--text-faint)] mb-1">
            <Link href="/rental/bookings" className="hover:text-[var(--text-muted)]">
              Bookings
            </Link>
            <span>/</span>
            <span className="font-mono text-[var(--text-muted)]">
              {booking?.bookingRef ?? bookingId.slice(0, 8)}
            </span>
            <span>/</span>
            <span>Inspection</span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Vehicle Inspection</h1>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">
            {booking?.customer?.fullName ?? '—'} · {booking?.vehicleCategory ?? 'Vehicle not specified'}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {hasPickupDone && (
            <span className="text-xs text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-full px-3 py-1.5">
              ✅ Pre-Rental (Pick-Up) Done
            </span>
          )}
          {hasReturnDone && (
            <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-3 py-1.5">
              ✅ Post-Rental (Return) Done
            </span>
          )}
        </div>
      </div>

      {/* Existing inspections */}
      {inspections.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wider">
            Previous Inspections
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {inspections.map((insp) => (
              <InspectionCard key={insp.id} insp={insp} />
            ))}
          </div>
        </div>
      )}

      {/* New inspection form */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: damage diagram + condition */}
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-[var(--text-main)] uppercase tracking-wider">
            Damage Assessment
          </h2>

          {/* Inspection type toggle */}
          <div className="grid grid-cols-2 gap-2">
            {(['pickup', 'return'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setInspType(t)}
                className={`py-2.5 rounded-xl text-sm font-medium border transition-all ${
                  inspType === t
                    ? t === 'pickup'
                      ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                      : 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                    : 'border-[var(--border-subtle)] text-[var(--text-faint)] hover:border-[var(--border-strong)]'
                }`}
              >
                {t === 'pickup' ? '🚗 Pre-Rental (Pick-Up)' : '🔑 Post-Rental (Return)'}
              </button>
            ))}
          </div>

          {/* Vehicle diagram */}
          <VehicleDiagram damaged={damaged} onToggle={toggleZone} />

          {/* Damaged zones list */}
          {hasDamage && (
            <div className="flex flex-wrap gap-1.5">
              {Array.from(damaged).map((id) => (
                <span
                  key={id}
                  className="text-xs bg-red-500/20 border border-red-500/30 text-red-300 rounded-full px-2 py-0.5 cursor-pointer hover:bg-red-500/30"
                  onClick={() => toggleZone(id)}
                >
                  ⚠️ {DAMAGE_ZONES.find((z) => z.id === id)?.label ?? id} ✕
                </span>
              ))}
            </div>
          )}

          {/* Condition grade */}
          <div className="space-y-2">
            <p className="text-xs text-[var(--text-faint)] uppercase tracking-wider">
              Overall Condition Grade
            </p>
            <div className="grid grid-cols-4 gap-2">
              {CONDITION_GRADES.map((g) => (
                <button
                  key={g.grade}
                  type="button"
                  onClick={() => setGrade(g.grade)}
                  className={`py-2 rounded-xl border text-center transition-all ${
                    grade === g.grade
                      ? g.bg
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 hover:border-[var(--border-strong)]'
                  }`}
                >
                  <p className={`text-xl font-bold ${grade === g.grade ? g.color : 'text-[var(--text-faint)]'}`}>
                    {g.grade}
                  </p>
                  <p className={`text-xs mt-0.5 ${grade === g.grade ? g.color : 'text-[var(--text-faint)]'}`}>
                    {g.label}
                  </p>
                </button>
              ))}
            </div>
            <p className="text-xs text-[var(--text-faint)] italic">
              {CONDITION_GRADES.find((g) => g.grade === grade)?.desc}
            </p>
          </div>
        </div>

        {/* Right: details + walkaround photos + signature */}
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-[var(--text-main)] uppercase tracking-wider">
            Inspection Details
          </h2>

          {/* Mileage + inspector */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-faint)] block mb-1.5">Odometer (km)</label>
              <input
                type="number"
                min={0}
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
                placeholder="e.g. 24500"
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2.5 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-emerald-500/40"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text-faint)] block mb-1.5">Inspector Name</label>
              <input
                value={inspector}
                onChange={(e) => setInspector(e.target.value)}
                placeholder="Staff name"
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2.5 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-emerald-500/40"
              />
            </div>
          </div>

          {/* Fuel level */}
          <div>
            <label className="text-xs text-[var(--text-faint)] block mb-2">Fuel Level</label>
            <FuelGauge value={fuelLevel} onChange={setFuelLevel} />
          </div>

          {/* Walkaround Photos */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-[var(--text-faint)]">
                Walkaround Photos ({photos.length})
              </label>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handlePhotoUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={uploadingPhoto}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-emerald-500/40 text-xs text-[var(--text-main)] disabled:opacity-40 transition-colors"
              >
                {uploadingPhoto ? (
                  <Loader className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                ) : (
                  <Camera className="w-3.5 h-3.5 text-emerald-400" />
                )}
                {uploadingPhoto ? 'Uploading…' : 'Upload Walkaround Photos'}
              </button>
            </div>
            {photos.length > 0 && (
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                {photos.map((photo, idx) => (
                  <div
                    key={`${photo.url}-${idx}`}
                    className="relative group rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-surface)] aspect-square"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.url}
                      alt={photo.name}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(idx)}
                      title="Remove photo"
                      className="absolute top-1 right-1 p-1 rounded-full bg-black/70 text-red-300 hover:text-red-200 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-[var(--text-faint)] block mb-1.5">Inspection Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional observations…"
              rows={3}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2.5 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-emerald-500/40 resize-none"
            />
          </div>

          {/* Damage claim creation */}
          {hasDamage && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createClaim}
                  onChange={(e) => setCreateClaim(e.target.checked)}
                  className="accent-red-500"
                />
                <span className="text-sm text-red-300 font-medium">Auto-create damage claim</span>
              </label>
              {createClaim && (
                <div className="space-y-2">
                  <input
                    value={claimNote}
                    onChange={(e) => setClaimNote(e.target.value)}
                    placeholder="Damage claim description (optional)"
                    className="w-full bg-[var(--bg-surface)]/60 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none"
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={claimCost}
                    onChange={(e) => setClaimCost(e.target.value)}
                    placeholder="Estimated repair cost (AED)"
                    className="w-full bg-[var(--bg-surface)]/60 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none"
                  />
                </div>
              )}
            </div>
          )}

          {/* Shared SignaturePad */}
          <SignaturePad
            key={sigResetKey}
            onChange={setSigDataUrl}
            label="Customer Signature"
          />

          {/* Status messages */}
          {error && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
              {error}
            </p>
          )}
          {success && (
            <p className="text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
              ✅ {success}
            </p>
          )}

          {/* Submit */}
          <button
            type="button"
            onClick={submit}
            disabled={saving || uploadingPhoto}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-[var(--text-main)] font-semibold py-3 rounded-xl text-sm transition-colors"
          >
            {saving
              ? 'Saving…'
              : `💾 Save ${inspType === 'pickup' ? 'Pre-Rental (Pick-Up)' : 'Post-Rental (Return)'} Inspection`}
          </button>
        </div>
      </div>
    </div>
  );
}
