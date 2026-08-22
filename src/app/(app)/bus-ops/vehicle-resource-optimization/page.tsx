'use client';

import Link from 'next/link';

/**
 * Vehicle/Resource Optimization — "Case 2" sequential vehicle reuse.
 *
 * Split out of the Route Consolidation Engine page into its own widget:
 * Case 1 (route merges) and Case 2 (same vehicle reused across two
 * unchanged, sequential trips) are different resource models with
 * different Apply semantics (route mutation vs. scheduling/dispatch
 * assignment — Case 2 has no Apply yet), so keeping them as separate
 * tabs on one page risked operators reading "these routes should merge"
 * and "these routes should stay separate but could share a bus" as the
 * same kind of recommendation. Consumes
 * POST /api/bus-ops/route-consolidation/vehicle-reuse (still lives
 * under the route-consolidation API namespace — same underlying
 * matrix/zone-compat/facts machinery, just a different analysis).
 *
 * Advisory only: nothing is written here. Ops completes the actual
 * vehicle/driver reassignment manually via the Schedules/Dispatch
 * screens.
 */

import React, { useCallback, useState } from 'react';
import { Repeat, RefreshCw, ChevronDown, ChevronRight, Info, AlertTriangle, GitMerge, ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';
import RequireTenantAdmin from '@/components/bus-ops/RequireTenantAdmin';
import FleetDataGrid, { type DataGridColumn } from '@/components/ui/FleetDataGrid';

// ─── Types matched to /vehicle-reuse response ───────────────────────

type ZoneCompatKind =
  | 'SAME_ZONE' | 'WITHIN_FALLBACK' | 'DIFFERENT_ZONES' | 'OUTSIDE_FALLBACK' | 'UNKNOWN';

/** Matches zone-compat.ts's real ZoneCompatResult exactly. */
type ZoneCompatResult = { kind: ZoneCompatKind; distanceKm: number | null; reason: string };

type VehicleReuseFeasibility = 'STRONG' | 'FEASIBLE' | 'TIGHT' | 'NOT_FEASIBLE';
type AssignmentComparisonStatus = 'SAME' | 'DIFFERENT' | 'UNASSIGNED';

interface VehicleReuseOpportunity {
  firstRouteId: string;
  firstRouteName: string;
  secondRouteId: string;
  secondRouteName: string;
  firstArrivalTime: string;
  secondDepartureTime: string;
  availableGapMinutes: number;
  minimumTurnaroundMinutes: number;
  repositionDistanceMeters: number;
  repositionDurationMinutes: number;
  requiredGapMinutes: number;
  remainingSlackMinutes: number;
  dropoffPickupZoneCompatibility: ZoneCompatResult;
  feasibility: VehicleReuseFeasibility;
  vehicleAssignmentStatus: AssignmentComparisonStatus;
  driverAssignmentStatus: AssignmentComparisonStatus;
  warnings: string[];
}

type VehicleReuseSkipReason =
  | 'MISSING_TIMING_DATA'
  | 'NOT_SEQUENTIAL'
  | 'OUTSIDE_REUSE_WINDOW'
  | 'ZONE_DATA_UNAVAILABLE'
  | 'ZONE_INCOMPATIBLE'
  | 'INSUFFICIENT_ROUTE_DATA';

interface SkippedReusePair {
  firstRouteId: string;
  secondRouteId: string;
  reason: VehicleReuseSkipReason;
  detail?: string;
}

interface VehicleReuseResponse {
  policy: { minimumTurnaroundMinutes: number; maxReuseWindowMinutes: number };
  opportunities: VehicleReuseOpportunity[];
  skipped: SkippedReusePair[];
  totals: { routesAnalysed: number; orderedPairsConsidered: number; opportunitiesFound: number };
}

const opportunityColumns: DataGridColumn<VehicleReuseOpportunity>[] = [
  { key: 'routeA', header: 'Route A', accessor: o => o.firstRouteName,
    render: o => <span className="font-medium">{o.firstRouteName}</span> },
  { key: 'arrives', header: 'Arrives', accessor: o => o.firstArrivalTime,
    render: o => <span className="text-xs text-slate-400">{o.firstArrivalTime}</span> },
  { key: 'routeB', header: 'Route B', accessor: o => o.secondRouteName,
    render: o => <span className="font-medium">{o.secondRouteName}</span> },
  { key: 'departs', header: 'Departs', accessor: o => o.secondDepartureTime,
    render: o => <span className="text-xs text-slate-400">{o.secondDepartureTime}</span> },
  { key: 'gap', header: 'Gap', accessor: o => o.availableGapMinutes, align: 'right',
    render: o => `${o.availableGapMinutes}m` },
  { key: 'reposition', header: 'Reposition', accessor: o => o.repositionDurationMinutes, align: 'right',
    render: o => <span className="text-xs text-slate-400">{o.repositionDurationMinutes}m</span> },
  { key: 'slack', header: 'Usable Slack', accessor: o => o.remainingSlackMinutes, align: 'right',
    render: o => (
      <span className={`font-semibold ${o.remainingSlackMinutes >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
        {o.remainingSlackMinutes >= 0 ? '+' : ''}{o.remainingSlackMinutes}m
      </span>
    ) },
  { key: 'status', header: 'Status', accessor: o => o.feasibility, filter: 'select',
    render: o => (
      <>
        <FeasibilityBadge feasibility={o.feasibility} />
        {o.warnings.length > 0 && <AlertTriangle className="inline-block w-3.5 h-3.5 ml-1.5 text-amber-400" />}
      </>
    ) },
];

// ─── Page ────────────────────────────────────────────────────────────

export default function VehicleResourceOptimizationPage() {
  return (
    <RequireTenantAdmin resource="vehicle-resource-optimization">
      <VehicleResourceOptimizationPageInner />
    </RequireTenantAdmin>
  );
}

function VehicleResourceOptimizationPageInner() {
  const [analysing, setAnalysing] = useState(false);
  const [result, setResult] = useState<VehicleReuseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every onAnalyse() call and used as the opportunities grid's
  // React `key` — forces a fresh FleetDataGrid instance instead of risking
  // stale expand state surviving onto a same-keyed row in a new result set.
  const [analysisRunId, setAnalysisRunId] = useState(0);
  const [showSkipped, setShowSkipped] = useState(false);

  const onAnalyse = useCallback(async () => {
    setAnalysing(true); setError(null); setResult(null); setAnalysisRunId(id => id + 1);
    try {
      const res = await fetch('/api/bus-ops/route-consolidation/vehicle-reuse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setResult(data as VehicleReuseResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
    } finally {
      setAnalysing(false);
    }
  }, []);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Vehicle/Resource Optimization Engine"
        subtitle="Find sequential trips the same vehicle + driver could serve back-to-back. Advisory only — no route changes, no Apply; complete the reassignment on Schedules."
        icon={Repeat}
        accent="violet"
        actions={
          <Link
            href="/bus-ops/route-consolidation"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            <GitMerge className="w-4 h-4" />
            Open Route Consolidation
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        }
      />

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}

      <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 px-4 py-3 text-sm text-blue-200 flex items-start gap-2">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          Advisory only — no route changes are made here. Route A and Route B stay exactly as they are;
          this only flags when the same vehicle + driver could serve both back-to-back. Complete the
          actual assignment on the <Link href="/bus-ops/schedules" className="underline hover:text-blue-100">Schedules</Link> screen.
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <aside className="space-y-3">
          <SectionHeading>Analysis</SectionHeading>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-4">
            <button onClick={onAnalyse} disabled={analysing}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {analysing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Repeat className="w-4 h-4" />}
              {analysing ? 'Analysing…' : 'Find reuse opportunities'}
            </button>
          </div>

          {result && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="flex items-center gap-2 mb-3 text-xs text-slate-400">
                <Info className="w-3.5 h-3.5" /> <span className="uppercase tracking-wider">Funnel</span>
              </div>
              <FunnelRow label="Routes analysed" value={result.totals.routesAnalysed} />
              <FunnelRow label="Ordered pairs considered" value={result.totals.orderedPairsConsidered} />
              <FunnelRow label="Opportunities found" value={result.totals.opportunitiesFound} accent="emerald" />
              <div className="mt-3 pt-3 border-t border-slate-800 text-[11px] text-slate-500 space-y-0.5">
                <div>Min turnaround: {result.policy.minimumTurnaroundMinutes} min</div>
                <div>Max reuse window: {result.policy.maxReuseWindowMinutes} min</div>
              </div>
            </div>
          )}
        </aside>

        <section className="lg:col-span-2 space-y-3">
          <SectionHeading>Vehicle/Resource Optimization Opportunities</SectionHeading>

          {!result ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center text-slate-400">
              <Repeat className="mx-auto h-10 w-10 text-slate-600 mb-3" />
              <p>Click <b>Find reuse opportunities</b> to look for sequential trips the same vehicle could serve.</p>
              <p className="mt-1 text-xs text-slate-500">Checked in both directions — A finishing in time for B, and B finishing in time for A.</p>
            </div>
          ) : result.opportunities.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center text-slate-400">
              <p>No reuse opportunities found.</p>
              <p className="mt-1 text-xs text-slate-500">
                {result.skipped.length > 0 ? `${result.skipped.length} pair${result.skipped.length === 1 ? '' : 's'} skipped — expand the breakdown below to see why.` : 'No pairs were even considered — check that you have ≥ 2 active routes in this tenant.'}
              </p>
            </div>
          ) : (
            <FleetDataGrid
              key={analysisRunId}
              gridName="VehicleReuseOpportunities"
              rows={result.opportunities}
              getRowId={o => `${o.firstRouteId}-${o.secondRouteId}`}
              loading={false}
              emptyMessage="No opportunities found"
              columns={opportunityColumns}
              numbered
              expandable={o => <ReuseOpportunityDetail o={o} />}
              toolbar={{ exportName: 'vehicle-reuse-opportunities', title: 'Opportunities' }}
            />
          )}

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
                  {groupSkippedReuse(result.skipped).map(([reason, pairs]) => (
                    <div key={reason} className="px-4 py-3">
                      <div className="flex items-baseline justify-between">
                        <div className="font-mono text-xs text-slate-300">{reason}</div>
                        <div className="text-xs text-slate-500">{pairs.length} pair{pairs.length === 1 ? '' : 's'}</div>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{describeReuseSkipReason(reason as VehicleReuseSkipReason)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── Building blocks ────────────────────────────────────────────────

function ReuseOpportunityDetail({ o }: { o: VehicleReuseOpportunity }) {
  return (
    <div className="space-y-3 text-xs text-slate-400">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        <div><span className="text-slate-500">Available gap:</span> {o.availableGapMinutes} min</div>
        <div><span className="text-slate-500">Minimum turnaround:</span> {o.minimumTurnaroundMinutes} min</div>
        <div><span className="text-slate-500">Reposition:</span> {(o.repositionDistanceMeters / 1000).toFixed(2)} km, {o.repositionDurationMinutes} min</div>
        <div><span className="text-slate-500">Required gap:</span> {o.requiredGapMinutes} min (turnaround + reposition)</div>
        <div><span className="text-slate-500">Usable slack:</span> <span className={o.remainingSlackMinutes >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{o.remainingSlackMinutes >= 0 ? '+' : ''}{o.remainingSlackMinutes} min</span></div>
        <div><span className="text-slate-500">Dropoff → pickup zone:</span> {formatZone(o.dropoffPickupZoneCompatibility)}</div>
      </div>
      <div className="border-t border-slate-800 pt-2 grid grid-cols-2 gap-x-6 gap-y-1">
        <div><span className="text-slate-500">Vehicle assignment:</span> <AssignmentStatusLabel status={o.vehicleAssignmentStatus} /></div>
        <div><span className="text-slate-500">Driver assignment:</span> <AssignmentStatusLabel status={o.driverAssignmentStatus} /></div>
      </div>
      {o.warnings.length > 0 && (
        <div className="border-t border-slate-800 pt-2 space-y-1">
          {o.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
      <div className="border-t border-slate-800 pt-2 text-slate-500">
        Advisory only — assign this vehicle/driver manually on the <Link href="/bus-ops/schedules" className="underline hover:text-slate-300">Schedules</Link> screen.
      </div>
    </div>
  );
}

function FeasibilityBadge({ feasibility }: { feasibility: VehicleReuseFeasibility }) {
  const cls =
    feasibility === 'STRONG' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
    : feasibility === 'FEASIBLE' ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
    : feasibility === 'TIGHT' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    : 'bg-rose-500/20 text-rose-300 border-rose-500/40';
  return <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{feasibility}</span>;
}

function AssignmentStatusLabel({ status }: { status: AssignmentComparisonStatus }) {
  if (status === 'SAME') return <span className="text-emerald-300">same</span>;
  if (status === 'DIFFERENT') return <span className="text-amber-300">differ</span>;
  return <span className="text-slate-500">unassigned</span>;
}

function groupSkippedReuse(skipped: SkippedReusePair[]): Array<[string, SkippedReusePair[]]> {
  const map = new Map<string, SkippedReusePair[]>();
  for (const s of skipped) {
    const list = map.get(s.reason) ?? [];
    list.push(s);
    map.set(s.reason, list);
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
}

function describeReuseSkipReason(reason: VehicleReuseSkipReason): string {
  switch (reason) {
    case 'MISSING_TIMING_DATA':   return 'One or both routes lack a parseable arrival/departure time.';
    case 'NOT_SEQUENTIAL':        return 'Route B departs before (or at the same time as) Route A arrives — not a sequential candidate.';
    case 'OUTSIDE_REUSE_WINDOW':  return 'The gap between arrival and departure is wider than the tenant\'s max reuse window — not a meaningful back-to-back candidate.';
    case 'ZONE_DATA_UNAVAILABLE': return 'Neither placeId nor GPS coords are usable on Route A\'s dropoff or Route B\'s pickup.';
    case 'ZONE_INCOMPATIBLE':     return 'Route A\'s dropoff and Route B\'s pickup are in different zones, or too far apart under the distance fallback.';
    case 'INSUFFICIENT_ROUTE_DATA': return 'One of the routes has no stops.';
  }
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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">{children}</h3>;
}

/** The backend already produces a well-formed human-readable reason per kind (zone-compat.ts) — reuse it directly rather than reconstructing our own formatting from distanceKm. */
function formatZone(z: ZoneCompatResult): string {
  return z.reason || 'unknown';
}
