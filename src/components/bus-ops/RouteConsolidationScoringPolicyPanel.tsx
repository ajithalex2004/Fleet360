'use client';

/**
 * Route Consolidation — Scoring Policy admin panel.
 *
 * Configures the tenant's weights/reference values for the Stage 4 scorer
 * (rankingCost = impactScore - benefitScore). Stage 1 only: this panel
 * reads/writes RouteConsolidationScoringPolicy but the scorer itself
 * doesn't consume it yet — that wiring lands with Stage 3/4. Saving here
 * activates a new policy version (old one is effective-dated out, not
 * overwritten) that later stages will read.
 *
 * Editing is restricted to users with bus-ops:edit — view-only otherwise,
 * enforced both here (disabled inputs) and server-side (403 on POST).
 * Raw normalization references live under a collapsed "Advanced" section
 * since they're calibration parameters, not something a normal operator
 * should tune without understanding the scoring math.
 */

import { useEffect, useState } from 'react';
import { Sliders, Save, RefreshCw, Info, Lock } from 'lucide-react';
import { usePermissions } from '@/contexts/PermissionContext';

interface ScoringPolicyReferences {
  distanceReferenceKm: number;
  timeReferenceMinutes: number;
  passengerImpactReferenceMinutes: number;
  detourReferenceMinutes: number;
  pcePenaltyReference: number;
}
interface ScoringPolicyBenefitWeights {
  distance: number;
  time: number;
  resourceRelease: number;
}
interface ScoringPolicyImpactWeights {
  passengerImpact: number;
  detour: number;
  pcePenalty: number;
}
interface ScoringPolicy {
  id: string | null;
  name: string;
  calculationVersion: string;
  references: ScoringPolicyReferences;
  benefitWeights: ScoringPolicyBenefitWeights;
  impactWeights: ScoringPolicyImpactWeights;
}

const WEIGHT_SUM_TOLERANCE = 0.001;

