'use client';

/**
 * Counter PWA — mobile-first vehicle handover.
 *
 * 3-step flow optimised for tablet / phone use at the counter:
 *   1. PICK    — choose a confirmed booking
 *   2. INSPECT — capture mileage, fuel, photos, damage walkaround markers
 *   3. SIGN    — customer signs on screen, submit creates agreement
 *
 * Uses existing infrastructure:
 *   - /api/leasing/documents/upload (storage adapter, reused for photos)
 *   - /api/rental/damage-claims/classify (optional AI assist after photo)
 *   - /api/rental/counter/handover (atomic submit)
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Camera, Sparkles, ChevronRight, ChevronLeft,
  CheckCircle2, AlertTriangle, X, Plus, Loader,
} from 'lucide-react';
import { SignaturePad } from '@/components/rental-counter/SignaturePad';
import { DamageWalkaround, type DamageMarker } from '@/components/rental-counter/DamageWalkaround';

interface Booking {
  id: string;
  bookingRef: string | null;
  customerId: string;
  vehicleCategory: string | null;
  vehicleId: string | null;
  pickupDate: string;
  dropoffDate: string;
  dailyRate: number | null;
  totalAmount: number | null;
  currency: string;
  status: string;
  customer?: { fullName: string; companyName: string | null; phone: string | null };
}

type Step = 'PICK' | 'INSPECT' | 'SIGN' | 'DONE';

interface Photo {
  url: string;
  name: string;
  size: number;
}

export default function CounterPage() {
  const [step, setStep] = useState<Step>('PICK');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Booking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inspection state
  const [mileageOut, setMileageOut] = useState('');
  const [fuelOut, setFuelOut] = useState(8);
  const [markers, setMarkers] = useState<DamageMarker[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiHint, setAiHint] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Signature
  const [signature, setSignature] = useState<string | null>(null);
  const [agreementNo, setAgreementNo] = useState<string | null>(null);

  const loadBookings = useCallback(async () => {
    try {
      const res = await fetch('/api/rental/bookings');
      const data = res.ok ? await res.json() : [];
      const eligible = (Array.isArray(data) ? data : [])
        .filter((b: any) => ['CONFIRMED', 'PENDING'].includes(b.status))
        .map((b: any) => ({
          id: b.id,
          bookingRef: b.bookingRef ?? null,
          customerId: b.customerId,
          vehicleCategory: b.vehicleCategory ?? null,
          vehicleId: b.vehicleId ?? null,
          pickupDate: b.pickupDate,
          dropoffDate: b.dropoffDate,
          dailyRate: b.dailyRate ? Number(b.dailyRate) : null,
          totalAmount: b.totalAmount ? Number(b.totalAmount) : null,
          currency: b.currency ?? 'AED',
          status: b.status,
          customer: b.customer,
        }));
      setBookings(eligible);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, []);

  // Register service worker once.
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/counter-sw.js').catch(() => {/* ignore */});
    }
    loadBookings();
  }, [loadBookings]);

  const filteredBookings = bookings.filter((b) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      (b.bookingRef ?? '').toLowerCase().includes(q) ||
      (b.customer?.fullName ?? '').toLowerCase().includes(q) ||
      (b.customer?.companyName ?? '').toLowerCase().includes(q) ||
      (b.vehicleCategory ?? '').toLowerCase().includes(q)
    );
  });

  async function uploadPhoto(file: File) {
    setUploadingPhoto(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('entityType', 'CONTRACT');
      fd.append('entityId', selected?.id ?? '00000000-0000-0000-0000-000000000000');
      fd.append('docType', 'VEHICLE_PHOTO');
      fd.append('docName', `Counter handover photo - ${file.name}`);
      const res = await fetch('/api/leasing/documents/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
      setPhotos((p) => [...p, { url: data.storage?.url ?? data.document?.fileUrl, name: file.name, size: file.size }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Photo upload failed');
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function classifyLastPhoto() {
    if (photos.length === 0) return;
    const lastPhoto = photos[photos.length - 1];
    setAiBusy(true);
    setAiHint(null);
    try {
      // Re-fetch the photo and submit to classifier
      const photoRes = await fetch(lastPhoto.url);
      const blob = await photoRes.blob();
      const fd = new FormData();
      fd.append('photo', new File([blob], lastPhoto.name, { type: blob.type }));
      const res = await fetch('/api/rental/damage-claims/classify', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        setAiHint(`AI: ${json.error ?? `error ${res.status}`}`);
        return;
      }
      const c = json.classification;
      setAiHint(`AI found ${c.damages.length} damage(s) — overall ${c.overallCondition}, billable est. AED ${c.billableEstimateMin}-${c.billableEstimateMax}.`);
    } catch (err) {
      setAiHint(err instanceof Error ? `AI error: ${err.message}` : 'AI request failed');
    } finally {
      setAiBusy(false);
    }
  }

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/rental/counter/handover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: selected.id,
          mileageOut: parseInt(mileageOut, 10) || 0,
          fuelOut,
          damageMarkers: markers,
          photoUrls: photos.map((p) => p.url),
          signatureDataUrl: signature ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Server returned ${res.status}`);
        return;
      }
      setAgreementNo(data.agreement?.agreementNo ?? null);
      setStep('DONE');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep('PICK');
    setSelected(null);
    setMileageOut('');
    setFuelOut(8);
    setMarkers([]);
    setPhotos([]);
    setSignature(null);
    setAgreementNo(null);
    setAiHint(null);
    setError(null);
    loadBookings();
  }

  /* ── RENDER ──────────────────────────────────────────────────────── */

  return (
    <div className="min-h-screen bg-[#0c1a3e] text-white">
      {/* Top app bar */}
      <header className="sticky top-0 z-10 bg-gradient-to-r from-teal-700 to-cyan-700 px-4 py-3 shadow-lg flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider opacity-90">Counter</div>
          <div className="text-base font-bold">{stepTitle(step)}</div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <StepDot active={step === 'PICK'}    done={step !== 'PICK'} label="1" />
          <StepDot active={step === 'INSPECT'} done={step === 'SIGN' || step === 'DONE'} label="2" />
          <StepDot active={step === 'SIGN'}    done={step === 'DONE'} label="3" />
        </div>
      </header>

      <main className="px-4 py-4 pb-32 max-w-2xl mx-auto">
        {error && (
          <div className="rounded-xl bg-rose-900/40 border border-rose-700 p-3 mb-4 text-rose-200 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* STEP 1 — PICK */}
        {step === 'PICK' && (
          <div className="space-y-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by booking ref, customer, or vehicle category…"
              className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500"
            />
            {filteredBookings.length === 0 ? (
              <div className="p-8 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-slate-400">
                No confirmed bookings to handover.
              </div>
            ) : filteredBookings.map((b) => (
              <button
                key={b.id}
                onClick={() => { setSelected(b); setStep('INSPECT'); }}
                className="w-full text-left p-4 rounded-xl bg-slate-800/60 border border-slate-700 hover:bg-slate-700/60 active:scale-[0.99] transition flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-mono text-cyan-300 text-xs">{b.bookingRef ?? b.id.slice(0, 8)}</div>
                  <div className="font-semibold text-white truncate">
                    {b.customer?.companyName ?? b.customer?.fullName ?? '—'}
                  </div>
                  <div className="text-xs text-slate-400 truncate">
                    {b.vehicleCategory ?? '—'} · {new Date(b.pickupDate).toLocaleDateString('en-GB')} → {new Date(b.dropoffDate).toLocaleDateString('en-GB')}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-xs text-slate-400">Total</div>
                  <div className="font-bold text-emerald-300">
                    AED {(b.totalAmount ?? 0).toLocaleString()}
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-500" />
              </button>
            ))}
          </div>
        )}

        {/* STEP 2 — INSPECT */}
        {step === 'INSPECT' && selected && (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-3">
              <div className="font-mono text-xs text-cyan-300">{selected.bookingRef ?? selected.id.slice(0, 8)}</div>
              <div className="font-semibold">{selected.customer?.companyName ?? selected.customer?.fullName ?? '—'}</div>
              <div className="text-xs text-slate-400">{selected.vehicleCategory ?? '—'}</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Mileage at pickup (km) *</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={mileageOut}
                  onChange={(e) => setMileageOut(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-lg"
                  placeholder="e.g. 24500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Fuel level *</label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <button
                      key={n}
                      onClick={() => setFuelOut(n)}
                      className={`flex-1 py-3 rounded text-xs font-bold transition ${
                        n <= fuelOut ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-500'
                      }`}
                    >
                      {n === 8 ? 'F' : n === 4 ? '½' : n === 1 ? 'E' : n}
                    </button>
                  ))}
                </div>
                <div className="text-xs text-slate-500 mt-1">{fuelOut}/8</div>
              </div>
            </div>

            <DamageWalkaround markers={markers} onChange={setMarkers} />

            {/* Photos */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 uppercase tracking-wider">
                  Walkaround photos {photos.length > 0 && <span className="text-cyan-300">· {photos.length}</span>}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadPhoto(file);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingPhoto}
                  className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-500 flex items-center gap-2 disabled:opacity-40"
                >
                  {uploadingPhoto ? <Loader className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                  {uploadingPhoto ? 'Uploading…' : 'Capture'}
                </button>
              </div>
              {photos.length > 0 && (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    {photos.map((p, i) => (
                      <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-slate-800 border border-slate-700">
                        <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                        <button
                          onClick={() => setPhotos(photos.filter((_, idx) => idx !== i))}
                          className="absolute top-1 right-1 w-6 h-6 rounded-full bg-rose-600 text-white flex items-center justify-center text-xs"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={classifyLastPhoto}
                    disabled={aiBusy}
                    className="w-full py-2 rounded-lg bg-violet-600/30 border border-violet-500/40 text-violet-200 text-xs font-medium hover:bg-violet-600/40 disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    <Sparkles className="h-4 w-4" />
                    {aiBusy ? 'AI analysing latest photo…' : 'AI · Classify latest photo'}
                  </button>
                  {aiHint && (
                    <div className="text-xs px-3 py-2 rounded bg-violet-900/30 border border-violet-500/30 text-violet-200">
                      {aiHint}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Step nav */}
            <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-700 p-3 flex gap-2 max-w-2xl mx-auto">
              <button
                onClick={() => setStep('PICK')}
                className="px-4 py-3 rounded-xl bg-slate-700 text-slate-200 font-medium flex items-center gap-1"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
              <button
                onClick={() => setStep('SIGN')}
                disabled={!mileageOut}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-medium hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-1"
              >
                Continue to sign <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3 — SIGN */}
        {step === 'SIGN' && selected && (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-3 text-sm">
              <div className="font-semibold">{selected.customer?.companyName ?? selected.customer?.fullName}</div>
              <div className="text-xs text-slate-400 mt-1">
                {markers.length} damage marker{markers.length === 1 ? '' : 's'} · {photos.length} photo{photos.length === 1 ? '' : 's'} · mileage {mileageOut} km · fuel {fuelOut}/8
              </div>
            </div>

            <SignaturePad onChange={setSignature} label="Customer signature" />

            <p className="text-xs text-slate-500 italic">
              By signing, the customer confirms: vehicle inspected, damage walkaround
              recorded, mileage and fuel levels acknowledged, and rental terms accepted.
            </p>

            <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-700 p-3 flex gap-2 max-w-2xl mx-auto">
              <button
                onClick={() => setStep('INSPECT')}
                className="px-4 py-3 rounded-xl bg-slate-700 text-slate-200 font-medium flex items-center gap-1"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
              <button
                onClick={submit}
                disabled={busy || !signature}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-medium hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {busy ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {busy ? 'Submitting…' : 'Confirm & Submit Handover'}
              </button>
            </div>
          </div>
        )}

        {/* STEP 4 — DONE */}
        {step === 'DONE' && (
          <div className="rounded-2xl bg-emerald-900/30 border border-emerald-500/40 p-6 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto" />
            <div>
              <h2 className="text-xl font-bold">Handover complete</h2>
              <p className="text-sm text-emerald-200 mt-1">
                Booking is now ACTIVE. Agreement{' '}
                <span className="font-mono">{agreementNo ?? '—'}</span> created.
              </p>
            </div>
            <div className="flex gap-2 justify-center flex-wrap">
              {agreementNo && (
                <Link
                  href={`/rental/agreements`}
                  className="px-4 py-2 rounded-lg bg-slate-700 text-white text-sm hover:bg-slate-600"
                >
                  View Agreement
                </Link>
              )}
              <button onClick={reset} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500">
                <Plus className="h-4 w-4 inline mr-1" />
                Next handover
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function stepTitle(s: Step): string {
  switch (s) {
    case 'PICK': return 'Pick a booking';
    case 'INSPECT': return 'Walkaround inspection';
    case 'SIGN': return 'Customer signature';
    case 'DONE': return 'Done';
  }
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${
      done ? 'bg-emerald-500 border-emerald-300 text-white' :
      active ? 'bg-white text-teal-700 border-white' :
      'bg-transparent border-white/40 text-white/60'
    }`}>
      {done ? '✓' : label}
    </div>
  );
}
