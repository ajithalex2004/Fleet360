/**
 * src/app/(driver)/driver-app/expenses/page.tsx
 *
 * Expense entry form. Captures a per-trip expense (tolls, parking,
 * meals, fines, other) with an optional bill photo.
 *
 * Per the user's spec, every expense is tied to a SPECIFIC trip
 * (not just a shift). The trip selection comes from the offline
 * trip cache in IndexedDB; if the cache is empty, the driver can
 * still log a free-form expense with a typed trip reference.
 *
 * On submit: POST /api/driver-app/expenses. The server validates
 * trip ownership, resolves the active shift, and stores the
 * expense with the bill photo (if any).
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { BackButton } from '@/components/driver-app/BackButton';
import { getAllTrips, type OfflineTrip, newId } from '@/lib/driver-offline/db';

const CATEGORIES = [
  { code: 'TOLLS',   label: 'Tolls',   emoji: '🛣️' },
  { code: 'PARKING', label: 'Parking', emoji: '🅿️' },
  { code: 'MEALS',   label: 'Meals',   emoji: '🍽️' },
  { code: 'FINES',   label: 'Fines',   emoji: '🚓' },
  { code: 'OTHER',   label: 'Other',   emoji: '📦' },
] as const;

type CategoryCode = (typeof CATEGORIES)[number]['code'];

export default function ExpensesPage() {
  const router = useRouter();
  const [trips, setTrips] = useState<OfflineTrip[]>([]);
  const [tripId, setTripId] = useState<string>('');
  const [category, setCategory] = useState<CategoryCode>('TOLLS');
  const [amountMajor, setAmountMajor] = useState('');
  const [currency, setCurrency] = useState('AED');
  const [description, setDescription] = useState('');
  const [billPhoto, setBillPhoto] = useState<{ id: string; mime: string; data: string; size: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const entryId = useRef<string>(newId());
  const photoId = useRef<string>(newId());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await getAllTrips();
      if (cancelled) return;
      setTrips(all);
    })();
    return () => { cancelled = true; };
  }, []);

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
      setBillPhoto({ id: photoId.current, mime: file.type, data: base64, size: file.size });
      setErr(null);
    };
    reader.onerror = () => setErr('Could not read photo.');
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    setErr(null);
    const A = Number(amountMajor);
    if (!Number.isFinite(A) || A <= 0) {
      setErr('Enter a valid amount.');
      return;
    }
    setBusy(true);
    try {
      // Zod strict datetime() wants YYYY-MM-DDTHH:mm:ssZ (no ms).
      // new Date().toISOString() includes ms; strip them.
      const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

      const body: Record<string, unknown> = {
        id: entryId.current,
        category,
        amountMinor: Math.round(A * 100),
        currency,
        description: description || undefined,
        incurredAt: nowIso,
      };
      // Only include tripId if the user picked/typed one. The server
      // treats absent tripId as a free-form expense (no-trip
      // sentinel in the DB). This is realistic for parking tickets
      // paid before the trip roster loaded, meals between trips, etc.
      if (tripId) {
        body.tripId = tripId;
      }
      if (billPhoto) body.billPhoto = billPhoto;

      const res = await fetch('/api/driver-app/expenses', {
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
          <h1 className="text-2xl font-bold text-white">Expense saved</h1>
          <p className="mt-2 text-sm text-slate-400">
            {amountMajor} {currency} · {CATEGORIES.find((c) => c.code === category)?.label}
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
            setAmountMajor('');
            setDescription('');
            setBillPhoto(null);
            entryId.current = newId();
            photoId.current = newId();
          }}
          className="mt-3 rounded-xl border border-white/10 px-4 py-3 text-sm font-medium text-slate-300 hover:bg-white/5"
        >
          Log another expense
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
            <div className="text-xl font-bold text-white truncate">Expense</div>
          </div>
        </div>
      </header>

      <main className="space-y-4 px-4 py-4">
        {/* Trip selection */}
        <section className="rounded-2xl border border-white/10 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-300">
            Trip
          </h2>
          {trips.length > 0 ? (
            <select
              value={tripId}
              onChange={(e) => setTripId(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-3 text-base text-white focus:border-violet-500 focus:outline-none"
            >
              <option value="">Select a trip…</option>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.routeName} · {new Date(t.scheduledDeparture).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              placeholder="Paste a trip UUID"
              value={tripId}
              onChange={(e) => setTripId(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-3 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
            />
          )}
          {trips.length === 0 && (
            <p className="mt-2 text-xs text-slate-500">
              No trips in the offline cache. You can either:
              <br />· paste a trip UUID from the admin app, <strong>or</strong>
              <br />· leave this empty to log a free-form expense (parking ticket before the trip roster loaded, etc.)
            </p>
          )}
        </section>

        {/* Category */}
        <section className="rounded-2xl border border-white/10 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-300">
            Category
          </h2>
          <div className="grid grid-cols-5 gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => setCategory(c.code)}
                className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs transition ${
                  category === c.code
                    ? 'border-violet-500/50 bg-violet-500/15 text-white'
                    : 'border-white/10 bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <span className="text-2xl">{c.emoji}</span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Amount */}
        <section className="rounded-2xl border border-white/10 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-300">
            Amount
          </h2>
          <div className="flex gap-1">
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
              value={amountMajor}
              onChange={(e) => setAmountMajor(e.target.value)}
              className="w-full rounded-r-lg border border-white/10 bg-slate-950 px-3 py-3 text-base text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
            />
          </div>
        </section>

        {/* Description */}
        <label className="block rounded-2xl border border-white/10 bg-slate-900 p-4">
          <span className="text-xs text-slate-400">Description (optional)</span>
          <input
            type="text"
            placeholder="e.g. Salik gate fee · Al Quoz mall parking"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-3 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
          />
        </label>

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

        {err && (
          <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
            {err}
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={busy || !amountMajor}
          className="sticky bottom-4 w-full rounded-2xl bg-emerald-500 px-4 py-4 text-base font-semibold text-slate-950 shadow-lg transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save expense'}
        </button>
      </main>
    </div>
  );
}
