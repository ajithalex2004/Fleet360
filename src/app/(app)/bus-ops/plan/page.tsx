'use client';
/**
 * /bus-ops/plan — the planning core page.
 *
 * What this page does:
 *   1. Pick a date range and a set of operator pay rules
 *   2. Hit POST /api/bus-ops/plan/compute to get a runcutting + blocking
 *      + (optional) rostering result back
 *   3. Inspect the result (summary, runs, blocks, rosters)
 *   4. Save the plan, apply it, or compare it against another saved plan
 *
 * This is the user-visible surface of the P0 work from the case study:
 * runcutting, blocking, rostering, and what-if comparison in one screen.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Sparkles, RefreshCw, Save, CheckCircle2, AlertTriangle, GitCompare,
  Play, Plus, X, ChevronDown, ChevronUp,
} from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';
import { useFetchedData, fetchOnce } from '@/hooks/useFetchedData';

// ── Types (mirror lib/plan/*) ───────────────────────────────────────────────

interface WorkRules {
  maxWorkHoursPerDay: number;
  maxSpreadHoursPerDay: number;
  minBreakBetweenTripsMins: number;
  overtimeThresholdHours: number;
  overtimeRate: number;
  hourlyRate: number;
  reportTimeMins: number;
  wrapTimeMins: number;
  deadheadMinsBetweenTrips: number;
  maxTripsPerRun: number;
}

const DEFAULT_RULES: WorkRules = {
  maxWorkHoursPerDay: 8,
  maxSpreadHoursPerDay: 12,
  minBreakBetweenTripsMins: 30,
  overtimeThresholdHours: 8,
  overtimeRate: 1.5,
  hourlyRate: 25,
  reportTimeMins: 15,
  wrapTimeMins: 10,
  deadheadMinsBetweenTrips: 15,
  maxTripsPerRun: 12,
};

interface BlockOptions {
  maxDeadheadMins: number;
  maxBlockWorkMins: number;
  minBlockWorkMins: number;
}

const DEFAULT_BLOCK: BlockOptions = {
  maxDeadheadMins: 60,
  maxBlockWorkMins: 480,
  minBlockWorkMins: 60,
};

interface RunTrip {
  tripId: string;
  routeId: string;
  routeName?: string;
  routeOrigin?: string;
  routeDestination?: string;
  departureTime: string;
  arrivalTime: string | null;
  durationMins: number;
  deadheadMinsBefore: number;
}

interface PlanRun {
  id: string;
  date: string;
  shiftType: string | null;
  tripIds: string[];
  trips: RunTrip[];
  workMins: number;
  spreadMins: number;
  straightTimeMins: number;
  overtimeMins: number;
  payMins: number;
  payCost: number;
  notes: string[];
}

interface BlockTrip {
  tripId: string;
  routeId?: string;
  routeName?: string;
  routeOrigin?: string;
  routeDestination?: string;
  departureTime: string;
  arrivalTime: string | null;
  durationMins: number;
  deadheadMinsBefore: number;
}

interface PlanBlock {
  id: string;
  vehicleLabel: string;
  date: string;
  tripIds: string[];
  trips: BlockTrip[];
  deadheadMins: number;
  workMins: number;
  spanMins: number;
}

interface RosterDay {
  date: string;
  runIds: string[];
  isRestDay: boolean;
}

interface DriverRoster {
  driverId: string;
  driverName: string;
  pattern: string;
  days: RosterDay[];
  totalWorkMins: number;
  totalPayHours: number;
  notes: string[];
}

interface PlanSummary {
  tripCount: number;
  runCount: number;
  blockCount: number;
  driverCount: number;
  avgTripsPerRun: number;
  avgTripsPerBlock: number;
  avgRunsPerDriver: number;
  totalPayHours: number;
  totalPayCost: number;
  totalWorkHours: number;
  totalDeadheadHours: number;
  overtimeHours: number;
}

interface Plan {
  id: string | null;
  name: string;
  description: string | null;
  dateFrom: string;
  dateTo: string;
  workRules: WorkRules;
  blockOptions: BlockOptions;
  runs: PlanRun[];
  blocks: PlanBlock[];
  rosters: DriverRoster[];
  summary: PlanSummary;
  unassignedTripIds?: string[];
  unassignedRosterRunIds?: string[];
}

interface SavedPlanSummary {
  id: string;
  name: string;
  description: string | null;
  dateFrom: string;
  dateTo: string;
  status: string | null;
  summary: PlanSummary;
  createdAt: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function addDays(iso: string, n: number): string {
  const d = new Date(iso); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}
function fmtHours(mins: number): string {
  return `${(mins / 60).toFixed(1)}h`;
}
function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(n);
}

// ── Component ──────────────────────────────────────────────────────────────

export default function PlanPage() {
  // Date range: today → today+6 by default
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo,   setDateTo]   = useState(addDays(todayIso(), 6));

  const [workRules, setWorkRules] = useState<WorkRules>(DEFAULT_RULES);
  const [blockOptions, setBlockOptions] = useState<BlockOptions>(DEFAULT_BLOCK);

  // Roster config
  const [includeRoster, setIncludeRoster] = useState(false);
  const [defaultPattern, setDefaultPattern] = useState<'5/2' | '4/3' | '6/1'>('5/2');
  const [selectedDriverIds, setSelectedDriverIds] = useState<string[]>([]);

  const [computing, setComputing] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Compare view
  const [savedPlans, setSavedPlans] = useState<SavedPlanSummary[]>([]);
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);
  const [compareResult, setCompareResult] = useState<{
    left: SavedPlanSummary & { workRules: WorkRules; blockOptions: BlockOptions };
    right: SavedPlanSummary & { workRules: WorkRules; blockOptions: BlockOptions };
    diff: Record<string, { left: number; right: number; delta: number; deltaPct?: number }>;
  } | null>(null);
  const [comparing, setComparing] = useState(false);

  // Apply state
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ tripsAffected: number; driversAssigned: number; vehiclesAssigned: number } | null>(null);

  // Load drivers (for roster) and saved plans list
  const driversRes = useFetchedData<{ id: string; name: string; licenseType: string | null }[]>(
    '/api/bus-ops/drivers',
  );
  const drivers = useMemo(() => Array.isArray(driversRes.data) ? driversRes.data : [], [driversRes.data]);
  const driversLite = useMemo(() => drivers.map((d) => ({ id: d.id, name: d.name })), [drivers]);

  const plansListRes = useFetchedData<SavedPlanSummary[]>('/api/bus-ops/plan');
  useEffect(() => {
    if (Array.isArray(plansListRes.data)) {
      setSavedPlans(plansListRes.data);
      // Default the compare selectors to the two most recent plans
      if (plansListRes.data.length >= 2 && !leftId && !rightId) {
        setLeftId(plansListRes.data[0].id);
        setRightId(plansListRes.data[1].id);
      }
    }
  }, [plansListRes.data, leftId, rightId]);

  // ── Compute ─────────────────────────────────────────────────────────────
  const compute = async () => {
    setComputing(true); setError(null); setApplyResult(null);
    try {
      const body: Record<string, unknown> = {
        dateFrom, dateTo,
        workRules, blockOptions,
        save: false,
        roster: includeRoster && selectedDriverIds.length > 0
          ? { defaultPattern, driverIds: selectedDriverIds }
          : undefined,
      };
      const res = await fetch('/api/bus-ops/plan/compute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Plan compute failed');
      }
      const data = await res.json();
      setPlan(data.plan as Plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Plan compute failed');
    } finally {
      setComputing(false);
    }
  };

  // ── Save ────────────────────────────────────────────────────────────────
  const save = async () => {
    if (!plan) return;
    try {
      const res = await fetch('/api/bus-ops/plan/compute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateFrom, dateTo,
          name: plan.name,
          description: plan.description,
          save: true,
          workRules, blockOptions,
          roster: includeRoster && selectedDriverIds.length > 0
            ? { defaultPattern, driverIds: selectedDriverIds }
            : undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Save failed');
      }
      const data = await res.json();
      setPlan({ ...plan, id: (data.plan as Plan).id });
      // Refresh list
      plansListRes.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  // ── Apply ──────────────────────────────────────────────────────────────
  const apply = async () => {
    if (!plan?.id) return;
    if (!confirm('Apply this plan? The run→driver and block→vehicle assignments will be written back to trip_schedules.')) return;
    setApplying(true); setError(null);
    try {
      const res = await fetch(`/api/bus-ops/plan/${plan.id}/apply`, { method: 'POST' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Apply failed');
      }
      const data = await res.json();
      setApplyResult({
        tripsAffected: data.tripsAffected,
        driversAssigned: data.driversAssigned,
        vehiclesAssigned: data.vehiclesAssigned,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Apply failed');
    } finally {
      setApplying(false);
    }
  };

  // ── Compare ────────────────────────────────────────────────────────────
  const compare = async () => {
    if (!leftId || !rightId) return;
    setComparing(true); setError(null);
    try {
      const res = await fetch('/api/bus-ops/plan/compare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leftId, rightId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Compare failed');
      }
      const data = await res.json();
      setCompareResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Compare failed');
    } finally {
      setComparing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planning Core"
        subtitle="Runcut trips into driver pieces-of-work, block them onto vehicles, and roster across drivers — what-if comparison included."
        icon={Sparkles}
        accent="violet"
        actions={
          <button onClick={compute} disabled={computing}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 hover:opacity-90 disabled:opacity-50">
            <Sparkles className="w-4 h-4" /> {computing ? 'Computing…' : 'Compute Plan'}
          </button>
        }
      />

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* ── Inputs ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Date range */}
        <div className="rounded-2xl bg-slate-800/50 border border-white/10 p-5">
          <h3 className="text-sm font-bold text-white mb-3">Date Range</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="w-full bg-slate-900 border border-white/15 rounded-lg px-3 py-2 text-white text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="w-full bg-slate-900 border border-white/15 rounded-lg px-3 py-2 text-white text-sm" />
            </div>
          </div>
        </div>

        {/* Work rules */}
        <div className="rounded-2xl bg-slate-800/50 border border-white/10 p-5">
          <h3 className="text-sm font-bold text-white mb-3">Operator Pay Rules</h3>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <NumberField label="Max work hrs/day" value={workRules.maxWorkHoursPerDay} step="0.5"
              onChange={(v) => setWorkRules({ ...workRules, maxWorkHoursPerDay: v })} />
            <NumberField label="Max spread hrs/day" value={workRules.maxSpreadHoursPerDay} step="0.5"
              onChange={(v) => setWorkRules({ ...workRules, maxSpreadHoursPerDay: v })} />
            <NumberField label="OT threshold (hrs)" value={workRules.overtimeThresholdHours} step="0.5"
              onChange={(v) => setWorkRules({ ...workRules, overtimeThresholdHours: v })} />
            <NumberField label="OT rate (×)" value={workRules.overtimeRate} step="0.1"
              onChange={(v) => setWorkRules({ ...workRules, overtimeRate: v })} />
            <NumberField label="Hourly rate (AED)" value={workRules.hourlyRate} step="1"
              onChange={(v) => setWorkRules({ ...workRules, hourlyRate: v })} />
            <NumberField label="Min break (min)" value={workRules.minBreakBetweenTripsMins} step="5"
              onChange={(v) => setWorkRules({ ...workRules, minBreakBetweenTripsMins: v })} />
            <NumberField label="Report (min)" value={workRules.reportTimeMins} step="5"
              onChange={(v) => setWorkRules({ ...workRules, reportTimeMins: v })} />
            <NumberField label="Wrap (min)" value={workRules.wrapTimeMins} step="5"
              onChange={(v) => setWorkRules({ ...workRules, wrapTimeMins: v })} />
          </div>
        </div>

        {/* Block options + roster */}
        <div className="rounded-2xl bg-slate-800/50 border border-white/10 p-5">
          <h3 className="text-sm font-bold text-white mb-3">Blocking &amp; Rostering</h3>
          <div className="grid grid-cols-2 gap-2 text-[11px] mb-3">
            <NumberField label="Max deadhead (min)" value={blockOptions.maxDeadheadMins} step="5"
              onChange={(v) => setBlockOptions({ ...blockOptions, maxDeadheadMins: v })} />
            <NumberField label="Max block work (min)" value={blockOptions.maxBlockWorkMins} step="30"
              onChange={(v) => setBlockOptions({ ...blockOptions, maxBlockWorkMins: v })} />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300 mb-2 cursor-pointer">
            <input type="checkbox" checked={includeRoster} onChange={(e) => setIncludeRoster(e.target.checked)}
              className="rounded border-white/20" />
            Include rostering
          </label>
          {includeRoster && (
            <>
              <div className="mb-2">
                <label className="block text-[11px] text-slate-400 mb-1">Default pattern</label>
                <select value={defaultPattern} onChange={(e) => setDefaultPattern(e.target.value as '5/2' | '4/3' | '6/1')}
                  className="w-full bg-slate-900 border border-white/15 rounded-lg px-3 py-2 text-white text-sm">
                  <option value="5/2">5/2 (Mon-Fri work, Sat-Sun off)</option>
                  <option value="4/3">4/3 (compressed work week)</option>
                  <option value="6/1">6/1 (six-day rotation)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Drivers ({selectedDriverIds.length} selected)</label>
                <div className="max-h-32 overflow-y-auto bg-slate-900 border border-white/15 rounded-lg p-2 space-y-1">
                  {driversLite.length === 0 ? (
                    <p className="text-[11px] text-slate-500 italic px-2 py-1">No drivers loaded yet</p>
                  ) : driversLite.map((d) => (
                    <label key={d.id} className="flex items-center gap-2 text-[11px] text-slate-200 cursor-pointer hover:bg-slate-800 px-1 py-0.5 rounded">
                      <input type="checkbox"
                        checked={selectedDriverIds.includes(d.id)}
                        onChange={(e) => setSelectedDriverIds((s) => e.target.checked ? [...s, d.id] : s.filter((x) => x !== d.id))}
                        className="rounded border-white/20" />
                      {d.name}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Result summary ───────────────────────────────────────────────── */}
      {plan && (
        <>
          <div className="rounded-2xl bg-slate-800/50 border border-white/10 p-5">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-white">Plan Result</h3>
                <p className="text-xs text-slate-400">
                  {plan.summary.tripCount} trips → {plan.summary.runCount} runs · {plan.summary.blockCount} blocks · {plan.summary.driverCount} drivers
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input type="text" placeholder="Plan name" defaultValue={`Plan ${plan.dateFrom} → ${plan.dateTo}`}
                  onBlur={(e) => setPlan({ ...plan, name: e.target.value })}
                  className="bg-slate-900 border border-white/15 rounded-lg px-3 py-2 text-white text-sm w-64" />
                <button onClick={save} disabled={!!plan.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 px-3 py-2 text-sm text-white disabled:opacity-50">
                  <Save className="w-3.5 h-3.5" /> {plan.id ? 'Saved' : 'Save'}
                </button>
                <button onClick={apply} disabled={!plan.id || applying}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-2 text-sm text-white disabled:opacity-50">
                  <Play className="w-3.5 h-3.5" /> {applying ? 'Applying…' : 'Apply'}
                </button>
              </div>
            </div>
            {applyResult && (
              <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-200 inline-flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Applied: {applyResult.tripsAffected} trips affected, {applyResult.driversAssigned} drivers, {applyResult.vehiclesAssigned} vehicles.
              </div>
            )}

            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              <KpiCard label="Total pay cost" value={fmtMoney(plan.summary.totalPayCost)} sub={`${plan.summary.totalPayHours}h total`} accent="emerald" />
              <KpiCard label="Overtime" value={fmtHours(plan.summary.overtimeHours * 60)} sub="of total hours" accent="amber" />
              <KpiCard label="Total work" value={fmtHours(plan.summary.totalWorkHours * 60)} sub="sum of trip durations" accent="blue" />
              <KpiCard label="Deadhead" value={fmtHours(plan.summary.totalDeadheadHours * 60)} sub="non-driving paid" accent="slate" />
              <KpiCard label="Runs" value={plan.summary.runCount} sub={`${plan.summary.avgTripsPerRun.toFixed(1)} trips/run`} accent="violet" />
              <KpiCard label="Blocks" value={plan.summary.blockCount} sub={`${plan.summary.avgTripsPerBlock.toFixed(1)} trips/block`} accent="cyan" />
            </div>
          </div>

          {/* Runs table */}
          <RunsSection runs={plan.runs} />

          {/* Blocks table */}
          <BlocksSection blocks={plan.blocks} />

          {/* Rosters grid */}
          {plan.rosters.length > 0 && <RostersSection rosters={plan.rosters} />}
        </>
      )}

      {/* ── Compare view ────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-slate-800/50 border border-white/10 p-5">
        <h3 className="text-base font-bold text-white mb-3 flex items-center gap-2">
          <GitCompare className="w-4 h-4 text-fuchsia-400" /> Compare Scenarios
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Left (A)</label>
            <select value={leftId ?? ''} onChange={(e) => setLeftId(e.target.value || null)}
              className="w-full bg-slate-900 border border-white/15 rounded-lg px-3 py-2 text-white text-sm">
              <option value="">— pick a plan —</option>
              {savedPlans.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.dateFrom} → {p.dateTo})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Right (B)</label>
            <select value={rightId ?? ''} onChange={(e) => setRightId(e.target.value || null)}
              className="w-full bg-slate-900 border border-white/15 rounded-lg px-3 py-2 text-white text-sm">
              <option value="">— pick a plan —</option>
              {savedPlans.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.dateFrom} → {p.dateTo})</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={compare} disabled={!leftId || !rightId || comparing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 px-4 py-2 text-sm text-white disabled:opacity-50">
              <GitCompare className="w-3.5 h-3.5" /> {comparing ? 'Comparing…' : 'Compare'}
            </button>
          </div>
        </div>
        {compareResult && <CompareDiff compareResult={compareResult} />}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function NumberField({ label, value, step, onChange }: { label: string; value: number; step: string; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-slate-400 mb-0.5">{label}</label>
      <input type="number" value={value} step={step} onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-slate-900 border border-white/15 rounded-lg px-2 py-1.5 text-white text-sm" />
    </div>
  );
}

function KpiCard({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent: 'emerald' | 'amber' | 'blue' | 'slate' | 'violet' | 'cyan' | 'rose' }) {
  const ACCENT: Record<string, string> = {
    emerald: 'from-emerald-500/20 to-emerald-500/0 border-emerald-500/30',
    amber:   'from-amber-500/20 to-amber-500/0 border-amber-500/30',
    blue:    'from-blue-500/20 to-blue-500/0 border-blue-500/30',
    slate:   'from-slate-500/20 to-slate-500/0 border-slate-500/30',
    violet:  'from-violet-500/20 to-violet-500/0 border-violet-500/30',
    cyan:    'from-cyan-500/20 to-cyan-500/0 border-cyan-500/30',
    rose:    'from-rose-500/20 to-rose-500/0 border-rose-500/30',
  };
  return (
    <div className={`rounded-xl bg-gradient-to-br ${ACCENT[accent]} border p-3`}>
      <p className="text-[10px] uppercase tracking-wider text-slate-300">{label}</p>
      <p className="text-xl font-bold text-white mt-1">{value}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function RunsSection({ runs }: { runs: PlanRun[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-2xl bg-slate-800/50 border border-white/10 p-5">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between mb-3">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <span>Runs</span>
          <span className="text-xs bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded-full border border-violet-500/30">{runs.length}</span>
        </h3>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 text-slate-400">
                <th className="text-left py-2 px-2">Date</th>
                <th className="text-left py-2 px-2">Shift</th>
                <th className="text-right py-2 px-2">Trips</th>
                <th className="text-right py-2 px-2">Work</th>
                <th className="text-right py-2 px-2">Spread</th>
                <th className="text-right py-2 px-2">OT</th>
                <th className="text-right py-2 px-2">Pay cost</th>
                <th className="text-left py-2 px-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-2 px-2 text-slate-200">{fmtDate(r.date)}</td>
                  <td className="py-2 px-2 text-slate-400">{r.shiftType ?? '—'}</td>
                  <td className="py-2 px-2 text-right text-white">{r.trips.length}</td>
                  <td className="py-2 px-2 text-right text-white">{fmtHours(r.workMins)}</td>
                  <td className="py-2 px-2 text-right text-slate-300">{fmtHours(r.spreadMins)}</td>
                  <td className="py-2 px-2 text-right">
                    {r.overtimeMins > 0
                      ? <span className="text-amber-300">+{fmtHours(r.overtimeMins)}</span>
                      : <span className="text-slate-500">—</span>}
                  </td>
                  <td className="py-2 px-2 text-right text-emerald-300 font-semibold">{fmtMoney(r.payCost)}</td>
                  <td className="py-2 px-2 text-slate-400">
                    {r.notes.length > 0 ? r.notes.map((n, i) => <span key={i} className="block">{n}</span>) : '—'}
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr><td colSpan={8} className="text-center text-slate-500 py-4">No runs in the selected range.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BlocksSection({ blocks }: { blocks: PlanBlock[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-2xl bg-slate-800/50 border border-white/10 p-5">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between mb-3">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <span>Blocks (vehicle groupings)</span>
          <span className="text-xs bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full border border-cyan-500/30">{blocks.length}</span>
        </h3>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 text-slate-400">
                <th className="text-left py-2 px-2">Date</th>
                <th className="text-left py-2 px-2">Block</th>
                <th className="text-right py-2 px-2">Trips</th>
                <th className="text-right py-2 px-2">Work</th>
                <th className="text-right py-2 px-2">Span</th>
                <th className="text-right py-2 px-2">Deadhead</th>
                <th className="text-left py-2 px-2">Trip sequence</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => (
                <tr key={b.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-2 px-2 text-slate-200">{fmtDate(b.date)}</td>
                  <td className="py-2 px-2 text-cyan-300 font-semibold">{b.vehicleLabel}</td>
                  <td className="py-2 px-2 text-right text-white">{b.trips.length}</td>
                  <td className="py-2 px-2 text-right text-white">{fmtHours(b.workMins)}</td>
                  <td className="py-2 px-2 text-right text-slate-300">{fmtHours(b.spanMins)}</td>
                  <td className="py-2 px-2 text-right text-slate-300">{fmtHours(b.deadheadMins)}</td>
                  <td className="py-2 px-2 text-slate-400">
                    {b.trips.map((t, i) => (
                      <span key={t.tripId}>
                        <span className="text-slate-500">{i > 0 ? ' → ' : ''}</span>
                        <span className="text-slate-200">{t.routeName ?? t.tripId.slice(0, 6)}</span>
                        <span className="text-slate-500"> ({fmtTime(t.departureTime)})</span>
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
              {blocks.length === 0 && (
                <tr><td colSpan={7} className="text-center text-slate-500 py-4">No blocks in the selected range.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RostersSection({ rosters }: { rosters: DriverRoster[] }) {
  return (
    <div className="rounded-2xl bg-slate-800/50 border border-white/10 p-5">
      <h3 className="text-base font-bold text-white mb-3 flex items-center gap-2">
        <span>Rosters (weekly driver patterns)</span>
        <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">{rosters.length} drivers</span>
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {rosters.map((r) => (
          <div key={r.driverId} className="rounded-xl bg-slate-900/50 border border-white/10 p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-white truncate">{r.driverName}</p>
              <span className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded border border-white/10">{r.pattern}</span>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-2">
              {r.days.map((d) => {
                const hasRun = d.runIds.length > 0;
                return (
                  <div key={d.date} title={`${fmtDate(d.date)}: ${hasRun ? d.runIds.length + ' runs' : 'off'}`}
                    className={`h-6 rounded text-[9px] flex items-center justify-center font-semibold ${
                      d.isRestDay ? 'bg-slate-800 text-slate-500' :
                      hasRun   ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40' :
                                 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
                    }`}>
                    {fmtDate(d.date).slice(0, 1)}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>Week: {fmtHours(r.totalWorkMins)}</span>
              <span>Pay: {r.totalPayHours}h</span>
            </div>
            {r.notes.length > 0 && (
              <div className="mt-1 text-[10px] text-amber-300">{r.notes.join(' · ')}</div>
            )}
          </div>
        ))}
        {rosters.length === 0 && <p className="text-slate-500 italic">No drivers in this roster yet — pick drivers and recompute.</p>}
      </div>
    </div>
  );
}

function CompareDiff({ compareResult }: { compareResult: { left: SavedPlanSummary & { workRules: WorkRules; blockOptions: BlockOptions }; right: SavedPlanSummary & { workRules: WorkRules; blockOptions: BlockOptions }; diff: Record<string, { left: number; right: number; delta: number; deltaPct?: number }> } }) {
  const rows = [
    { key: 'runCount',           label: 'Runs',                 unit: '' },
    { key: 'blockCount',         label: 'Blocks',               unit: '' },
    { key: 'driverCount',        label: 'Drivers',              unit: '' },
    { key: 'totalPayCost',       label: 'Total pay cost',       unit: 'AED' },
    { key: 'totalPayHours',      label: 'Total pay hours',      unit: 'h' },
    { key: 'totalWorkHours',     label: 'Total work hours',     unit: 'h' },
    { key: 'totalDeadheadHours', label: 'Total deadhead hours', unit: 'h' },
    { key: 'overtimeHours',      label: 'Overtime hours',       unit: 'h' },
  ];
  return (
    <div className="rounded-xl bg-slate-900/50 border border-white/10 p-4">
      <p className="text-xs text-slate-400 mb-2">
        A: <span className="text-white font-semibold">{compareResult.left.name}</span> ({compareResult.left.dateFrom} → {compareResult.left.dateTo})
        &nbsp;vs&nbsp;
        B: <span className="text-white font-semibold">{compareResult.right.name}</span> ({compareResult.right.dateFrom} → {compareResult.right.dateTo})
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-400 border-b border-white/10">
            <th className="text-left py-2">Metric</th>
            <th className="text-right py-2">A</th>
            <th className="text-right py-2">B</th>
            <th className="text-right py-2">Δ</th>
            <th className="text-right py-2">Δ %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = compareResult.diff[r.key];
            if (!d) return null;
            const improved = d.delta < 0;
            const worsened = d.delta > 0;
            const cls = improved ? 'text-emerald-300' : worsened ? 'text-rose-300' : 'text-slate-300';
            return (
              <tr key={r.key} className="border-b border-white/5">
                <td className="py-1.5 text-slate-300">{r.label}</td>
                <td className="py-1.5 text-right text-slate-200">{r.unit === 'AED' ? fmtMoney(d.left) : `${d.left}${r.unit}`}</td>
                <td className="py-1.5 text-right text-slate-200">{r.unit === 'AED' ? fmtMoney(d.right) : `${d.right}${r.unit}`}</td>
                <td className={`py-1.5 text-right font-semibold ${cls}`}>{d.delta > 0 ? '+' : ''}{r.unit === 'AED' ? fmtMoney(d.delta) : `${d.delta}${r.unit}`}</td>
                <td className={`py-1.5 text-right ${cls}`}>{d.deltaPct === undefined ? '—' : `${d.deltaPct > 0 ? '+' : ''}${d.deltaPct}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
