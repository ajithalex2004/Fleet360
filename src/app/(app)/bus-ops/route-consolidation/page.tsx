'use client';

import Link from 'next/link';

/**
 * Route Consolidation — decision-support dashboard.
 *
 * Consumes POST /api/bus-ops/route-consolidation/analyze (PR B).
 * Operator hits Analyse, sees ranked recommendations for merging
 * pairs of active routes, plus a skipped-pairs breakdown that
 * explains why any expected pair didn't surface (different shift,
 * different zone, insufficient stops, etc.).
 *
 * Deliberate Phase 1 constraints:
 *   - No "apply" button. Consolidating routes is irreversible (schema
 *     changes, enrolment migration) so Phase 1 shows recommendations
 *     for operator eyeballing. Apply is Phase 2.
 *   - No persistence. Each Analyse click hits the endpoint fresh —
 *     no history table, no scheduled runs. Recompute-on-demand is
 *     fine at typical N ≤ 50.
 *
 * Verdict / checks rendering reuses PceVerdictPanel (from #17) so
 * the visual language matches the rest of the PCE stack.
 */

import React, { useCallback, useState } from 'react';
import { GitMerge, Play, RefreshCw, Trophy, ChevronDown, ChevronRight, Info, CheckCircle2, History, Shield } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';
import PceVerdictPanel, { type PceVerdictBody } from '@/components/bus-ops/PceVerdictPanel';
import RouteConsolidationApplyModal, { type RecommendationForApply } from '@/components/bus-ops/RouteConsolidationApplyModal';
import RouteConsolidationHistoryPanel from '@/components/bus-ops/RouteConsolidationHistoryPanel';
import RouteConsolidationScoringPolicyPanel from '@/components/bus-ops/RouteConsolidationScoringPolicyPanel';

// ─── Types matched to /analyze response ─────────────────────────────

type ZoneCompatKind =
  | 'ZONE_MATCH' | 'ZONE_DIFFERENT' | 'FALLBACK_DISTANCE' | 'FALLBACK_TOO_FAR' | 'UNKNOWN';

type ZoneCompatResult = { kind: ZoneCompatKind; sharedPlaceId?: string; distanceKm?: number };

interface Recommendation {
  routeA: { id: string; name: string };
  routeB: { id: string; name: string };
  zoneCompat: { pickup: ZoneCompatResult; dropoff: ZoneCompatResult };
  timeCompat: { shift: string | null; direction: string | null };
  demand: { routeAEnrolled: number; routeBEnrolled: number; combined: number };
  verdict: 'PASS' | 'WARN' | 'BLOCK';
  checks: PceVerdictBody['checks'];
  scores: { fleetSavingsPerWeek: number; pcePenalty: number; totalScore: number };
  feasible: boolean;
}

type SkipReason =
  | 'DIFFERENT_ROUTE_TYPE'
  | 'DIFFERENT_SHIFT'
  | 'DIFFERENT_DIRECTION'
  | 'PICKUP_ZONE_INCOMPATIBLE'
  | 'DROPOFF_ZONE_INCOMPATIBLE'
  | 'ZONE_DATA_UNAVAILABLE'
  | 'INSUFFICIENT_ROUTE_DATA';

interface SkippedPair {
  routeIdA: string;
  routeIdB: string;
  reason: SkipReason;
  detail?: string;
}

interface Objective {
  penaltyLambda?: number;
  costPerVehicleDay?: number;
  operatingDaysPerWeek?: number;
  fallbackKm?: { pickup?: number; dropoff?: number };
  maxDepartureTimeDiffMinutes?: number;
  vehicleTurnaroundMinutes?: number;
}

interface AnalyzeResponse {
  objective: Objective;
  recommendations: Recommendation[];
  skipped: SkippedPair[];
  totals: {
    routesAnalysed: number;
    pairsConsidered: number;
    pairsSurvivingFilters: number;
    pairsRecommended: number;
    pairsInfeasible: number;
  };
}

// ─── Page ────────────────────────────────────────────────────────────

type Tab = 'recommendations' | 'history';

