'use client';
/**
 * Admin > Module Policies — how each module reaches tenants:
 *   Default      on for every tenant, cannot be switched off
 *   Per tenant   switched on or off per tenant (Create Tenant / Manage)
 *   Tier-gated   included for tenants on the chosen plan or higher
 * Rules: src/lib/module-policy-rules.ts. Platform admins only.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { MODULE_GROUPS } from '@/components/ModuleFeaturePicker';
import { invalidate } from '@/hooks/useFetchedData';
import { ACTIVE_TOGGLE } from '@/lib/ui/toggle';
import type { ModuleAvailability, ModulePolicies, ModulePolicy } from '@/lib/module-policy-rules';

interface Plan { code: string; name: string; sortOrder: number }

const OPTIONS: { value: ModuleAvailability; label: string; hint: string }[] = [
  { value: 'ALWAYS_ON', label: 'Default', hint: 'On for every tenant' },
  { value: 'PER_TENANT', label: 'Per tenant', hint: 'Switched on per tenant' },
  { value: 'TIER', label: 'Tier-gated', hint: 'Included from a plan upward' },
];

const same = (a: ModulePolicy, b: ModulePolicy) =>
  a.availability === b.availability && (a.availability !== 'TIER' || a.minPlan === b.minPlan);

export default function ModulePoliciesPage() {
  const [saved, setSaved] = useState<ModulePolicies | null>(null);
  const [draft, setDraft] = useState<ModulePolicies | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/admin/module-policies', { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setMessage({ kind: 'error', text: d?.error ?? `Could not load module policies (HTTP ${r.status})` }); return; }
      setSaved(d.policies); setDraft(d.policies); setPlans(d.plans ?? []);
    })();
  }, []);

  const paidPlans = useMemo(() => plans.filter((p) => p.code !== 'TRIAL'), [plans]);
  const changed = useMemo(
    () => (saved && draft ? Object.keys(draft).filter((k) => !same(draft[k as keyof ModulePolicies], saved[k as keyof ModulePolicies])) : []),
    [saved, draft],
  );

  const setPolicy = (key: string, p: ModulePolicy) => setDraft((d) => (d ? { ...d, [key]: p } : d));

  const save = async () => {
    if (!draft || changed.length === 0) return;
    setBusy(true); setMessage(null);
    try {
      const body = Object.fromEntries(changed.map((k) => [k, draft[k as keyof ModulePolicies]]));
      const r = await fetch('/api/admin/module-policies', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMessage({ kind: 'error', text: d.error ?? `Save failed (HTTP ${r.status})` }); return; }
      setSaved(d.policies); setDraft(d.policies);
      invalidate('/api/admin/module-policies'); // module pickers re-read the policies
      setMessage({ kind: 'ok', text: `Saved ${changed.length} module polic${changed.length === 1 ? 'y' : 'ies'}. Tenants get the change at their next page load.` });
    } catch {
      setMessage({ kind: 'error', text: 'Network error — please try again.' });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mb-1">Module Policies</h1>
          <p className="text-xs text-[var(--text-muted)] max-w-2xl">
            Choose how each module reaches tenants. <strong>Default</strong>: on for every tenant.{' '}
            <strong>Per tenant</strong>: switched on in Create Tenant / Manage.{' '}
            <strong>Tier-gated</strong>: included for tenants on the chosen plan or higher, unavailable below it.
          </p>
        </div>
        <button type="button" onClick={() => void save()} disabled={busy || changed.length === 0}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex-shrink-0">
          {busy ? 'Saving…' : changed.length ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'Saved'}
        </button>
      </div>

      {message && (
        <div role={message.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-xl px-4 py-3 text-sm border ${message.kind === 'error'
            ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'}`}>
          {message.text}
        </div>
      )}

      {!draft ? (
        !message && <div className="text-[var(--text-muted)] text-sm animate-pulse">Loading module policies…</div>
      ) : MODULE_GROUPS.map((group) => (
        <section key={group.spec.label} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--border-subtle)] text-sm font-semibold text-[var(--text-main)]">
            {group.spec.icon} {group.spec.label}
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {group.modules.map((m) => {
              const p = draft[m.key];
              const dirty = saved ? !same(p, saved[m.key]) : false;
              return (
                <div key={m.key} className="px-5 py-3 flex flex-col lg:flex-row lg:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--text-main)]">
                      {m.name}{dirty && <span className="ml-2 text-[10px] text-amber-300">unsaved</span>}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] line-clamp-1">{m.description}</div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="flex gap-1 bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl p-1"
                      role="radiogroup" aria-label={`${m.name} availability`}>
                      {OPTIONS.map((o) => (
                        <button key={o.value} type="button" role="radio" aria-checked={p.availability === o.value} title={o.hint}
                          onClick={() => setPolicy(m.key, o.value === 'TIER'
                            ? { availability: 'TIER', minPlan: p.minPlan ?? paidPlans.find((x) => x.code === 'PROFESSIONAL')?.code ?? paidPlans[0]?.code ?? 'ENTERPRISE' }
                            : { availability: o.value })}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${p.availability === o.value
                            ? ACTIVE_TOGGLE : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                    <select
                      aria-label={`${m.name} minimum plan`}
                      disabled={p.availability !== 'TIER'}
                      value={p.availability === 'TIER' ? p.minPlan : ''}
                      onChange={(e) => setPolicy(m.key, { availability: 'TIER', minPlan: e.target.value })}
                      className="w-40 px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs disabled:opacity-40">
                      {p.availability !== 'TIER' && <option value="">Minimum plan</option>}
                      {paidPlans.map((pl) => <option key={pl.code} value={pl.code}>{pl.name} and higher</option>)}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
