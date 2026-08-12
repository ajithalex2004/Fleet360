/**
 * src/app/(driver)/driver-app/fuel-entry/page.tsx
 *
 * Fuel entry form. Captures:
 *   - Liters (decimal)
 *   - Cost (in major currency units — converted to minor units on submit)
 *   - Currency (default AED)
 *   - Odometer reading (optional)
 *   - Filling location (lat/lng via geolocation API, optional
 *     human-readable name typed by the driver)
 *   - Bill photo (camera or file picker)
 *   - Free-form notes
 *
 * Submission posts to /api/driver-app/fuel-entries. The server resolves
 * the active shift automatically and FKs the entry to it. Idempotent
 * on the client-generated UUID — safe to retry from the offline sync
 * queue.
 */

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { BackButton } from '@/components/driver-app/BackButton';
import { newId } from '@/lib/driver-offline/db';

interface LocationState {
  lat: number;
  lng: number;
  name?: string;
}

export default function FuelEntryPage() {
  const router = useRouter();
  const [liters, setLiters] = useState('');
  const [costMajor, setCostMajor] = useState('');
  const [currency, setCurrency] = useState('AED');
  const [odometer, setOdometer] = useState('');
  const [location, setLocation] = useState<LocationState | null>(null);
  const [locationName, setLocationName] = useState('');
  const [notes, setNotes] = useState('');
  const [billPhoto, setBillPhoto] = useState<{ id: string; mime: string; data: string; size: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generate a UUID for the entry. Same value across retries (idempotency).
  // Uses newId() from the offline lib which has a fallback for browsers
  // without crypto.randomUUID (older Safari, insecure HTTP origins, etc).
  const entryId = useRef<string>(newId());
  const photoId = useRef<string>(newId());

  const captureLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setErr('Geolocation not available on this device.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setErr(null);
      },
      (e) => {
        // Don't block — location is optional. We try again on save.
        console.warn('[fuel-entry] location capture failed:', e.message);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }, []);

  // Capture location automatically on mount, and on every save. The
  // user doesn't have to tap a separate button.
  //
  // Returns a Promise that resolves to the captured location, or null
  // if capture failed / unavailable / timed out. The caller awaits
  // this before submitting so the most recent GPS reading is saved.
  const captureLocationAsync = useCallback((): Promise<LocationState | null> => {
    return new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setLocation(loc);
          resolve(loc);
        },
        () => {
          // Silent — save proceeds without location.
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 8_000, maximumAge: 0 },
      );
    });
  }, []);

  // Best-effort capture on mount. We don't block the form render.
  useEffect(() => {
    captureLocation();
  }, [captureLocation]);

  const onPhotoChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5_000_000) {
      setErr('Photo is too large (max 5 MB).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const base64 = dataUrl.split(',')[1] ?? '';
      setBillPhoto({
        id: photoId.current,
        mime: file.type,
        data: base64,
        size: file.size,
      });
      setErr(null);
    };
    reader.onerror = () => setErr('Could not read photo.');
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    setErr(null);
    const L = Number(liters);
    const C = Number(costMajor);
    if (!Number.isFinite(L) || L <= 0) {
      setErr('Enter a valid liter amount.');
      return;
    }
    if (!Number.isFinite(C) || C < 0) {
      setErr('Enter a valid cost amount.');
      return;
    }
    setBusy(true);
    try {
      // Auto-capture the most recent GPS reading right before save.
      // We use whatever we have; if it fails (denied, no GPS, timeout)
      // we save without location — it's optional, not blocking.
      const captured = await captureLocationAsync();
      const finalLocation = captured ?? location;

      // Zod's strict datetime() wants YYYY-MM-DDTHH:mm:ssZ (no ms).
      // new Date().toISOString() includes milliseconds, which Zod 4
      // rejects. Strip the ms for safe round-trip.
      const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

      const body: Record<string, unknown> = {
        id: entryId.current,
        liters: L,
        // Convert major units to minor units (fils for AED).
        // 1.00 AED = 100 fils. We multiply by 100 and round.
        costMinor: Math.round(C * 100),
        currency,
        odometer: odometer ? Number(odometer) : undefined,
        locationLat: finalLocation?.lat,
        locationLng: finalLocation?.lng,
        locationName: locationName || undefined,
        notes: notes || undefined,
        filledAt: nowIso,
      };
      if (billPhoto) {
        body.billPhoto = billPhoto;
      }
      const res = await fetch('/api/driver-app/fuel-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`save failed: ${res.status} ${t.slice(0, 200)}`);
      }
      setSubmittedId(entryId.current);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'submit failed');
    } finally {
      setBusy(false);
    }
  };

  if (submittedId) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-stretch justify-center px-6 py-10">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 text-2xl font-bold text-white">
            ✓
          </div>
          <h1 className="text-2xl font-bold text-white">Fuel entry saved</h1>
          <p className="mt-2 text-sm text-slate-400">
            {liters} L · {costMajor} {currency}
            {location && ` · ${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/driver-app/menu')}
          className="rounded-xl bg-violet-600 px-4 py-4 text-base font-semibold text-white transition hover:bg-violet-500"
        >
          Back to menu
        </button>
        <button
          type="button"
          onClick={() => {
            setSubmittedId(null);
            setLiters('');
            setCostMajor('');
            setOdometer('');
            setLocation(null);
            setLocationName('');
            setNotes('');
            setBillPhoto(null);
            entryId.current = newId();
            photoId.current = newId();
          }}
          className="mt-3 rounded-xl border border-white/10 px-4 py-3 text-sm font-medium text-slate-300 hover:bg-white/5"
        >
          Log another fill-up
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-slate-950 pb-24">
      <header className="border-b border-white/10 bg-slate-900/95 px-4 py-3">
        <div className="flex items-center gap-2">
          <BackButton />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">New</div>
            <div className="text-xl font-bold text-white truncate">Fuel Entry</div>
          </div>
        </div>
      </header>

      <main className="space-y-4 px-4 py-4">
        {/* Liters + cost */}
        <section className="rounded-2xl border border-white/10 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-300">
            Fill-up
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-400">Liters</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                required
                placeholder="0.00"
                value={liters}
                onChange={(e) => setLiters(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-3 text-base text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Cost</span>
              <div className="mt-1 flex gap-1">
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="rounded-l-lg border border-r-0 border-white/10 bg-slate-950 px-2 text-sm text-white focus:border-violet-500 focus:outline-none"
                >
                  <option value="AED">AED</option>
                  <option value="INR">INR</option>
                  <option value="USD">USD</option>
                  <option value="SAR">SAR</option>
                </select>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  required
                  placeholder="0.00"
                  value={costMajor}
                  onChange={(e) => setCostMajor(e.target.value)}
                  className="w-full rounded-r-lg border border-white/10 bg-slate-950 px-3 py-3 text-base text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
                />
              </div>
            </label>
          </div>
          <label className="mt-3 block">
            <span className="text-xs text-slate-400">Odometer (optional)</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              placeholder="e.g. 42150"
              value={odometer}
              onChange={(e) => setOdometer(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-3 text-base text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
            />
          </label>
        </section>

        {/* Location */}
        <section className="rounded-2xl border border-white/10 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-300">
            Filling location
          </h2>
          {location ? (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              <span>📍</span>
              <span>{location.lat.toFixed(5)}, {location.lng.toFixed(5)}</span>
              <button
                type="button"
                onClick={() => setLocation(null)}
                className="ml-auto text-xs text-emerald-300 underline"
              >
                Clear
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={captureLocation}
              className="mb-2 w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-3 text-sm text-slate-200 hover:bg-slate-700"
            >
              📍 Capture current location
            </button>
          )}
          <label className="block">
            <span className="text-xs text-slate-400">Station name (optional)</span>
            <input
              type="text"
              placeholder="e.g. ADNOC Al Quoz"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-3 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
            />
          </label>
        </section>

        {/* Bill photo */}
        <section className="rounded-2xl border border-white/10 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-300">
            Bill photo (optional)
          </h2>
          {billPhoto ? (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              <span>📎</span>
              <span className="flex-1 truncate">{(billPhoto.size / 1024).toFixed(0)} KB · {billPhoto.mime}</span>
              <button
                type="button"
                onClick={() => setBillPhoto(null)}
                className="text-xs text-emerald-300 underline"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-3 text-sm text-slate-200 hover:bg-slate-700"
            >
              📷 Take / pick bill photo
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPhotoChosen}
            className="hidden"
          />
        </section>

        {/* Notes */}
        <label className="block rounded-2xl border border-white/10 bg-slate-900 p-4">
          <span className="text-xs text-slate-400">Notes (optional)</span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything notable about this fill-up"
            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
          />
        </label>

        {err && (
          <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
            {err}
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={busy || !liters || !costMajor}
          className="sticky bottom-4 w-full rounded-2xl bg-amber-500 px-4 py-4 text-base font-semibold text-slate-950 shadow-lg transition hover:bg-amber-400 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save fuel entry'}
        </button>
      </main>
    </div>
  );
}