export default function RouteConsolidationPage() {
  const [tab, setTab] = useState<Tab>('recommendations');
  const [objective, setObjective] = useState<Objective>({});
  const [analysing, setAnalysing] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const [applyingRec, setApplyingRec] = useState<{ rec: Recommendation; recommendationId: string } | null>(null);
  const [appliedFlash, setAppliedFlash] = useState<string | null>(null);

  const analyse = useCallback(async () => {
    setAnalysing(true); setError(null); setResult(null); setExpandedRow(null);
    try {
      const res = await fetch('/api/bus-ops/route-consolidation/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective: stripEmpty(objective as Record<string, unknown>) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setResult(data as AnalyzeResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
    } finally {
      setAnalysing(false);
    }
  }, [objective]);

  const winner = result?.recommendations.find((r) => r.feasible) ?? null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Route Consolidation"
        subtitle="Analyse candidate merges, apply recommendations transactionally, and revert within the audit window. All apply/revert actions go through the Planning Constraint gate."
        icon={GitMerge}
        accent="violet"
        actions={
          <Link
            href="/bus-ops/planning-constraints"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            <Shield className="w-4 h-4" />
            Edit PCE rules
          </Link>
        }
      />

      {/* Tabs — Recommendations (analyse + apply) | History (revert past applies) */}
      <div className="flex items-center gap-1 border-b border-slate-800">
        {(['recommendations', 'history'] as const).map((t) => {
          const Icon = t === 'recommendations' ? GitMerge : History;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
                tab === t
                  ? 'border-violet-500 text-white font-medium'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t === 'recommendations' ? 'Recommendations' : 'History'}
            </button>
          );
        })}
      </div>

      {appliedFlash && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Consolidation applied — <span className="font-mono text-xs">{appliedFlash.slice(0, 8)}</span>… — see the History tab to revert if needed.
        </div>
      )}

      {tab === 'history' && (
        <RouteConsolidationHistoryPanel />
      )}

      {tab === 'recommendations' && (
        <>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — controls + summary */}
        <aside className="space-y-3">
          <SectionHeading>Analysis</SectionHeading>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-4">
            <details className="group rounded-lg border border-slate-800 bg-slate-900/60">
              <summary className="cursor-pointer list-none px-3 py-2 text-xs uppercase tracking-wider text-slate-400 hover:text-slate-200 flex items-center justify-between">
                <span>Objective &amp; thresholds</span>
                <span className="text-[10px] font-normal opacity-60">optional</span>
              </summary>
              <div className="border-t border-slate-800 p-3 space-y-3">
                <Field label="Penalty λ" hint="weight on PCE penalty (default 1)">
                  <input type="number" step="0.1" value={objective.penaltyLambda ?? ''}
                    onChange={(e) => setObjective({ ...objective, penaltyLambda: emptyToUndef(e.target.value) })}
                    placeholder="1" className={inputCls} />
                </Field>
                <Field label="Cost per vehicle-day" hint="fleet-savings estimator (default 100)">
                  <input type="number" step="0.01" value={objective.costPerVehicleDay ?? ''}
                    onChange={(e) => setObjective({ ...objective, costPerVehicleDay: emptyToUndef(e.target.value) })}
                    placeholder="100" className={inputCls} />
                </Field>
                <Field label="Operating days / week" hint="default 5 (weekday-only)">
                  <input type="number" step="1" value={objective.operatingDaysPerWeek ?? ''}
                    onChange={(e) => setObjective({ ...objective, operatingDaysPerWeek: emptyToUndef(e.target.value) })}
                    placeholder="5" className={inputCls} />
                </Field>
                <div className="border-t border-slate-700 my-3 pt-3">
                  <p className="text-xs uppercase tracking-wider text-slate-400 mb-3">Time Buffers</p>
                  <Field label="Max departure time diff (min)" hint="default 60 — routes beyond this are skipped">
                    <input type="number" step="1" value={objective.maxDepartureTimeDiffMinutes ?? ''}
                      onChange={(e) => setObjective({ ...objective, maxDepartureTimeDiffMinutes: emptyToUndef(e.target.value) })}
                      placeholder="60" className={inputCls} />
                  </Field>
                  <Field label="Vehicle turnaround (min)" hint="default 30 — min time between arrival and next trip">
                    <input type="number" step="1" value={objective.vehicleTurnaroundMinutes ?? ''}
                      onChange={(e) => setObjective({ ...objective, vehicleTurnaroundMinutes: emptyToUndef(e.target.value) })}
                      placeholder="30" className={inputCls} />
                  </Field>
                </div>
                <div className="border-t border-slate-700 my-3 pt-3">
                  <p className="text-xs uppercase tracking-wider text-slate-400 mb-3">Zone Fallback Thresholds</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Pickup fallback km" hint="default 3.0">
                      <input type="number" step="0.1" value={objective.fallbackKm?.pickup ?? ''}
                        onChange={(e) => setObjective({ ...objective, fallbackKm: { ...objective.fallbackKm, pickup: emptyToUndef(e.target.value) } })}
                        placeholder="3.0" className={inputCls} />
                    </Field>
                    <Field label="Dropoff fallback km" hint="default 1.5">
                      <input type="number" step="0.1" value={objective.fallbackKm?.dropoff ?? ''}
                        onChange={(e) => setObjective({ ...objective, fallbackKm: { ...objective.fallbackKm, dropoff: emptyToUndef(e.target.value) } })}
                        placeholder="1.5" className={inputCls} />
                    </Field>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">
                  Zones from <code>spatial.places</code> take precedence over distance thresholds when available.
                </p>
              </div>
            </details>

            <RouteConsolidationScoringPolicyPanel />

            <button onClick={analyse} disabled={analysing}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {analysing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {analysing ? 'Analysing…' : 'Analyse routes'}
            </button>
          </div>

          {result && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="flex items-center gap-2 mb-3 text-xs text-slate-400">
                <Info className="w-3.5 h-3.5" /> <span className="uppercase tracking-wider">Funnel</span>
              </div>
              <FunnelRow label="Routes analysed" value={result.totals.routesAnalysed} />
              <FunnelRow label="Pairs considered" value={result.totals.pairsConsidered} />
              <FunnelRow label="Survived filters" value={result.totals.pairsSurvivingFilters} muted={result.totals.pairsSurvivingFilters === 0} />
              <FunnelRow label="Recommended" value={result.totals.pairsRecommended} accent="emerald" />
              {result.totals.pairsInfeasible > 0 && (
                <FunnelRow label="Infeasible (BLOCK)" value={result.totals.pairsInfeasible} accent="rose" />
              )}
            </div>
          )}
        </aside>

        {/* Right — results */}
        <section className="lg:col-span-2 space-y-3">
          <SectionHeading>
            <span className="mr-2">Recommendations</span>
            {winner && (
              <span className="text-xs font-normal text-slate-400">
                — top: <span className="font-semibold text-emerald-400">{winner.routeA.name}</span>
                {' + '}
                <span className="font-semibold text-emerald-400">{winner.routeB.name}</span>
                {' '}({fmtMoney(-winner.scores.totalScore)}/week net saving)
              </span>
            )}
          </SectionHeading>

          {!result ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center text-slate-400">
              <GitMerge className="mx-auto h-10 w-10 text-slate-600 mb-3" />
              <p>Click <b>Analyse routes</b> to generate consolidation recommendations.</p>
              <p className="mt-1 text-xs text-slate-500">Pairs are filtered by shift/direction/zones before running through Planning Constraints.</p>
            </div>
          ) : result.recommendations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center text-slate-400">
              <p>No consolidation candidates survived the filters.</p>
              <p className="mt-1 text-xs text-slate-500">
                {result.skipped.length > 0 ? `${result.skipped.length} pair${result.skipped.length === 1 ? '' : 's'} skipped — expand the breakdown below to see why.` : 'No pairs were even considered — check that you have ≥ 2 active routes in this tenant.'}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/80 text-left text-xs uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="w-8 px-3 py-2"></th>
                    <th className="w-8 px-3 py-2 text-center">#</th>
                    <th className="px-3 py-2">Pair</th>
                    <th className="px-3 py-2">Zones</th>
                    <th className="px-3 py-2">Timing</th>
                    <th className="px-3 py-2 text-right">Demand</th>
                    <th className="px-3 py-2 text-right">Savings/wk</th>
                    <th className="px-3 py-2 text-right">Penalty</th>
                    <th className="px-3 py-2 text-right">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {result.recommendations.map((rec, i) => {
                    const key = `${rec.routeA.id}-${rec.routeB.id}`;
                    const isExpanded = expandedRow === key;
                    const isWinner = rec === winner;
                    return (
                      <React.Fragment key={key}>
                        <tr
                          className={`text-slate-200 cursor-pointer hover:bg-slate-800/40 ${isWinner ? 'bg-emerald-500/5' : !rec.feasible ? 'bg-slate-800/40 text-slate-400' : ''}`}
                          onClick={() => setExpandedRow(isExpanded ? null : key)}
                        >
                          <td className="px-3 py-3 text-slate-500">
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </td>
                          <td className="px-3 py-3 text-center">
                            {isWinner ? <Trophy className="mx-auto h-4 w-4 text-emerald-400" /> : <span className="text-xs text-slate-500">{i + 1}</span>}
                          </td>
                          <td className="px-3 py-3">
                            <div className="font-medium">{rec.routeA.name} + {rec.routeB.name}</div>
                            <VerdictBadge verdict={rec.verdict} />
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-col gap-0.5">
                              <ZoneBadge side="Pickup" compat={rec.zoneCompat.pickup} />
                              <ZoneBadge side="Dropoff" compat={rec.zoneCompat.dropoff} />
                            </div>
                          </td>
                          <td className="px-3 py-3 text-xs text-slate-400">
                            <div>{rec.timeCompat.shift ?? '—'}</div>
                            <div>{rec.timeCompat.direction ?? '—'}</div>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <div>{rec.demand.combined}</div>
                            <div className="text-[10px] text-slate-500">{rec.demand.routeAEnrolled} + {rec.demand.routeBEnrolled}</div>
                          </td>
                          <td className="px-3 py-3 text-right text-emerald-300">{fmtMoney(rec.scores.fleetSavingsPerWeek)}</td>
                          <td className="px-3 py-3 text-right">
                            {rec.scores.pcePenalty > 0
                              ? <span className="text-violet-300">{rec.scores.pcePenalty}</span>
                              : <span className="text-slate-500">—</span>}
                          </td>
                          <td className={`px-3 py-3 text-right font-semibold ${rec.scores.totalScore < 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                            {fmtMoney(-rec.scores.totalScore)}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={9} className="bg-slate-900/60 px-6 py-4 space-y-3">
                              <PceVerdictPanel body={{
                                verdict: rec.verdict,
                                checks: rec.checks,
                                totalPenalty: rec.scores.pcePenalty,
                              }} />
                              <RecMetadata rec={rec} />
                              {rec.feasible && (
                                <div className="pt-3 border-t border-slate-800 flex items-center justify-end">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setApplyingRec({ rec, recommendationId: key });
                                    }}
                                    className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                                  >
                                    <CheckCircle2 className="w-4 h-4" /> Apply this consolidation
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Skipped pairs breakdown */}
          {result && result.skipped.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40">
              <button
                onClick={() => setShowSkipped((s) => !s)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-slate-300 hover:bg-slate-800/40"
              >
                <span>Skipped pairs ({result.skipped.length})</span>
                {showSkipped ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              {showSkipped && (
                <div className="border-t border-slate-800 divide-y divide-slate-800">
                  {groupSkipped(result.skipped).map(([reason, pairs]) => (
                    <div key={reason} className="px-4 py-3">
                      <div className="flex items-baseline justify-between">
                        <div className="font-mono text-xs text-slate-300">{reason}</div>
                        <div className="text-xs text-slate-500">{pairs.length} pair{pairs.length === 1 ? '' : 's'}</div>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{describeSkipReason(reason as SkipReason)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
        </>
      )}

      {applyingRec && (
        <RouteConsolidationApplyModal
          recommendation={applyingRec.rec as RecommendationForApply}
          recommendationId={applyingRec.recommendationId}
          onClose={() => setApplyingRec(null)}
          onApplied={(consolidationId) => {
            setApplyingRec(null);
            setAppliedFlash(consolidationId);
            // Reset analysis result so the applied pair no longer shows
            // — the sources are now retired and would fail the next analyse.
            setResult(null);
            setTab('history');
          }}
        />
      )}
    </div>
  );
}

// ─── Building blocks ────────────────────────────────────────────────

function ZoneBadge({ side, compat }: { side: string; compat: ZoneCompatResult }) {
  const cls =
    compat.kind === 'ZONE_MATCH' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
    : compat.kind === 'FALLBACK_DISTANCE' ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
    : compat.kind === 'ZONE_DIFFERENT' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
    : compat.kind === 'FALLBACK_TOO_FAR' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
    : 'bg-slate-500/20 text-slate-300 border-slate-500/40';
  const label =
    compat.kind === 'ZONE_MATCH' ? 'ZONE'
    : compat.kind === 'FALLBACK_DISTANCE' ? `${compat.distanceKm?.toFixed(1) ?? '?'}km`
    : compat.kind === 'ZONE_DIFFERENT' ? 'DIFF'
    : compat.kind === 'FALLBACK_TOO_FAR' ? `${compat.distanceKm?.toFixed(1) ?? '?'}km`
    : '—';
  return (
    <span className="inline-flex items-center gap-1 text-[10px]">
      <span className="text-slate-500 w-12">{side}</span>
      <span className={`inline-flex items-center rounded border px-1 py-0.5 font-semibold ${cls}`}>{label}</span>
    </span>
  );
}

function VerdictBadge({ verdict }: { verdict: 'PASS' | 'WARN' | 'BLOCK' }) {
  const cls =
    verdict === 'BLOCK' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
    : verdict === 'WARN' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
  return <span className={`mt-0.5 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{verdict}</span>;
}

function FunnelRow({ label, value, muted, accent }: { label: string; value: number; muted?: boolean; accent?: 'emerald' | 'rose' }) {
  const colour = accent === 'emerald' ? 'text-emerald-300' : accent === 'rose' ? 'text-rose-300' : muted ? 'text-slate-500' : 'text-slate-200';
  return (
    <div className="flex justify-between py-1 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className={`font-semibold ${colour}`}>{value}</span>
    </div>
  );
}

function RecMetadata({ rec }: { rec: Recommendation }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-400">
      <div><span className="text-slate-500">Pickup zone:</span> {formatZone(rec.zoneCompat.pickup)}</div>
      <div><span className="text-slate-500">Dropoff zone:</span> {formatZone(rec.zoneCompat.dropoff)}</div>
      <div><span className="text-slate-500">Combined demand:</span> {rec.demand.combined} passengers</div>
      <div><span className="text-slate-500">Fleet savings/week:</span> {fmtMoney(rec.scores.fleetSavingsPerWeek)}</div>
    </div>
  );
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

// ─── Helpers ─────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function emptyToUndef(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function stripEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === '') continue;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const nested = stripEmpty(v as Record<string, unknown>);
      if (Object.keys(nested).length > 0) (out as Record<string, unknown>)[k] = nested;
      continue;
    }
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function formatZone(z: ZoneCompatResult): string {
  if (z.kind === 'ZONE_MATCH') return `matched (${z.sharedPlaceId?.slice(0, 8) ?? '?'})`;
  if (z.kind === 'FALLBACK_DISTANCE') return `distance ${z.distanceKm?.toFixed(2) ?? '?'}km (fallback)`;
  if (z.kind === 'ZONE_DIFFERENT') return 'different zones';
  if (z.kind === 'FALLBACK_TOO_FAR') return `${z.distanceKm?.toFixed(2) ?? '?'}km apart`;
  return 'unknown';
}

function groupSkipped(skipped: SkippedPair[]): Array<[string, SkippedPair[]]> {
  const map = new Map<string, SkippedPair[]>();
  for (const s of skipped) {
    const list = map.get(s.reason) ?? [];
    list.push(s);
    map.set(s.reason, list);
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
}

function describeSkipReason(reason: SkipReason): string {
  switch (reason) {
    case 'DIFFERENT_ROUTE_TYPE':      return 'Routes have incompatible routeType (STAFF vs SCHOOL). BOTH is compatible with either.';
    case 'DIFFERENT_SHIFT':           return 'Representative TripSchedule shifts differ (e.g. MORNING vs EVENING).';
    case 'DIFFERENT_DIRECTION':      return 'Representative TripSchedule directions differ (INBOUND vs OUTBOUND).';
    case 'PICKUP_ZONE_INCOMPATIBLE':  return 'Pickup ends are in different spatial zones, or too far apart under the distance fallback.';
    case 'DROPOFF_ZONE_INCOMPATIBLE': return 'Dropoff ends are in different spatial zones, or too far apart under the distance fallback.';
    case 'ZONE_DATA_UNAVAILABLE':     return 'Neither placeId nor GPS coords are usable on at least one route end. Backfill spatial.places or stop coordinates.';
    case 'INSUFFICIENT_ROUTE_DATA':   return 'Route has fewer than 2 stops — can\'t determine pickup vs dropoff ends.';
  }
}
