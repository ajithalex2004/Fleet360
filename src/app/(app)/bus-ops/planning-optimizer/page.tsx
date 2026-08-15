'use client';

/**
 * Planning Optimizer — decision-support ranking dashboard.
 *
 * Operator picks 2+ saved StaffTransportPlan rows, tunes the objective
 * (or accepts defaults), and gets a ranked shortlist back. Nothing is
 * mutated — this page is a lens over the optimizer, not a scheduler.
 * To act on a ranking, the operator opens the winning plan on the
 * bulk-plan page and applies it there (which re-runs PCE via the
 * same evaluator, so the ranking's promises hold).
 *
 * Deliberate: no cross-navigation into apply, no "apply from here"
 * button. Keeping actions off this page prevents the "optimizer's #1
 * pick got applied without another review" failure mode.
 */

import React, { useEffect, useState } from 'react';
import { Sparkles, Play, RefreshCw, Trophy, CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';

// ─── Types matching the /planning/optimize response ─────────────────

interface SavedPlanSummary {
  id: string;
  name: string;
  dateFrom: string;
  dateTo: string;
  status: string | null;
  summary: {
    totalPayCost?: number;
    totalPayHours?: number;
    totalDeadheadHours?: number;
    blockCount?: number;
    driverCount?: number;
    tripCount?: number;
  } | null;
}

interface Objective {
  penaltyLambda?: number;
  costPerPayHour?: number;
  costPerDeadheadHour?: number;
  costPerVehicleDay?: number;
  costPerDriverDay?: number;
}

interface PlanScore {
  planId: string;
  planName: string;
  operatingCost: number;
  pcePenalty: number;
  totalCost: number;
  feasible: boolean;
  verdict: 'PASS' | 'WARN' | 'BLOCK';
  blockedTripIds: string[];
  warningTripIds: string[];
  tripCount: number;
}

interface OptimizeResponse {
  objective: Objective;
  ranked: PlanScore[];
}

// ─── Page ────────────────────────────────────────────────────────────

export default function PlanningOptimizerPage() {
  const [plans, setPlans] = useState<SavedPlanSummary[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [objective, setObjective] = useState<Objective>({ penaltyLambda: 1 });
  const [ranking, setRanking] = useState(false);
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingPlans(true);
      try {
        const res = await fetch('/api/bus-ops/plan');
        const data = res.ok ? await res.json() : [];
        setPlans(Array.isArray(data) ? data : []);
      } finally {
        setLoadingPlans(false);
      }
    })();
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const run = async () => {
    setError(null); setResult(null); setRanking(true);
    try {
      const res = await fetch('/api/bus-ops/planning/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planIds: [...selected],
          objective: stripEmpty(objective as unknown as Record<string, unknown>),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setResult(data as OptimizeResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ranking failed');
    } finally {
      setRanking(false);
    }
  };

  const canRun = selected.size >= 2 && !ranking;
  const feasibleWinner = result?.ranked.find((r) => r.feasible) ?? null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Planning Optimizer"
        subtitle="Rank saved plans by operating cost + Planning Constraint penalties. Read-only — apply through the bulk plan page."
        icon={Sparkles}
        accent="violet"
      />

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — plan picker */}
        <section className="lg:col-span-2 space-y-3">
          <SectionHeading>Candidate plans</SectionHeading>
          {loadingPlans ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-10 text-center text-slate-400 animate-pulse">Loading saved plans…</div>
          ) : plans.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center text-slate-400">
              No saved plans yet. Compute + save a couple on the <a href="/bus-ops/plan" className="text-violet-400 hover:underline">Planning Core</a> page first.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/80 text-left text-xs uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="w-10 px-3 py-2"></th>
                    <th className="px-3 py-2">Plan</th>
                    <th className="px-3 py-2">Range</th>
                    <th className="px-3 py-2 text-right">Pay cost</th>
                    <th className="px-3 py-2 text-right">Trips · Drivers · Blocks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {plans.map((p) => {
                    const isSelected = selected.has(p.id);
                    return (
                      <tr key={p.id} className={`text-slate-200 hover:bg-slate-800/40 ${isSelected ? 'bg-violet-500/5' : ''}`}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggle(p.id)}
                            className="h-4 w-4 rounded border-slate-600 bg-slate-800"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-slate-500">{p.status ?? 'DRAFT'}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-400">
                          {fmtDate(p.dateFrom)} → {fmtDate(p.dateTo)}
                        </td>
                        <td className="px-3 py-2 text-right">{fmtMoney(p.summary?.totalPayCost)}</td>
                        <td className="px-3 py-2 text-right text-slate-400">
                          {p.summary?.tripCount ?? '—'} · {p.summary?.driverCount ?? '—'} · {p.summary?.blockCount ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-slate-500">Pick at least 2 plans to rank.</p>
        </section>

        {/* Right — objective */}
        <aside className="space-y-3">
          <SectionHeading>Objective</SectionHeading>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-4">
            <Field label="Penalty λ" hint="weight on PCE totalPenalty (default 1)">
              <input
                type="number" step="0.1"
                value={objective.penaltyLambda ?? ''}
                onChange={(e) => setObjective({ ...objective, penaltyLambda: emptyToUndef(e.target.value) })}
                placeholder="1"
                className={inputCls}
              />
            </Field>

            <details className="group rounded-lg border border-slate-800 bg-slate-900/60">
              <summary className="cursor-pointer list-none px-3 py-2 text-xs uppercase tracking-wider text-slate-400 hover:text-slate-200 flex items-center justify-between">
                <span>Cost model overrides</span>
                <span className="text-[10px] font-normal opacity-60">optional</span>
              </summary>
              <div className="border-t border-slate-800 p-3 space-y-3">
                <p className="text-xs text-slate-500">
                  By default the optimizer uses each plan&apos;s <code>summary.totalPayCost</code>. Set any rate below to override with a per-metric breakdown:
                </p>
                <Field label="Cost per pay-hour">
                  <input type="number" step="0.01" value={objective.costPerPayHour ?? ''}
                    onChange={(e) => setObjective({ ...objective, costPerPayHour: emptyToUndef(e.target.value) })}
                    placeholder="e.g. 25" className={inputCls} />
                </Field>
                <Field label="Cost per deadhead-hour">
                  <input type="number" step="0.01" value={objective.costPerDeadheadHour ?? ''}
                    onChange={(e) => setObjective({ ...objective, costPerDeadheadHour: emptyToUndef(e.target.value) })}
                    placeholder="e.g. 15" className={inputCls} />
                </Field>
                <Field label="Cost per vehicle-day">
                  <input type="number" step="0.01" value={objective.costPerVehicleDay ?? ''}
                    onChange={(e) => setObjective({ ...objective, costPerVehicleDay: emptyToUndef(e.target.value) })}
                    placeholder="e.g. 100" className={inputCls} />
                </Field>
                <Field label="Cost per driver-day">
                  <input type="number" step="0.01" value={objective.costPerDriverDay ?? ''}
                    onChange={(e) => setObjective({ ...objective, costPerDriverDay: emptyToUndef(e.target.value) })}
                    placeholder="e.g. 40" className={inputCls} />
                </Field>
              </div>
            </details>

            <button
              onClick={run}
              disabled={!canRun}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {ranking ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {ranking ? 'Ranking…' : `Rank ${selected.size || ''} plans`.trim()}
            </button>
          </div>

          {!ranking && result && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-400 space-y-1">
              <div className="flex items-center gap-2 text-slate-300"><Info className="w-3.5 h-3.5" /> Applied objective</div>
              {Object.entries(result.objective).map(([k, v]) => (
                <div key={k} className="ml-5 flex justify-between">
                  <span className="font-mono">{k}</span>
                  <span className="text-slate-300">{v}</span>
                </div>
              ))}
              {Object.keys(result.objective).length === 0 && <div className="ml-5 opacity-60">(defaults)</div>}
            </div>
          )}
        </aside>
      </div>

      {/* Results */}
      {result && (
        <section className="space-y-3">
          <SectionHeading>
            <span className="mr-2">Ranked results</span>
            {feasibleWinner && (
              <span className="text-xs font-normal text-slate-400">
                — winner: <span className="font-semibold text-emerald-400">{feasibleWinner.planName}</span> at {fmtMoney(feasibleWinner.totalCost)}
              </span>
            )}
          </SectionHeading>
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/80 text-left text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="w-12 px-3 py-2 text-center">#</th>
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2">Verdict</th>
                  <th className="px-3 py-2 text-right">Op. cost</th>
                  <th className="px-3 py-2 text-right">PCE penalty</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Trips gated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {result.ranked.map((r, i) => (
                  <RankedRow key={r.planId} score={r} rank={i + 1} isWinner={r === feasibleWinner} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Row ────────────────────────────────────────────────────────────

function RankedRow({ score, rank, isWinner }: { score: PlanScore; rank: number; isWinner: boolean }) {
  return (
    <tr className={`text-slate-200 ${isWinner ? 'bg-emerald-500/5' : score.feasible ? '' : 'bg-slate-800/40 text-slate-400'}`}>
      <td className="px-3 py-2 text-center">
        {isWinner ? (
          <Trophy className="mx-auto h-4 w-4 text-emerald-400" />
        ) : (
          <span className="text-xs text-slate-500">{rank}</span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="font-medium">{score.planName}</div>
        <div className="font-mono text-[10px] text-slate-500">{score.planId.slice(0, 8)}</div>
      </td>
      <td className="px-3 py-2"><VerdictBadge verdict={score.verdict} /></td>
      <td className="px-3 py-2 text-right">{fmtMoney(score.operatingCost)}</td>
      <td className="px-3 py-2 text-right">
        {score.pcePenalty > 0
          ? <span className="text-violet-300">{score.pcePenalty}</span>
          : <span className="text-slate-500">—</span>}
      </td>
      <td className="px-3 py-2 text-right font-semibold">{fmtMoney(score.totalCost)}</td>
      <td className="px-3 py-2 text-right text-xs">
        {score.blockedTripIds.length > 0 && (
          <span className="text-rose-300">{score.blockedTripIds.length} blocked</span>
        )}
        {score.blockedTripIds.length > 0 && score.warningTripIds.length > 0 && <span className="text-slate-600"> · </span>}
        {score.warningTripIds.length > 0 && (
          <span className="text-amber-300">{score.warningTripIds.length} warn</span>
        )}
        {score.blockedTripIds.length === 0 && score.warningTripIds.length === 0 && (
          <span className="text-slate-500">clean</span>
        )}
      </td>
    </tr>
  );
}

function VerdictBadge({ verdict }: { verdict: 'PASS' | 'WARN' | 'BLOCK' }) {
  const cls =
    verdict === 'BLOCK' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
    : verdict === 'WARN' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
  const Icon = verdict === 'BLOCK' ? XCircle : verdict === 'WARN' ? AlertTriangle : CheckCircle2;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>
      <Icon className="w-3 h-3" /> {verdict}
    </span>
  );
}

// ─── Building blocks ────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500';

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">{children}</h3>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</span>
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function emptyToUndef(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Drop undefined-valued keys so the outgoing JSON is minimal. */
function stripEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== '')
  ) as Partial<T>;
}
