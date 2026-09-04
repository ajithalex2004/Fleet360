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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles, RefreshCw, Save, CheckCircle2, AlertTriangle, GitCompare,
  Play, Plus, X, ChevronDown, ChevronUp, SlidersHorizontal, Bot,
} from 'lucide-react';
import { useFetchedData, fetchOnce } from '@/hooks/useFetchedData';
import { cbaToWorkRules } from '@/lib/cba/engine';
import type { CbaRules } from '@/lib/cba/types';
import PceVerdictPanel, { type PceVerdictBody } from '@/components/bus-ops/PceVerdictPanel';
import { StaffTransportAiDrawer } from './StaffTransportAiDrawer';

/**
 * Success-payload PCE gate section. Present when the apply route ran
 * the gate (i.e. PCE_APPLY_GATE_ENABLED wasn't disabled). Verdict is
 * PASS or WARN; BLOCK never reaches here — it comes back as a 409.
 */
type PceGatePayload =
  | { verdict: 'PASS' | 'WARN'; totalPenalty: number; warningTripIds: string[]; trips: PceVerdictBody['trips'] }
  | { verdict: 'DISABLED' };

/** 409 payload shape from /plan/[id]/apply when verdict === 'BLOCK'. */
type PceBlockPayload = {
  error: string;
  planId: string;
  verdict: 'BLOCK';
  blockedTripIds: string[];
  trips: PceVerdictBody['trips'];
  totalPenalty: number;
};

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

export interface PlanningCorePanelProps {
  /**
   * Bumped by the Planning Engine shell whenever the CBA tab mutates a
   * rule-set. Drives the stale-defaults prompt below rather than a
   * silent re-pre-fill, so a half-built plan is never overwritten
   * underneath the operator.
   */
  cbaRevision?: number;
  /**
   * Bumped when the Constraints tab mutates a PCE rule.
   *
   * Unlike cbaRevision this pre-fills nothing here — PCE constraints gate
   * the apply rather than seed the form. What it invalidates is a plan that
   * has already been computed: its verdict came from rules that have since
   * changed. So it only matters once `plan` exists, and the only remedy is
   * a recompute.
   */
  pceRevision?: number;
  /** Switches to the Constraints tab. Omitted when the user can't edit PCE. */
  onEditPceRules?: () => void;
  /**
   * Pre-fill the date range from an external caller (currently: the Demand
   * Forecast page's "Draft Plan" action on a flagged row). Falls back to
   * the normal today→today+6 default when omitted.
   */
  initialDateFrom?: string;
  initialDateTo?: string;
  /**
   * Run compute() once on mount using the initial date range above, so the
   * operator lands on an already-computed plan instead of a pre-filled form
   * they still have to click through. Only fires once, on first mount —
   * never re-triggers on a later prop change, so it can't clobber
   * in-progress work.
   */
  autoCompute?: boolean;
}

/**
 * Tab 3 of the Planning Engine, and the default landing tab — this is
 * the daily-driver task, whereas CBA, Constraints and Headway are
 * configured rarely.
 *
 * No RequireTenantAdmin wrapper here any more: the shell guards the whole
 * page on bus-ops:admin:planning-core, so wrapping again would just
 * double-render the permission check.
 */