export default function RouteConsolidationScoringPolicyPanel() {
  const { canEdit } = usePermissions();
  const editable = canEdit('bus-ops', 'route-consolidation-scoring-policy');

  const [policy, setPolicy] = useState<ScoringPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/bus-ops/route-consolidation/scoring-policy', { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json() as ScoringPolicy;
        if (!cancelled) setPolicy(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load scoring policy');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const benefitSum = policy
    ? policy.benefitWeights.distance + policy.benefitWeights.time + policy.benefitWeights.resourceRelease
    : 0;
  const impactSum = policy
    ? policy.impactWeights.passengerImpact + policy.impactWeights.detour + policy.impactWeights.pcePenalty
    : 0;
  const benefitSumOk = Math.abs(benefitSum - 1) <= WEIGHT_SUM_TOLERANCE;
  const impactSumOk = Math.abs(impactSum - 1) <= WEIGHT_SUM_TOLERANCE;

  const save = async () => {
    if (!policy) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      const res = await fetch('/api/bus-ops/route-consolidation/scoring-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: policy.name,
          references: policy.references,
          benefitWeights: policy.benefitWeights,
          impactWeights: policy.impactWeights,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? await res.text());
      const data = await res.json() as ScoringPolicy;
      setPolicy(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save scoring policy');
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="group rounded-lg border border-slate-800 bg-slate-900/60">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs uppercase tracking-wider text-slate-400 hover:text-slate-200 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5"><Sliders className="w-3.5 h-3.5" /> Scoring policy</span>
        <span className="text-[10px] font-normal opacity-60 inline-flex items-center gap-1">
          {!editable && <Lock className="w-3 h-3" />}
          preview — not yet used by Analyse
        </span>
      </summary>

      <div className="border-t border-slate-800 p-3 space-y-3">
        {loading && <p className="text-xs text-slate-500">Loading…</p>}
        {error && <p className="text-xs text-rose-400">{error}</p>}

        {policy && !loading && (
          <>
            <div className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-200">
              <Info className="w-3.5 h-3.5 flex-none mt-0.5" />
              <span>
                Controls how candidates are <em>ranked</em>, not whether they&apos;re eligible. Weights within each
                group must sum to 1.0. Version <code className="text-sky-100">{policy.calculationVersion}</code>.
              </span>
            </div>

            {!editable && (
              <p className="text-[11px] text-amber-400 inline-flex items-center gap-1">
                <Lock className="w-3 h-3" /> View-only — scoring weights change what gets recommended, so editing is restricted.
              </p>
            )}

            <Field label="Policy name">
              <input value={policy.name} disabled={!editable}
                onChange={(e) => setPolicy({ ...policy, name: e.target.value })}
                className={inputCls} />
            </Field>

            <div className="border-t border-slate-700 my-3 pt-3">
              <p className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                Benefit weights <span className={benefitSumOk ? 'text-emerald-400' : 'text-rose-400'}>({benefitSum.toFixed(2)} / 1.00)</span>
              </p>
              <WeightField label="Distance saving importance" value={policy.benefitWeights.distance} editable={editable}
                onChange={(v) => setPolicy({ ...policy, benefitWeights: { ...policy.benefitWeights, distance: v } })} />
              <WeightField label="Time saving importance" value={policy.benefitWeights.time} editable={editable}
                onChange={(v) => setPolicy({ ...policy, benefitWeights: { ...policy.benefitWeights, time: v } })} />
              <WeightField label="Resource release importance" value={policy.benefitWeights.resourceRelease} editable={editable}
                onChange={(v) => setPolicy({ ...policy, benefitWeights: { ...policy.benefitWeights, resourceRelease: v } })} />
            </div>

            <div className="border-t border-slate-700 my-3 pt-3">
              <p className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                Impact weights <span className={impactSumOk ? 'text-emerald-400' : 'text-rose-400'}>({impactSum.toFixed(2)} / 1.00)</span>
              </p>
              <WeightField label="Passenger impact importance" value={policy.impactWeights.passengerImpact} editable={editable}
                onChange={(v) => setPolicy({ ...policy, impactWeights: { ...policy.impactWeights, passengerImpact: v } })} />
              <WeightField label="Detour importance" value={policy.impactWeights.detour} editable={editable}
                onChange={(v) => setPolicy({ ...policy, impactWeights: { ...policy.impactWeights, detour: v } })} />
              <WeightField label="PCE penalty importance" value={policy.impactWeights.pcePenalty} editable={editable}
                onChange={(v) => setPolicy({ ...policy, impactWeights: { ...policy.impactWeights, pcePenalty: v } })} />
            </div>

            <details className="rounded-lg border border-slate-800 bg-slate-950/40">
              <summary className="cursor-pointer list-none px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 hover:text-slate-300">
                Advanced scoring settings — normalization references
              </summary>
              <div className="border-t border-slate-800 p-3 space-y-3">
                <p className="text-[11px] text-slate-500">
                  Calibration parameters — the value at which a saving/impact counts as &quot;maximum&quot; (normalized to 1.0). Misconfiguring these skews every ranking.
                </p>
                <Field label="Distance reference (km/day)"><input type="number" step="1" disabled={!editable}
                  value={policy.references.distanceReferenceKm}
                  onChange={(e) => setPolicy({ ...policy, references: { ...policy.references, distanceReferenceKm: Number(e.target.value) } })}
                  className={inputCls} /></Field>
                <Field label="Time reference (min/day)"><input type="number" step="1" disabled={!editable}
                  value={policy.references.timeReferenceMinutes}
                  onChange={(e) => setPolicy({ ...policy, references: { ...policy.references, timeReferenceMinutes: Number(e.target.value) } })}
                  className={inputCls} /></Field>
                <Field label="Passenger impact reference (passenger-min)"><input type="number" step="1" disabled={!editable}
                  value={policy.references.passengerImpactReferenceMinutes}
                  onChange={(e) => setPolicy({ ...policy, references: { ...policy.references, passengerImpactReferenceMinutes: Number(e.target.value) } })}
                  className={inputCls} /></Field>
                <Field label="Detour reference (min)"><input type="number" step="1" disabled={!editable}
                  value={policy.references.detourReferenceMinutes}
                  onChange={(e) => setPolicy({ ...policy, references: { ...policy.references, detourReferenceMinutes: Number(e.target.value) } })}
                  className={inputCls} /></Field>
                <Field label="PCE penalty reference"><input type="number" step="1" disabled={!editable}
                  value={policy.references.pcePenaltyReference}
                  onChange={(e) => setPolicy({ ...policy, references: { ...policy.references, pcePenaltyReference: Number(e.target.value) } })}
                  className={inputCls} /></Field>
              </div>
            </details>

            {editable && (
              <button onClick={save} disabled={saving || !benefitSumOk || !impactSumOk}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-violet-600 bg-violet-600/20 px-4 py-2 text-sm font-medium text-violet-200 hover:bg-violet-600/30 disabled:opacity-40">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? 'Saving…' : saved ? 'Saved' : 'Save policy'}
              </button>
            )}
            {(!benefitSumOk || !impactSumOk) && editable && (
              <p className="text-[11px] text-rose-400">Both weight groups must sum to 1.0 before saving.</p>
            )}
          </>
        )}
      </div>
    </details>
  );
}

// ─── Small building blocks (local copies — page.tsx keeps its own) ──────────

const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-50 disabled:cursor-not-allowed';

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

function WeightField({ label, value, editable, onChange }: {
  label: string; value: number; editable: boolean; onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <input type="number" step="0.05" min="0" max="1" disabled={!editable}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={inputCls} />
    </Field>
  );
}
