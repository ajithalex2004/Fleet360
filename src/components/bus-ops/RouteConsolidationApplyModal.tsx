'use client';

/**
 * RouteConsolidationApplyModal — apply-flow UI over the PR #24 engine.
 *
 * Sequence:
 *   1. On open, fetch each source route's stops + updatedAt so the
 *      modal has enough state to (a) suggest a merged stop order,
 *      (b) send `sourceRouteFingerprints` to the preview/apply for
 *      staleness detection.
 *   2. Render the merged-route form (name, capacity, stop order editor).
 *      Stop order defaults to the greedy-NN suggestion; operator can
 *      drag or click to reorder. Any reorder invalidates the last
 *      preview.
 *   3. "Preview" button → POST /apply/preview → shows guards +
 *      enrollment migrations + PCE via PceVerdictPanel. Unresolved
 *      enrollments render a per-row stop picker for operator
 *      resolution.
 *   4. "Apply" button — enabled only when `preview.overallVerdict ===
 *      'READY'`. Generates a fresh idempotencyKey per click so a
 *      network retry hits the DB idempotency barrier cleanly.
 *
 * Guard-rail parity with backend:
 *   - Apply button disabled unless preview.overallVerdict === 'READY'
 *   - operatorResolutions keys formatted "RP:<uuid>"/"TE:<id>"
 *   - Neither appliedBy nor tenantId sent in body (backend rejects
 *     those in the body per the PR #24 security fix; UI never
 *     surfaces those fields as user-editable)
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, PlayCircle, CheckCircle2, Loader2, ArrowUp, ArrowDown } from 'lucide-react';
import PceVerdictPanel from '@/components/bus-ops/PceVerdictPanel';

// ─── Shapes matched to backend contracts ────────────────────────────

type EnrollmentKey = `RP:${string}` | `TE:${string}`;

type StopRow = {
  id: string;
  placeId: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  sequence: number;
  stopName: string | null;
  routeId: string;
};

type SourceRouteMeta = {
  id: string;
  name: string;
  updatedAt: string;
  stops: StopRow[];
};

interface PreviewCheck {
  code: string;
  outcome: 'PASS' | 'WARN' | 'BLOCK' | 'PENALTY';
  message: string;
}

interface GuardCheck {
  code: string;
  status: 'PASS' | 'WARN' | 'BLOCK';
  message: string;
  details?: Record<string, unknown>;
}

interface EnrollmentMigrationPlan {
  key: EnrollmentKey;
  enrollmentType: 'ROUTE_PASSENGER' | 'TRANSPORT_ENROLLMENT';
  enrollmentId: string;
  sourceRouteId: string;
  oldPickupStopId: string | null;
  newPickupStopId: string | null;
  pickupMapping: { method: 'EXACT_STOP' | 'EXACT_PLACE_ID' | 'OPERATOR_RESOLVED'; newStopId: string | null };
  oldDropoffStopId: string | null;
  newDropoffStopId: string | null;
  dropoffMapping: { method: 'EXACT_STOP' | 'EXACT_PLACE_ID' | 'OPERATOR_RESOLVED'; newStopId: string | null };
  requiresOperatorResolution: boolean;
}

interface PreviewApplyResult {
  overallVerdict: 'READY' | 'BLOCKED';
  guards: GuardCheck[];
  enrollmentMigrations: EnrollmentMigrationPlan[];
  pce: { verdict: 'PASS' | 'WARN' | 'BLOCK'; checks: PreviewCheck[]; totalPenalty: number };
}

export type RecommendationForApply = {
  routeA: { id: string; name: string };
  routeB: { id: string; name: string };
};

// ─── Component ──────────────────────────────────────────────────────

export default function RouteConsolidationApplyModal({
  recommendation,
  recommendationId,
  onClose,
  onApplied,
}: {
  recommendation: RecommendationForApply;
  recommendationId: string;
  onClose: () => void;
  onApplied: (consolidationId: string) => void;
}) {
  const sourceIds = useMemo(() => [recommendation.routeA.id, recommendation.routeB.id], [recommendation.routeA.id, recommendation.routeB.id]);

  const [sources, setSources] = useState<SourceRouteMeta[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState<string>('');
  const [stopOrder, setStopOrder] = useState<string[]>([]);
  const [operatorResolutions, setOperatorResolutions] = useState<Record<EnrollmentKey, { pickupStopId?: string | null; dropoffStopId?: string | null }>>({});

  const [preview, setPreview] = useState<PreviewApplyResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);

  // Fetch source routes on open (name, updatedAt, stops)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const routeInfos = await Promise.all(sourceIds.map((id) => fetch(`/api/bus-ops/routes/${id}`, { cache: 'no-store' }).then((r) => r.ok ? r.json() : Promise.reject(new Error(`route ${id} HTTP ${r.status}`)))));
        const stopFetches = await Promise.all(sourceIds.map((id) => fetch(`/api/bus-ops/routes/${id}/stops`).then((r) => r.ok ? r.json() : [])));
        if (cancelled) return;

        const rows: SourceRouteMeta[] = sourceIds.map((id, i) => ({
          id,
          name: routeInfos[i]?.name ?? id,
          updatedAt: routeInfos[i]?.updatedAt ?? '',
          stops: (Array.isArray(stopFetches[i]) ? stopFetches[i] : stopFetches[i]?.stops ?? []).map((s: StopRow) => ({ ...s, routeId: id })),
        }));
        setSources(rows);
        // Default merged name
        setName(`Consolidated: ${rows.map((r) => r.name).join(' + ')}`);
        // Default merged stop order: greedy NN over union
        setStopOrder(suggestOrder(rows));
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load source routes');
      }
    })();
    return () => { cancelled = true; };
  }, [sourceIds]);

  const allStops: StopRow[] = useMemo(
    () => (sources ?? []).flatMap((s) => s.stops),
    [sources],
  );

  const invalidatePreview = useCallback(() => {
    setPreview(null);
    setPreviewError(null);
  }, []);

  const runPreview = async () => {
    if (!sources) return;
    setPreviewing(true); setPreviewError(null);
    try {
      const body = {
        recommendationId,
        sourceRouteIds: sourceIds,
        mergedRoute: {
          name,
          stopIds: stopOrder,
          capacity: capacity ? Number(capacity) : undefined,
        },
        sourceRouteFingerprints: Object.fromEntries(sources.map((r) => [r.id, r.updatedAt])),
        operatorResolutions,
      };
      const res = await fetch('/api/bus-ops/route-consolidation/apply/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setPreview(data as PreviewApplyResult);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const runApply = async () => {
    if (!sources || !preview || preview.overallVerdict !== 'READY') return;
    setApplying(true);
    try {
      const body = {
        recommendationId,
        idempotencyKey: crypto.randomUUID(),
        sourceRouteIds: sourceIds,
        mergedRoute: {
          name,
          stopIds: stopOrder,
          capacity: capacity ? Number(capacity) : undefined,
        },
        sourceRouteFingerprints: Object.fromEntries(sources.map((r) => [r.id, r.updatedAt])),
        operatorResolutions,
      };
      const res = await fetch('/api/bus-ops/route-consolidation/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 409) {
        // Blocked by transaction-time guards — refresh preview state
        setPreview({
          overallVerdict: 'BLOCKED',
          guards: data.guards ?? [],
          enrollmentMigrations: data.enrollmentMigrations ?? [],
          pce: data.pce ?? { verdict: 'BLOCK', checks: [], totalPenalty: 0 },
        });
        setApplying(false);
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      if (data.status === 'APPLIED' || data.status === 'ALREADY_APPLIED') {
        onApplied(data.consolidationId);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Apply failed');
    } finally {
      setApplying(false);
    }
  };

  const moveStop = (index: number, dir: -1 | 1) => {
    const next = [...stopOrder];
    const swap = index + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[index], next[swap]] = [next[swap], next[index]];
    setStopOrder(next);
    invalidatePreview();
  };

  const removeStop = (index: number) => {
    setStopOrder((prev) => prev.filter((_, i) => i !== index));
    invalidatePreview();
  };

  const addStop = (stopId: string) => {
    if (!stopOrder.includes(stopId)) setStopOrder((prev) => [...prev, stopId]);
    invalidatePreview();
  };

  const unresolvedEnrollments = (preview?.enrollmentMigrations ?? []).filter((p) => p.requiresOperatorResolution);
  const canPreview = !!sources && stopOrder.length >= 2 && !previewing && !applying;
  const canApply = preview?.overallVerdict === 'READY' && !applying;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Apply consolidation</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Merge <span className="font-medium text-slate-300">{recommendation.routeA.name}</span> + <span className="font-medium text-slate-300">{recommendation.routeB.name}</span> · sources will retire, enrolments migrate, audit lineage written
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="w-5 h-5" /></button>
        </header>

        <div className="overflow-y-auto px-6 py-5 space-y-5">
          {loadError && <Banner tone="rose" text={loadError} />}

          {!sources ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center text-slate-400 animate-pulse">Loading source routes…</div>
          ) : (
            <>
              {/* Merged route form */}
              <section className="space-y-3">
                <SectionHeading>Merged route</SectionHeading>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Name">
                    <input value={name} onChange={(e) => { setName(e.target.value); invalidatePreview(); }} className={inputCls} />
                  </Field>
                  <Field label="Capacity" hint="optional; defaults from source">
                    <input type="number" value={capacity} onChange={(e) => { setCapacity(e.target.value); invalidatePreview(); }} className={inputCls} placeholder="e.g. 50" />
                  </Field>
                </div>
              </section>

              {/* Stop order editor */}
              <section className="space-y-3">
                <SectionHeading>
                  <span className="mr-2">Merged stop order</span>
                  <span className="text-xs font-normal text-slate-500">— suggested via nearest-neighbor from source stops; reorder as needed</span>
                </SectionHeading>
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
                  {stopOrder.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-slate-500">No stops selected.</div>
                  ) : (
                    <ul className="divide-y divide-slate-800">
                      {stopOrder.map((sid, i) => {
                        const stop = allStops.find((s) => s.id === sid);
                        return (
                          <li key={sid} className="flex items-center gap-2 px-3 py-2 text-sm">
                            <span className="w-6 text-center text-xs text-slate-500">{i + 1}</span>
                            <span className="flex-1 text-slate-200">{stop?.stopName ?? sid.slice(0, 8)}</span>
                            <span className="text-[10px] text-slate-500">from {sources.find((r) => r.id === stop?.routeId)?.name}</span>
                            <div className="inline-flex items-center gap-1">
                              <button onClick={() => moveStop(i, -1)} disabled={i === 0} className="rounded p-1 text-slate-400 hover:bg-slate-800 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                              <button onClick={() => moveStop(i, 1)} disabled={i === stopOrder.length - 1} className="rounded p-1 text-slate-400 hover:bg-slate-800 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                              <button onClick={() => removeStop(i)} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-rose-300 text-xs">✕</button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                {allStops.filter((s) => !stopOrder.includes(s.id)).length > 0 && (
                  <div className="rounded-lg border border-slate-800 bg-slate-900/20 p-3">
                    <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Add source stop</div>
                    <div className="flex flex-wrap gap-1.5">
                      {allStops.filter((s) => !stopOrder.includes(s.id)).map((s) => (
                        <button key={s.id} onClick={() => addStop(s.id)} className="text-xs px-2 py-1 rounded border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700">
                          + {s.stopName ?? s.id.slice(0, 8)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* Preview panel */}
              {(previewError || preview) && (
                <section className="space-y-3">
                  <SectionHeading>Preview result</SectionHeading>
                  {previewError && <Banner tone="rose" text={previewError} />}
                  {preview && (
                    <>
                      <Banner tone={preview.overallVerdict === 'READY' ? 'emerald' : 'rose'}
                        text={preview.overallVerdict === 'READY'
                          ? 'All guards passed. Ready to apply.'
                          : `Blocked by ${preview.guards.filter((g) => g.status === 'BLOCK').length} guard(s).`
                        }
                      />
                      <ul className="space-y-1.5">
                        {preview.guards.map((g) => (
                          <li key={g.code} className="flex items-start gap-2 text-xs">
                            <GuardBadge status={g.status} />
                            <div>
                              <span className="font-mono text-slate-300">{g.code}</span>
                              <span className="ml-2 text-slate-500">{g.message}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                      {preview.pce.checks.length > 0 && (
                        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                          <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Planning Constraints</div>
                          <PceVerdictPanel body={{ verdict: preview.pce.verdict, checks: preview.pce.checks, totalPenalty: preview.pce.totalPenalty }} />
                        </div>
                      )}
                    </>
                  )}
                </section>
              )}

              {/* Enrollment resolutions */}
              {unresolvedEnrollments.length > 0 && (
                <section className="space-y-3">
                  <SectionHeading>Unresolved enrolments ({unresolvedEnrollments.length})</SectionHeading>
                  <p className="text-xs text-slate-400">Pick a merged-route stop for each unresolved side. Apply is blocked until all are resolved.</p>
                  <ul className="space-y-2">
                    {unresolvedEnrollments.map((p) => {
                      const stopOptions = stopOrder.map((sid) => allStops.find((s) => s.id === sid)).filter((s): s is StopRow => Boolean(s));
                      return (
                        <li key={p.key} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                          <div className="font-mono text-[10px] text-slate-500 mb-2">{p.key}</div>
                          <div className="grid grid-cols-2 gap-3">
                            {p.oldPickupStopId && p.pickupMapping.newStopId == null && (
                              <Field label={`Pickup was ${p.oldPickupStopId.slice(0, 8)}…`}>
                                <select
                                  value={operatorResolutions[p.key]?.pickupStopId ?? ''}
                                  onChange={(e) => {
                                    setOperatorResolutions((prev) => ({ ...prev, [p.key]: { ...prev[p.key], pickupStopId: e.target.value || null } }));
                                    invalidatePreview();
                                  }}
                                  className={inputCls}
                                >
                                  <option value="">— select stop —</option>
                                  {stopOptions.map((s) => <option key={s.id} value={s.id}>{s.stopName ?? s.id.slice(0, 8)}</option>)}
                                </select>
                              </Field>
                            )}
                            {p.oldDropoffStopId && p.dropoffMapping.newStopId == null && (
                              <Field label={`Dropoff was ${p.oldDropoffStopId.slice(0, 8)}…`}>
                                <select
                                  value={operatorResolutions[p.key]?.dropoffStopId ?? ''}
                                  onChange={(e) => {
                                    setOperatorResolutions((prev) => ({ ...prev, [p.key]: { ...prev[p.key], dropoffStopId: e.target.value || null } }));
                                    invalidatePreview();
                                  }}
                                  className={inputCls}
                                >
                                  <option value="">— select stop —</option>
                                  {stopOptions.map((s) => <option key={s.id} value={s.id}>{s.stopName ?? s.id.slice(0, 8)}</option>)}
                                </select>
                              </Field>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-800 px-6 py-4">
          <button onClick={onClose} disabled={applying} className="rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50">Cancel</button>
          <button onClick={runPreview} disabled={!canPreview} className="inline-flex items-center gap-1.5 rounded-xl border border-violet-600 bg-violet-600/20 px-4 py-2 text-sm font-medium text-violet-200 hover:bg-violet-600/30 disabled:opacity-50">
            {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />} {previewing ? 'Previewing…' : 'Preview'}
          </button>
          <button onClick={runApply} disabled={!canApply} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 disabled:from-slate-700 disabled:to-slate-700">
            {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} {applying ? 'Applying…' : 'Apply'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─── Helpers + building blocks ──────────────────────────────────────

function suggestOrder(sources: SourceRouteMeta[]): string[] {
  // Dedupe by placeId (or lat/lng), keep first-occurrence order.
  // Not a real TSP — just the classic "route A stops first, then B's extras."
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of sources) {
    for (const s of r.stops) {
      const key = s.placeId ?? `${s.gpsLat},${s.gpsLng}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s.id);
    }
  }
  return out;
}

const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500';

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">{children}</h3>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</span>
        {hint && <span className="text-[10px] text-slate-500">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function Banner({ tone, text }: { tone: 'emerald' | 'rose' | 'amber'; text: string }) {
  const cls =
    tone === 'emerald' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
    : tone === 'rose'  ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
    : 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  return <div className={`rounded-xl border px-4 py-2.5 text-sm ${cls}`}>{text}</div>;
}

function GuardBadge({ status }: { status: 'PASS' | 'WARN' | 'BLOCK' }) {
  const cls =
    status === 'BLOCK' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
    : status === 'WARN' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
  return <span className={`inline-flex items-center rounded border px-1 py-0 text-[10px] font-semibold ${cls}`}>{status}</span>;
}