export function PlanningCorePanel({
  cbaRevision = 0, pceRevision = 0, onEditPceRules,
  initialDateFrom, initialDateTo, autoCompute = false,
}: PlanningCorePanelProps = {}) {
  // Date range: today → today+6 by default, or the caller-supplied window
  // (e.g. a specific day flagged by the Demand Forecast page).
  const [dateFrom, setDateFrom] = useState(initialDateFrom ?? todayIso());
  const [dateTo,   setDateTo]   = useState(initialDateTo ?? addDays(todayIso(), 6));

  const [workRules, setWorkRules] = useState<WorkRules>(DEFAULT_RULES);
  // True once the user has edited any Operator Pay Rules field — once set,
  // the CBA pre-fill effect below stops overwriting their edits.
  const [workRulesTouched, setWorkRulesTouched] = useState(false);
  const [cbaSourceName, setCbaSourceName] = useState<string | null>(null);
  const updateWorkRule = (patch: Partial<WorkRules>) => {
    setWorkRulesTouched(true);
    setWorkRules((p) => ({ ...p, ...patch }));
  };
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

  // Apply state.
  //   applyResult   — success payload (may include a PASS or WARN pceGate)
  //   applyBlocked  — 409 payload from a PCE BLOCK verdict; treated as a
  //                   result to render (not an error) so the operator sees
  //                   which trips failed and can fix rules / assignments.
  const [applying, setApplying] = useState(false);
  const [isAiDrawerOpen, setIsAiDrawerOpen] = useState(false);
  const [applyResult, setApplyResult] = useState<{
    tripsAffected: number;
    driversAssigned: number;
    vehiclesAssigned: number;
    pceGate: PceGatePayload | null;
  } | null>(null);
  const [applyBlocked, setApplyBlocked] = useState<PceBlockPayload | null>(null);

  // Load drivers (for roster) and saved plans list
  const driversRes = useFetchedData<{ id: string; name: string; licenseType: string | null }[]>(
    '/api/bus-ops/drivers',
  );
  const drivers = useMemo(() => Array.isArray(driversRes.data) ? driversRes.data : [], [driversRes.data]);
  const driversLite = useMemo(() => drivers.map((d) => ({ id: d.id, name: d.name })), [drivers]);

  // Pre-fill Operator Pay Rules from the tenant's default CBA rule-set,
  // same conversion (cbaToWorkRules) the compute endpoint uses server-side
  // — so what the form shows on load matches what an unedited compute
  // call would actually apply. Only runs before the user edits anything;
  // see workRulesTouched / updateWorkRule above.
  const cbaDefaultRes = useFetchedData<{ name: string; rules: CbaRules } | null>('/api/bus-ops/cba?default=true');
  useEffect(() => {
    if (workRulesTouched || !cbaDefaultRes.data) return;
    setWorkRules({ ...DEFAULT_RULES, ...cbaToWorkRules(cbaDefaultRes.data.rules) });
    setCbaSourceName(cbaDefaultRes.data.name);
  }, [cbaDefaultRes.data, workRulesTouched]);

  // ── CBA edited on the sibling tab ────────────────────────────────────
  // Now that CBA lives one tab away, a user can change a rule-set and come
  // straight back here. Two cases, deliberately handled differently:
  //
  //   untouched form → refetch and let the pre-fill effect above apply the
  //                    new values silently. Nothing of the user's is lost.
  //   touched form   → refetch but do NOT overwrite. Show a prompt instead.
  //                    Silently replacing hand-entered pay rules mid-plan
  //                    is worse than showing a slightly stale value.
  const [cbaStale, setCbaStale] = useState(false);
  const seenCbaRevision = useRef(cbaRevision);
  useEffect(() => {
    if (cbaRevision === seenCbaRevision.current) return;
    seenCbaRevision.current = cbaRevision;
    cbaDefaultRes.refresh();
    if (workRulesTouched) setCbaStale(true);
    // cbaDefaultRes is a stable hook result; refreshing it here would loop
    // if it were in the dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cbaRevision, workRulesTouched]);

  // PCE equivalent of the CBA handshake above. Only flags a plan that has
  // already been computed — with no plan on screen there is nothing stale,
  // and firing on arrival would nag every operator who opens the tab.
  const [pceStale, setPceStale] = useState(false);
  const seenPceRevision = useRef(pceRevision);
  useEffect(() => {
    if (pceRevision === seenPceRevision.current) return;
    seenPceRevision.current = pceRevision;
    if (plan) setPceStale(true);
  }, [pceRevision, plan]);

  /** Discard local pay-rule edits and take the current CBA default. */
  const reloadCbaDefaults = () => {
    if (!cbaDefaultRes.data) return;
    setWorkRules({ ...DEFAULT_RULES, ...cbaToWorkRules(cbaDefaultRes.data.rules) });
    setCbaSourceName(cbaDefaultRes.data.name);
    setWorkRulesTouched(false);
    setCbaStale(false);
  };

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

  // Auto-draft: when arriving from Demand Forecast with autoCompute=1, run
  // the compute the operator would otherwise have clicked for themselves.
  // Fires once on mount only (autoComputeRan guard) — never re-triggers on
  // a later render, so it can't clobber a plan the operator is editing.
  const autoComputeRan = useRef(false);
  useEffect(() => {
    if (!autoCompute || autoComputeRan.current) return;
    autoComputeRan.current = true;
    compute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCompute]);

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
    setApplying(true); setError(null); setApplyResult(null); setApplyBlocked(null);
    try {
      const res = await fetch(`/api/bus-ops/plan/${plan.id}/apply`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data?.verdict === 'BLOCK') {
        // Not an error — a legitimate PCE refusal. Surface it structurally
        // so the operator can see which trips failed and address them.
        setApplyBlocked(data as PceBlockPayload);
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? 'Apply failed');
      setApplyResult({
        tripsAffected: data.tripsAffected,
        driversAssigned: data.driversAssigned,
        vehiclesAssigned: data.vehiclesAssigned,
        pceGate: (data.pceGate as PceGatePayload | undefined) ?? null,
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
      {/* Compact intro — the Planning Engine shell owns the page title. */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <p className="text-sm text-slate-400 max-w-3xl">
          Runcut trips into driver pieces-of-work, block them onto vehicles, and roster across
          drivers — what-if comparison included.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setIsAiDrawerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-violet-500/40 bg-violet-950/40 px-4 py-2.5 text-sm font-semibold text-violet-200 hover:bg-violet-900/50 shadow-sm transition">
            <Bot className="w-4 h-4 text-violet-400" /> Staff Transport AI Planner
          </button>
          {/* Only rendered when the caller passed a handler, which the shell
              does only if the user holds bus-ops:admin:planning-constraints.
              Showing it otherwise would walk them into a 403. */}
          {onEditPceRules && (
            <button onClick={onEditPceRules}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/10">
              <SlidersHorizontal className="w-4 h-4" /> Planning Constraints
            </button>
          )}
          <button onClick={compute} disabled={computing}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 hover:opacity-90 disabled:opacity-50">
            <Sparkles className="w-4 h-4" /> {computing ? 'Computing…' : 'Compute Plan'}
          </button>
        </div>
      </div>

      {/* Raised only when the CBA tab changed a rule-set AND the operator has
          already hand-edited pay rules. Never auto-applies — see the effect. */}
      {cbaStale && (
        <div className="flex items-start justify-between gap-4 flex-wrap rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-sm text-amber-200">
            CBA rule-sets changed on the <strong>Operational Rules Engine</strong> tab. Your edited
            pay rules were kept — reload to replace them with the new defaults.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={reloadCbaDefaults}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white">
              <RefreshCw className="w-3.5 h-3.5" /> Reload defaults
            </button>
            <button onClick={() => setCbaStale(false)}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/5">
              Keep mine
            </button>
          </div>
        </div>
      )}

      {/* PCE rules moved while this plan was on screen. The plan itself is
          still valid input — it is the verdict that is stale, since apply is
          gated on constraints that have since changed. Recompute rather than
          silently leaving a result that no longer reflects the rules. */}
      {pceStale && (
        <div className="flex items-start justify-between gap-4 flex-wrap rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-sm text-amber-200">
            Planning constraints changed on the <strong>Planning Constraints</strong> tab. This plan
            was evaluated against the previous rules — recompute to re-check it.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => { setPceStale(false); void compute(); }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white">
              <RefreshCw className="w-3.5 h-3.5" /> Recompute
            </button>
            <button onClick={() => setPceStale(false)}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/5">
              Dismiss
            </button>
          </div>
        </div>
      )}

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
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white">Operator Pay Rules</h3>
            {cbaSourceName && !workRulesTouched && (
              <span className="text-[10px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2 py-0.5">
                From CBA: {cbaSourceName}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <NumberField label="Max work hrs/day" value={workRules.maxWorkHoursPerDay} step="0.5"
              onChange={(v) => updateWorkRule({ maxWorkHoursPerDay: v })} />
            <NumberField label="Max spread hrs/day" value={workRules.maxSpreadHoursPerDay} step="0.5"
              onChange={(v) => updateWorkRule({ maxSpreadHoursPerDay: v })} />
            <NumberField label="OT threshold (hrs)" value={workRules.overtimeThresholdHours} step="0.5"
              onChange={(v) => updateWorkRule({ overtimeThresholdHours: v })} />
            <NumberField label="OT rate (×)" value={workRules.overtimeRate} step="0.1"
              onChange={(v) => updateWorkRule({ overtimeRate: v })} />
            <NumberField label="Hourly rate (AED)" value={workRules.hourlyRate} step="1"
              onChange={(v) => updateWorkRule({ hourlyRate: v })} />
            <NumberField label="Min break (min)" value={workRules.minBreakBetweenTripsMins} step="5"
              onChange={(v) => updateWorkRule({ minBreakBetweenTripsMins: v })} />
            <NumberField label="Report (min)" value={workRules.reportTimeMins} step="5"
              onChange={(v) => updateWorkRule({ reportTimeMins: v })} />
            <NumberField label="Wrap (min)" value={workRules.wrapTimeMins} step="5"
              onChange={(v) => updateWorkRule({ wrapTimeMins: v })} />
          </div>
        </div>

        {/* Block options + roster */}
        <div className="rounded-2xl bg-slate-800/50 border border-white/10 p-5">
          <h3 className="text-sm font-bold text-white mb-3">Blocking &amp; Rostering</h3>
          <div className="grid grid-cols-2 gap-2 text-[11px] mb-3">
            <NumberField label="Allowed NRM (min)" value={blockOptions.maxDeadheadMins} step="5"
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
              <div className="mb-4 space-y-3">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-200 inline-flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Applied: {applyResult.tripsAffected} trips affected, {applyResult.driversAssigned} drivers, {applyResult.vehiclesAssigned} vehicles.
                </div>
                {applyResult.pceGate && applyResult.pceGate.verdict !== 'PASS' && applyResult.pceGate.verdict !== 'DISABLED' && (
                  // Only show the panel when there's something to say. A
                  // clean PASS gate would otherwise take space to tell the
                  // operator "no news"; the emerald success line above
                  // already covers that case.
                  <PceVerdictPanel body={applyResult.pceGate} />
                )}
              </div>
            )}
            {applyBlocked && (
              <div className="mb-4">
                <PceVerdictPanel body={applyBlocked} />
                <div className="mt-2 text-xs text-slate-400">
                  Plan not applied — nothing was written to <code className="rounded bg-slate-800 px-1 py-0.5">trip_schedules</code>. Fix the flagged assignments (or the constraint rules) and re-apply.
                </div>
              </div>
            )}

            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              <KpiCard label="Total pay cost" value={fmtMoney(plan.summary.totalPayCost)} sub={`${plan.summary.totalPayHours}h total`} accent="emerald" />
              <KpiCard label="Overtime" value={fmtHours(plan.summary.overtimeHours * 60)} sub="of total hours" accent="amber" />
              <KpiCard label="Total work" value={fmtHours(plan.summary.totalWorkHours * 60)} sub="sum of trip durations" accent="blue" />
              <KpiCard label="NRM" value={fmtHours(plan.summary.totalDeadheadHours * 60)} sub="non-driving paid" accent="slate" />
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

      <StaffTransportAiDrawer
        isOpen={isAiDrawerOpen}
        onClose={() => setIsAiDrawerOpen(false)}
        onPlanApplied={() => {
          plansListRes.refresh();
        }}
      />
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
                <th className="text-right py-2 px-2">NRM</th>
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
    { key: 'totalDeadheadHours', label: 'Total NRM hours',      unit: 'h' },
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
