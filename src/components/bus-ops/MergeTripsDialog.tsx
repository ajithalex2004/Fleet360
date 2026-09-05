'use client';

/**
 * MergeTripsDialog — UI over /api/bus-ops/merge-trips/{preview,apply}.
 *
 * Operator picks 2+ SCHEDULED trips on the Trip Schedules page, opens
 * this dialog. The dialog shows a source-trip summary, a form for the
 * merged trip (vehicle + driver + times), and two actions:
 *   Preview — POST /preview, render {verdict, checks, penalty}
 *   Apply   — POST /apply (enabled only after a non-BLOCK preview)
 *
 * Merged-trip defaults:
 *   routeId       = first source's route (a mixed-route merge is flagged)
 *   departureTime = earliest source departure
 *   arrivalTime   = latest source arrival
 *   stops         = fetched from /api/bus-ops/routes/{routeId}/stops on
 *                   open; the backend requires a non-empty stops list.
 *                   Editing individual stops is deferred — the common
 *                   case merges same-route trips where the source stops
 *                   are correct.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, PlayCircle, CheckCircle2, AlertTriangle, XCircle, Loader2 } from 'lucide-react';

// ─── Types matched to backend contracts ─────────────────────────────

export interface ScheduleForMerge {
  id: string;
  tripNumber?: string;
  routeId: string;
  route?: { name?: string };
  departureTime: string;
  arrivalTime?: string;
  confirmedCount?: number;
  capacity?: number;
}

interface VehicleOption {
  id: string;
  licensePlate?: string | null;
  make?: string | null;
  model?: string | null;
}

interface DriverOption {
  id: string;
  name: string;
  licenseType?: string | null;
}

interface RouteStopRow {
  id: string;
  placeId: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  sequence: number;
}

interface PreviewCheck {
  code: string;
  outcome: 'PASS' | 'WARN' | 'BLOCK' | 'PENALTY';
  message: string;
}

interface PreviewResult {
  verdict: 'PASS' | 'WARN' | 'BLOCK';
  checks: PreviewCheck[];
  totalPenalty: number;
  preview: { sourceTripIds: string[]; passengerCount: number; capacity: number | null };
}

interface PreviewError {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

// ─── Component ──────────────────────────────────────────────────────

export default function MergeTripsDialog({
  sources,
  vehicles,
  drivers,
  onClose,
  onApplied,
}: {
  sources: ScheduleForMerge[];
  vehicles: VehicleOption[];
  drivers: DriverOption[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const defaults = useMemo(() => deriveDefaults(sources), [sources]);
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [departureTime, setDeparture] = useState(defaults.departureTime);
  const [arrivalTime, setArrival] = useState(defaults.arrivalTime);
  const [latestArrival, setLatestArrival] = useState('');
  const [notes, setNotes] = useState('');

  const [stops, setStops] = useState<RouteStopRow[] | null>(null);
  const [stopsError, setStopsError] = useState<string | null>(null);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);

  const mixedRoutes = defaults.mixedRoutes;
  const routeId = defaults.routeId;

  // Fetch the route's stops on open so we have something to send in the
  // merged trip's `stops` array (backend requires it non-empty).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStops(null); setStopsError(null);
      try {
        const res = await fetch(`/api/bus-ops/routes/${routeId}/stops`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const list: RouteStopRow[] = Array.isArray(data) ? data : (data?.stops ?? []);
        setStops(list);
        if (list.length === 0) setStopsError('Route has no stops with GPS — merge cannot proceed.');
      } catch (e) {
        if (!cancelled) setStopsError(e instanceof Error ? e.message : 'Failed to load route stops');
      }
    })();
    return () => { cancelled = true; };
  }, [routeId]);

  const buildMergePayload = useCallback(() => {
    const mergedStops = (stops ?? [])
      .filter((s) => s.placeId && s.gpsLat != null && s.gpsLng != null)
      .map((s) => ({ placeId: s.placeId!, lat: s.gpsLat!, lng: s.gpsLng!, sequence: s.sequence }));
    return {
      sourceTripIds: sources.map((s) => s.id),
      merged: {
        routeId,
        vehicleId,
        driverId,
        departureTime: new Date(departureTime).toISOString(),
        arrivalTime: new Date(arrivalTime).toISOString(),
        latestArrivalTime: latestArrival ? new Date(latestArrival).toISOString() : null,
        stops: mergedStops,
        notes: notes.trim() || null,
      },
    };
  }, [stops, sources, routeId, vehicleId, driverId, departureTime, arrivalTime, latestArrival, notes]);

  const runPreview = async () => {
    setPreview(null); setPreviewError(null); setPreviewing(true);
    try {
      const res = await fetch('/api/bus-ops/merge-trips/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildMergePayload()),
      });
      const data = await res.json() as PreviewResult | PreviewError;
      if (!res.ok) {
        // 400s from structural / source-state guards
        const err = data as PreviewError;
        throw new Error(err.error + (err.code ? ` (${err.code})` : ''));
      }
      setPreview(data as PreviewResult);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const runApply = async () => {
    setApplying(true);
    try {
      const res = await fetch('/api/bus-ops/merge-trips/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildMergePayload()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onApplied();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Apply failed');
    } finally {
      setApplying(false);
    }
  };

  const canPreview =
    vehicleId && driverId && stops && stops.length > 0 &&
    !previewing && !applying;
  const canApply =
    preview !== null && preview.verdict !== 'BLOCK' &&
    vehicleId && driverId && stops && stops.length > 0 &&
    !applying;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-main)]">Merge {sources.length} trips</h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Passengers reassigned to the new trip · sources marked MERGED · evaluated by Planning Constraints
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-main)]"><X className="w-5 h-5" /></button>
        </header>

        <div className="overflow-y-auto px-6 py-5 space-y-5">
          {/* Source summary */}
          <section>
            <SectionHeading>Sources</SectionHeading>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/40">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-[var(--text-faint)]">
                  <tr>
                    <th className="px-3 py-2">Trip</th>
                    <th className="px-3 py-2">Route</th>
                    <th className="px-3 py-2">Departure</th>
                    <th className="px-3 py-2 text-right">Passengers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
                  {sources.map((s) => (
                    <tr key={s.id}>
                      <td className="px-3 py-2 font-medium">{s.tripNumber ?? s.id.slice(0, 8)}</td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{s.route?.name ?? s.routeId.slice(0, 8)}</td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{fmtDateTime(s.departureTime)}</td>
                      <td className="px-3 py-2 text-right">{s.confirmedCount ?? 0}</td>
                    </tr>
                  ))}
                  <tr className="bg-[var(--bg-surface)]/60 font-semibold text-[var(--text-main)]">
                    <td className="px-3 py-2" colSpan={3}>Total → merged trip</td>
                    <td className="px-3 py-2 text-right">{defaults.totalPassengers}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {mixedRoutes && (
              <p className="mt-2 text-xs text-amber-400">
                Sources use different routes — merged trip will run on <code className="rounded bg-[var(--bg-surface)] px-1 py-0.5">{routeId.slice(0, 8)}</code>. Verify stops before applying.
              </p>
            )}
            {stopsError && (
              <p className="mt-2 text-xs text-rose-400">{stopsError}</p>
            )}
          </section>

          {/* Merged trip form */}
          <section>
            <SectionHeading>Merged trip</SectionHeading>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Vehicle">
                <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={inputCls}>
                  <option value="">Select vehicle</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.licensePlate ?? v.id.slice(0, 8)} — {v.make ?? ''} {v.model ?? ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Driver">
                <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className={inputCls}>
                  <option value="">Select driver</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}{d.licenseType ? ` (${d.licenseType})` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Departure">
                <input type="datetime-local" value={departureTime} onChange={(e) => setDeparture(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Arrival">
                <input type="datetime-local" value={arrivalTime} onChange={(e) => setArrival(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Latest arrival (SLA)" hint="optional — triggers MERGED_ARRIVAL_SLA rule">
                <input type="datetime-local" value={latestArrival} onChange={(e) => setLatestArrival(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Notes" hint="stored on the merged trip">
                <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder='e.g. "Depot-consolidation merge"' />
              </Field>
            </div>
          </section>

          {/* Preview panel */}
          {(preview || previewError) && (
            <section>
              <SectionHeading>Planning Constraints</SectionHeading>
              {previewError && <VerdictBanner verdict="BLOCK" message={previewError} />}
              {preview && (
                <>
                  <VerdictBanner
                    verdict={preview.verdict}
                    message={verdictMessage(preview)}
                  />
                  {preview.checks.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {preview.checks.map((c, i) => (
                        <li key={i} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 px-3 py-2 text-sm">
                          <div className="flex items-start gap-2">
                            <OutcomeBadge outcome={c.outcome} />
                            <div>
                              <div className="font-medium text-[var(--text-main)]">{c.code}</div>
                              <div className="mt-0.5 text-[var(--text-muted)]">{c.message}</div>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-6 py-4">
          <button
            onClick={onClose}
            disabled={applying}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 px-4 py-2 text-sm text-[var(--text-main)] hover:bg-[var(--bg-surface)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={runPreview}
            disabled={!canPreview}
            className="inline-flex items-center gap-1.5 rounded-xl border border-violet-600 bg-violet-600/20 px-4 py-2 text-sm font-medium text-violet-200 hover:bg-violet-600/30 disabled:opacity-50"
          >
            {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            {previewing ? 'Previewing…' : 'Preview'}
          </button>
          <button
            onClick={runApply}
            disabled={!canApply}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 disabled:from-slate-700 disabled:to-slate-700"
          >
            {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {applying ? 'Applying…' : 'Apply merge'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function deriveDefaults(sources: ScheduleForMerge[]) {
  const dep = sources.reduce(
    (min, s) => (new Date(s.departureTime).getTime() < min ? new Date(s.departureTime).getTime() : min),
    Number.POSITIVE_INFINITY
  );
  const arr = sources.reduce((max, s) => {
    const at = s.arrivalTime ? new Date(s.arrivalTime).getTime() : 0;
    return at > max ? at : max;
  }, 0);
  const routeIds = new Set(sources.map((s) => s.routeId));
  return {
    departureTime: toLocalInput(new Date(dep)),
    arrivalTime: arr > 0 ? toLocalInput(new Date(arr)) : toLocalInput(new Date(dep + 60 * 60_000)),
    routeId: sources[0]?.routeId ?? '',
    mixedRoutes: routeIds.size > 1,
    totalPassengers: sources.reduce((sum, s) => sum + (s.confirmedCount ?? 0), 0),
  };
}

/**
 * Format Date for a <input type="datetime-local"> value. The input needs
 * YYYY-MM-DDTHH:mm in *local* time (not UTC), and Date.toISOString gives
 * UTC — so we build the string from local getters.
 */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function verdictMessage(p: PreviewResult): string {
  const cap = p.preview.capacity == null ? 'unknown seats' : `${p.preview.capacity} seats`;
  const base = `${p.preview.passengerCount} passengers on ${cap}`;
  if (p.verdict === 'BLOCK') return `Refused — ${base}. Fix the issues below before applying.`;
  if (p.verdict === 'WARN') return `Allowed with warnings — ${base}. Review before applying.`;
  return `Passed all constraints — ${base}${p.totalPenalty ? ` (penalty ${p.totalPenalty})` : ''}.`;
}

// ─── Small building blocks ──────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 px-3 py-2 text-sm text-[var(--text-main)] placeholder:text-[var(--text-faint)] focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500';

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">{children}</h3>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
        {hint && <span className="text-xs text-[var(--text-faint)]">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function VerdictBanner({ verdict, message }: { verdict: 'PASS' | 'WARN' | 'BLOCK'; message: string }) {
  const cls =
    verdict === 'BLOCK' ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
    : verdict === 'WARN' ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
  const Icon = verdict === 'BLOCK' ? XCircle : verdict === 'WARN' ? AlertTriangle : CheckCircle2;
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${cls}`}>
      <Icon className="w-5 h-5 flex-none" />
      <div>
        <div className="font-semibold">{verdict}</div>
        <div className="mt-0.5 opacity-90">{message}</div>
      </div>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: PreviewCheck['outcome'] }) {
  const cls =
    outcome === 'BLOCK' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
    : outcome === 'WARN' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    : outcome === 'PENALTY' ? 'bg-violet-500/20 text-violet-300 border-violet-500/40'
    : 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/40';
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>
      {outcome}
    </span>
  );
}
