'use client';

/**
 * PceVerdictPanel — shared renderer for a PCE result payload.
 *
 * Currently used by:
 *   - MergeTripsDialog: renders a plan-level result ({verdict, checks[]})
 *   - Bulk Plan page: renders a per-trip apply-gate result (trips[] with
 *     nested checks[] each)
 *
 * The two callers pass different sub-shapes into `body` — the panel
 * dispatches on which of {checks, trips} is present so a single visual
 * language shows up wherever PCE has an opinion.
 *
 * Deliberate: no fetching in here. Callers own the API call and hand
 * this component the JSON. Keeps the panel drop-in-anywhere.
 */

import React from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

export type PceOutcome = 'PASS' | 'WARN' | 'BLOCK' | 'PENALTY';
export type PceVerdict = 'PASS' | 'WARN' | 'BLOCK' | 'DISABLED';

export interface PceCheck {
  code: string;
  outcome: PceOutcome;
  message: string;
  penalty?: number;
}

export interface PceTripResult {
  tripId: string;
  verdict: 'PASS' | 'WARN' | 'BLOCK';
  checks: PceCheck[];
  penalty?: number;
}

export interface PceVerdictBody {
  verdict: PceVerdict;
  totalPenalty?: number;
  /** Plan-level checks (merge dialog). Empty/absent for per-trip mode. */
  checks?: PceCheck[];
  /** Per-trip results (apply-gate). Empty/absent for plan-level mode. */
  trips?: PceTripResult[];
  blockedTripIds?: string[];
  warningTripIds?: string[];
  /** Optional headline overrides. Panel synthesises defaults if absent. */
  title?: string;
  subtitle?: string;
}

// ─── Public component ────────────────────────────────────────────────

export default function PceVerdictPanel({ body }: { body: PceVerdictBody }) {
  if (body.verdict === 'DISABLED') {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-slate-700 bg-slate-800/40 px-4 py-3 text-sm text-slate-300">
        <Info className="w-5 h-5 flex-none opacity-70" />
        <div>
          <div className="font-semibold">Planning Constraints gate disabled</div>
          <div className="mt-0.5 opacity-80">Set <code className="rounded bg-slate-900 px-1 py-0.5 text-xs">PCE_APPLY_GATE_ENABLED</code> back to <code className="rounded bg-slate-900 px-1 py-0.5 text-xs">true</code> to re-enforce.</div>
        </div>
      </div>
    );
  }

  const style = STYLES[body.verdict];
  const Icon = style.icon;

  return (
    <div className="space-y-3">
      <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${style.banner}`}>
        <Icon className="w-5 h-5 flex-none" />
        <div className="flex-1">
          <div className="font-semibold">{body.title ?? defaultTitle(body)}</div>
          <div className="mt-0.5 opacity-90">{body.subtitle ?? defaultSubtitle(body)}</div>
        </div>
      </div>

      {body.checks && body.checks.length > 0 && (
        <CheckList checks={body.checks} />
      )}

      {body.trips && body.trips.length > 0 && (
        <TripList trips={body.trips} />
      )}
    </div>
  );
}

// ─── Sub-renderers ───────────────────────────────────────────────────

function CheckList({ checks }: { checks: PceCheck[] }) {
  return (
    <ul className="space-y-2">
      {checks.map((c, i) => (
        <li key={i} className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm">
          <div className="flex items-start gap-2">
            <OutcomeBadge outcome={c.outcome} penalty={c.penalty} />
            <div>
              <div className="font-medium text-slate-200">{c.code}</div>
              <div className="mt-0.5 text-slate-400">{c.message}</div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TripList({ trips }: { trips: PceTripResult[] }) {
  return (
    <ul className="space-y-2">
      {trips.map((t) => (
        <li key={t.tripId} className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
          <div className="flex items-start gap-2">
            <OutcomeBadge outcome={t.verdict} penalty={t.penalty} />
            <div className="flex-1">
              <div className="font-mono text-xs text-slate-200">{t.tripId}</div>
              {t.checks.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {t.checks.map((c, i) => (
                    <li key={i} className="text-xs">
                      <span className="mr-2 text-slate-400">{c.code}</span>
                      <span className="text-slate-500">{c.message}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-0.5 text-xs text-slate-500">No individual checks fired.</div>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function OutcomeBadge({ outcome, penalty }: { outcome: PceOutcome; penalty?: number }) {
  const cls =
    outcome === 'BLOCK' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
    : outcome === 'WARN' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    : outcome === 'PENALTY' ? 'bg-violet-500/20 text-violet-300 border-violet-500/40'
    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>
      {outcome}
      {outcome === 'PENALTY' && penalty != null && ` · ${penalty}`}
    </span>
  );
}

// ─── Defaults ────────────────────────────────────────────────────────

const STYLES: Record<Exclude<PceVerdict, 'DISABLED'>, {
  banner: string;
  icon: React.ComponentType<{ className?: string }>;
}> = {
  PASS: { banner: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200', icon: CheckCircle2 },
  WARN: { banner: 'border-amber-500/40 bg-amber-500/10 text-amber-200', icon: AlertTriangle },
  BLOCK: { banner: 'border-rose-500/40 bg-rose-500/10 text-rose-200', icon: XCircle },
};

function defaultTitle(body: PceVerdictBody): string {
  if (body.verdict === 'BLOCK') return 'Blocked by Planning Constraints';
  if (body.verdict === 'WARN') return 'Passed with warnings';
  return 'Passed all constraints';
}

function defaultSubtitle(body: PceVerdictBody): string {
  const parts: string[] = [];
  if (body.blockedTripIds && body.blockedTripIds.length > 0) {
    parts.push(`${body.blockedTripIds.length} trip${body.blockedTripIds.length === 1 ? '' : 's'} blocked`);
  }
  if (body.warningTripIds && body.warningTripIds.length > 0) {
    parts.push(`${body.warningTripIds.length} with warnings`);
  }
  if (body.totalPenalty && body.totalPenalty > 0) {
    parts.push(`penalty ${body.totalPenalty}`);
  }
  return parts.length > 0
    ? parts.join(' · ')
    : body.verdict === 'BLOCK'
      ? 'Review the checks below.'
      : 'No issues.';
}
