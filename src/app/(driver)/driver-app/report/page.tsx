/**
 * src/app/(driver)/driver-app/report/page.tsx
 *
 * Driver "file a report" form. The driver picks REQUEST or INCIDENT,
 * the type (with the catalogue of valid options per kind), then for
 * REQUEST types a sub-type (e.g. MAINTENANCE → PREVENTIVE / CORRECTIVE
 * / SCHEDULED / BREAKDOWN_ACCIDENT), and for INCIDENT the severity
 * (auto-defaulted from the type — ACCIDENT/BREAKDOWN → HIGH, others
 * → LOW — and the driver can override).
 *
 * On submit, POSTs to /api/driver-app/reports. On success, shows a
 * confirmation and links to "My Reports" so the driver can see the
 * report land in the list.
 */

'use client';

import React, { Suspense, useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BackButton } from '@/components/driver-app/BackButton';
import {
  REQUEST_TYPES,
  INCIDENT_TYPES,
  INCIDENT_SEVERITIES,
  SEVERITY_META,
  getTypeMeta,
  getSubtypeMeta,
  getRequestSubtypeCatalogue,
  isRequestType,
  isIncidentType,
  isSeverity,
  defaultSeverity,
  type ReportKind,
  type ReportType,
  type Severity,
  type RequestSubtype,
} from '@/lib/driver-reports';

interface TripCtx {
  tripId: string | null;
}

function ReportInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [kind, setKind] = useState<ReportKind>('REQUEST');
  const [type, setType] = useState<ReportType>('MAINTENANCE');
  const [subtype, setSubtype] = useState<RequestSubtype | null>(null);
  const [severity, setSeverity] = useState<Severity>('HIGH');
  const [severityTouched, setSeverityTouched] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Reset type/subtype if the user flips kind and the current type
  // doesn't belong to the new kind.
  useEffect(() => {
    if (kind === 'REQUEST' && !isRequestType(type)) {
      setType('MAINTENANCE');
      setSubtype(null);
    }
    if (kind === 'INCIDENT' && !isIncidentType(type)) {
      setType('ACCIDENT');
      setSubtype(null);
    }
  }, [kind, type]);

  // Reset subtype if type changes within REQUEST (e.g. MAINTENANCE →
  // WASHING). The current subtype might not belong to the new catalogue.
  useEffect(() => {
    if (kind !== 'REQUEST') return;
    const catalogue = getRequestSubtypeCatalogue(type);
    if (!catalogue) return;
    if (subtype && !catalogue.includes(subtype)) setSubtype(null);
  }, [kind, type, subtype]);

  // Auto-default severity from the incident type. Only fires the first
  // time the type changes — once the driver has manually chosen a
  // severity (severityTouched=true), we leave it alone so they can
  // override (e.g. a "major" accident → CRITICAL).
  useEffect(() => {
    if (kind !== 'INCIDENT') return;
    if (severityTouched) return;
    const def = defaultSeverity(type);
    if (def) setSeverity(def);
  }, [kind, type, severityTouched]);

  // Read optional trip context from the query string (e.g. when the
  // driver taps "Report an issue with this trip" from a trip card).
  const tripCtx: TripCtx = {
    tripId: params?.get('tripId') ?? null,
  };

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErr('Please add a short title so the dispatcher knows what to look at');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      // Best-effort location capture (silent failure)
      const loc = await captureLocationAsync(3000).catch(() => null);
      const body: Record<string, unknown> = {
        kind,
        type,
        title: title.trim(),
      };
      if (kind === 'REQUEST' && subtype) body.subtype = subtype;
      if (description.trim()) body.description = description.trim();
      if (kind === 'INCIDENT' && isSeverity(severity)) body.severity = severity;
      if (tripCtx.tripId) body.tripId = tripCtx.tripId;
      if (loc) {
        body.lat = loc.lat;
        body.lng = loc.lng;
        body.accuracyM = loc.accuracyM;
      }
      const r = await fetch('/api/driver-app/reports', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}));
        setErr(errBody.error ?? `Failed (${r.status})`);
        return;
      }
      const data = await r.json();
      setSuccess(`Filed · #${data.id.slice(0, 8)}`);
      setTimeout(() => router.push('/driver-app/reports'), 800);
    } finally {
      setSubmitting(false);
    }
  }, [kind, type, subtype, severity, title, description, tripCtx.tripId, router]);

  const types = kind === 'REQUEST' ? REQUEST_TYPES : INCIDENT_TYPES;
  const typeMeta = getTypeMeta(kind, type);
  const subtypeCatalogue = useMemo(
    () => kind === 'REQUEST' ? (getRequestSubtypeCatalogue(type) ?? []) : [],
    [kind, type],
  );
  const defaultSev = kind === 'INCIDENT' ? defaultSeverity(type) : null;

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-slate-950 pb-24">
      <header className="border-b border-white/10 bg-slate-900/95 px-4 py-3">
        <div className="flex items-center gap-2">
          <BackButton />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">File a report</div>
            <div className="text-xl font-bold text-white truncate">What happened?</div>
          </div>
        </div>
      </header>

      <main className="space-y-4 px-4 py-4">
        {success ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            ✓ {success} — taking you to My Reports…
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {/* Kind selector (REQUEST vs INCIDENT) */}
            <div className="rounded-2xl border border-white/10 bg-slate-900 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                What is it?
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setKind('REQUEST')}
                  className={`rounded-xl px-3 py-3 text-left transition ${
                    kind === 'REQUEST'
                      ? 'border-violet-500/50 bg-violet-500/15 ring-1 ring-violet-500/30'
                      : 'border-white/10 bg-slate-800 hover:bg-slate-700'
                  } border`}
                >
                  <div className="text-2xl">🛠️</div>
                  <div className="mt-1 text-sm font-semibold text-white">Request</div>
                  <div className="text-[11px] text-slate-400">Need something from the team</div>
                </button>
                <button
                  type="button"
                  onClick={() => setKind('INCIDENT')}
                  className={`rounded-xl px-3 py-3 text-left transition ${
                    kind === 'INCIDENT'
                      ? 'border-rose-500/50 bg-rose-500/15 ring-1 ring-rose-500/30'
                      : 'border-white/10 bg-slate-800 hover:bg-slate-700'
                  } border`}
                >
                  <div className="text-2xl">⚠️</div>
                  <div className="mt-1 text-sm font-semibold text-white">Incident</div>
                  <div className="text-[11px] text-slate-400">Something that happened</div>
                </button>
              </div>
            </div>

            {/* Type selector (the catalogue of valid options for this kind) */}
            <div className="rounded-2xl border border-white/10 bg-slate-900 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {kind === 'REQUEST' ? 'What do you need?' : 'What kind?'}
              </div>
              <div className="space-y-2">
                {types.map((t) => {
                  const meta = getTypeMeta(kind, t);
                  if (!meta) return null;
                  const selected = type === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setType(t)}
                      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                        selected
                          ? 'border-violet-500/50 bg-violet-500/15 ring-1 ring-violet-500/30'
                          : 'border-white/10 bg-slate-800 hover:bg-slate-700'
                      }`}
                    >
                      <div className="text-2xl">{meta.emoji}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-white">{meta.label}</div>
                        <div className="text-[11px] text-slate-400">{meta.hint}</div>
                      </div>
                      {selected && <div className="text-violet-300">✓</div>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sub-type picker (REQUEST only — each type has its own catalogue) */}
            {kind === 'REQUEST' && subtypeCatalogue.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-slate-900 p-4">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Sub-type <span className="text-rose-400">*</span>
                </div>
                <div className="mb-2 text-[11px] text-slate-500">
                  Pick the closest match — helps the right team pick it up.
                </div>
                <div className="space-y-1.5">
                  {subtypeCatalogue.map((s) => {
                    const meta = getSubtypeMeta(s);
                    if (!meta) return null;
                    const selected = subtype === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSubtype(s)}
                        className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                          selected
                            ? 'border-violet-500/50 bg-violet-500/15 ring-1 ring-violet-500/30'
                            : 'border-white/10 bg-slate-800 hover:bg-slate-700'
                        }`}
                      >
                        <div className="text-lg">{meta.emoji}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white">{meta.label}</div>
                          <div className="text-[11px] text-slate-500">{meta.hint}</div>
                        </div>
                        {selected && <div className="text-violet-300 text-sm">✓</div>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Severity (only for INCIDENT) — auto-defaulted from the type */}
            {kind === 'INCIDENT' && (
              <div className="rounded-2xl border border-white/10 bg-slate-900 p-4">
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Severity
                  </div>
                  {defaultSev && (
                    <div className="text-[11px] text-slate-500">
                      default for {typeMeta?.label ?? type}: <span className="font-semibold text-slate-300">{SEVERITY_META[defaultSev].label}</span>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {INCIDENT_SEVERITIES.map((s) => {
                    const meta = SEVERITY_META[s];
                    const selected = severity === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          setSeverity(s);
                          setSeverityTouched(true);
                        }}
                        className={`rounded-xl px-2 py-2 text-center text-xs font-semibold transition ${
                          selected
                            ? meta.cls + ' ring-1 ring-white/30'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 text-[11px] text-slate-500">
                  You can override the default (e.g. a major accident → Critical).
                </div>
              </div>
            )}

            {/* Title */}
            <div className="rounded-2xl border border-white/10 bg-slate-900 p-4">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                Short title <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder={typeMeta?.hint.split('.')[0] ?? 'e.g. Engine warning light'}
                className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-violet-500/50 focus:outline-none"
              />
              <div className="mt-1 text-right text-[10px] text-slate-500">
                {title.length}/200
              </div>
            </div>

            {/* Description */}
            <div className="rounded-2xl border border-white/10 bg-slate-900 p-4">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                Details (optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                rows={4}
                placeholder="Anything the dispatcher should know — what's happening, when it started, what you've already tried"
                className="w-full resize-none rounded-lg border border-white/10 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-violet-500/50 focus:outline-none"
              />
            </div>

            {/* Location note */}
            <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[11px] text-slate-400">
              📍 GPS location will be attached to the report (best-effort).
            </div>

            {/* Error */}
            {err && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                {err}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              className="w-full rounded-xl bg-violet-600 px-4 py-4 text-base font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
            >
              {submitting ? 'Filing…' : `File ${kind === 'REQUEST' ? 'Request' : 'Incident'}`}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}

/** Best-effort one-shot GPS. Returns null silently on failure. */
function captureLocationAsync(timeoutMs: number): Promise<{ lat: number; lng: number; accuracyM: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyM: pos.coords.accuracy,
      }),
      () => resolve(null),
      { timeout: timeoutMs, maximumAge: 5000, enableHighAccuracy: false },
    );
  });
}

export default function ReportPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">Loading…</div>}>
      <ReportInner />
    </Suspense>
  );
}
