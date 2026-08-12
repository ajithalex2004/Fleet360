'use client';

import { useEffect, useState, useCallback } from 'react';

/**
 * Platform Plans — admin management.
 *
 * Lets a system-wide SUPER_ADMIN view, create, edit, and soft-delete
 * the plan catalog. The DB table is `platform_plans`; the read path
 * for the rest of the app is src/lib/plans.ts.
 *
 * Auth: middleware already requires a session. The role check is
 * enforced server-side by /api/admin/platform/plans (returns 403
 * if the caller is not a system-wide SUPER_ADMIN).
 */

interface PlanCatalogEntry {
  code:        string;
  name:        string;
  priceLabel:  string;
  description: string;
  highlight:   boolean;
  sortOrder:   number;
  isActive:    boolean;
  limits: {
    maxUsers:              number;
    maxVehicles:           number;
    maxBookingsPerMonth:   number;
    premiumModules:        string[];
    sso:                   boolean;
    apiKeys:               boolean;
    branding:              boolean;
  };
}

interface EditState {
  // null = not editing
  code: string | null;
  // The current edit buffer
  form: PlanCatalogEntry;
}

const EMPTY_LIMITS = {
  maxUsers: 5, maxVehicles: 10, maxBookingsPerMonth: 200,
  premiumModules: [] as string[], sso: false, apiKeys: false, branding: false,
};

const EMPTY_FORM: PlanCatalogEntry = {
  code: '', name: '', priceLabel: '', description: '', highlight: false, sortOrder: 0, isActive: true,
  limits: { ...EMPTY_LIMITS },
};

export default function PlatformPlansPage() {
  const [plans, setPlans] = useState<PlanCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>({ code: null, form: EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/admin/platform/plans');
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? `Failed to load (${r.status})`);
        return;
      }
      const data = await r.json() as { plans: PlanCatalogEntry[] };
      setPlans(data.plans);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const startEdit = (p: PlanCatalogEntry) => {
    setEdit({ code: p.code, form: JSON.parse(JSON.stringify(p)) as PlanCatalogEntry });
    setShowAdd(false);
  };

  const cancelEdit = () => setEdit({ code: null, form: EMPTY_FORM });

  const saveEdit = async () => {
    if (!edit.code) return;
    setSaving(true); setError(null);
    try {
      const r = await fetch(`/api/admin/platform/plans/${edit.code}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: edit.form.name,
          priceLabel: edit.form.priceLabel,
          description: edit.form.description,
          highlight: edit.form.highlight,
          sortOrder: edit.form.sortOrder,
          maxUsers: edit.form.limits.maxUsers,
          maxVehicles: edit.form.limits.maxVehicles,
          maxBookingsPerMonth: edit.form.limits.maxBookingsPerMonth,
          premiumModules: edit.form.limits.premiumModules,
          ssoEnabled: edit.form.limits.sso,
          apiKeysEnabled: edit.form.limits.apiKeys,
          brandingEnabled: edit.form.limits.branding,
          isActive: edit.form.isActive,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? `Save failed (${r.status})`);
        return;
      }
      cancelEdit();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (p: PlanCatalogEntry) => {
    const newState = !p.isActive;
    if (!confirm(`${newState ? 'Activate' : 'Retire'} plan "${p.code}"? ${newState ? '' : 'New tenants will not see this plan.'}`)) return;
    setError(null);
    try {
      const r = await fetch(`/api/admin/platform/plans/${p.code}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: newState }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? `Update failed (${r.status})`);
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    }
  };

  const createPlan = async (form: PlanCatalogEntry) => {
    setSaving(true); setError(null);
    try {
      const r = await fetch('/api/admin/platform/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: form.code,
          name: form.name,
          priceLabel: form.priceLabel,
          description: form.description,
          highlight: form.highlight,
          sortOrder: form.sortOrder,
          maxUsers: form.limits.maxUsers,
          maxVehicles: form.limits.maxVehicles,
          maxBookingsPerMonth: form.limits.maxBookingsPerMonth,
          premiumModules: form.limits.premiumModules,
          ssoEnabled: form.limits.sso,
          apiKeysEnabled: form.limits.apiKeys,
          brandingEnabled: form.limits.branding,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? `Create failed (${r.status})`);
        return false;
      }
      setShowAdd(false);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Platform Plans</h1>
          <p className="text-slate-400 mt-1 text-sm">
            Plan tiers shown on the onboarding page and used to gate quotas + features.
            Changes are live immediately (no redeploy).
          </p>
        </div>
        <button
          onClick={() => { setShowAdd(true); cancelEdit(); }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg"
        >
          + New Plan
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-950/40 border border-red-500/30 text-red-300 text-sm">
          {error}
        </div>
      )}

      {showAdd && (
        <PlanForm
          title="Create plan"
          form={EMPTY_FORM}
          isNew
          saving={saving}
          onChange={f => setEdit({ code: null, form: f })}
          onCancel={() => setShowAdd(false)}
          onSubmit={() => createPlan(edit.form)}
        />
      )}

      {loading ? (
        <div className="text-slate-400 text-sm">Loading…</div>
      ) : (
        <div className="space-y-2">
          {plans.length === 0 && (
            <div className="text-slate-400 text-sm">No plans yet. Click "+ New Plan" to create one.</div>
          )}
          {plans.map(p => (
            <div key={p.code}>
              {edit.code === p.code ? (
                <PlanForm
                  title={`Edit ${p.code}`}
                  form={edit.form}
                  isNew={false}
                  saving={saving}
                  onChange={f => setEdit({ code: p.code, form: f })}
                  onCancel={cancelEdit}
                  onSubmit={saveEdit}
                />
              ) : (
                <PlanRow p={p} onEdit={startEdit} onToggleActive={toggleActive} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function PlanRow({
  p, onEdit, onToggleActive,
}: {
  p: PlanCatalogEntry;
  onEdit: (p: PlanCatalogEntry) => void;
  onToggleActive: (p: PlanCatalogEntry) => void;
}) {
  const limits = p.limits;
  return (
    <div className={`p-4 rounded-lg border ${p.isActive ? 'border-white/10 bg-slate-800' : 'border-white/5 bg-slate-900/50 opacity-60'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-200">{p.code}</span>
            <span className="font-semibold text-white">{p.name}</span>
            <span className="text-blue-400 text-sm">{p.priceLabel}</span>
            {p.highlight && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-600 text-white">Popular</span>
            )}
            {!p.isActive && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-600 text-slate-300">Retired</span>
            )}
            <span className="text-xs text-slate-500">sort: {p.sortOrder}</span>
          </div>
          <div className="text-slate-400 text-sm mt-1">{p.description}</div>
          <div className="flex flex-wrap gap-2 mt-2 text-xs">
            <Tag>users ≤ {fmtN(limits.maxUsers)}</Tag>
            <Tag>vehicles ≤ {fmtN(limits.maxVehicles)}</Tag>
            <Tag>bookings/mo ≤ {fmtN(limits.maxBookingsPerMonth)}</Tag>
            {limits.sso       && <Tag accent>SSO</Tag>}
            {limits.apiKeys   && <Tag accent>API keys</Tag>}
            {limits.branding  && <Tag accent>Branding</Tag>}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => onEdit(p)}
            className="px-3 py-1.5 text-sm rounded border border-white/10 hover:bg-white/5 text-slate-200"
          >
            Edit
          </button>
          <button
            onClick={() => onToggleActive(p)}
            className={`px-3 py-1.5 text-sm rounded border ${
              p.isActive
                ? 'border-amber-500/30 text-amber-300 hover:bg-amber-500/10'
                : 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10'
            }`}
          >
            {p.isActive ? 'Retire' : 'Activate'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Tag({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span className={`px-2 py-0.5 rounded border ${
      accent ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-slate-700/40 text-slate-300'
    }`}>
      {children}
    </span>
  );
}

function fmtN(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function Field({
  label, children, hint,
}: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-400 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full px-3 py-2 rounded border border-white/10 bg-slate-900 text-white text-sm focus:outline-none focus:border-blue-500';

function PlanForm({
  title, form, isNew, saving, onChange, onCancel, onSubmit,
}: {
  title: string;
  form: PlanCatalogEntry;
  isNew: boolean;
  saving: boolean;
  onChange: (f: PlanCatalogEntry) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const set = <K extends keyof PlanCatalogEntry>(k: K, v: PlanCatalogEntry[K]) => onChange({ ...form, [k]: v });
  const setL = <K extends keyof PlanCatalogEntry['limits']>(k: K, v: PlanCatalogEntry['limits'][K]) =>
    onChange({ ...form, limits: { ...form.limits, [k]: v } });

  return (
    <div className="p-4 rounded-lg border border-blue-500/30 bg-blue-950/20 mb-3">
      <h3 className="text-white font-semibold mb-4">{title}</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Code" hint="UPPERCASE_WITH_UNDERSCORES. Permanent — never change after launch.">
          <input
            className={inputCls + (isNew ? '' : ' opacity-60 cursor-not-allowed')}
            value={form.code}
            disabled={!isNew}
            onChange={e => set('code', e.target.value.toUpperCase())}
            placeholder="e.g. BUSINESS"
          />
        </Field>
        <Field label="Name">
          <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Business" />
        </Field>
        <Field label="Price label" hint="Free-form display string. e.g. 'AED 499/mo' or 'Contact us'">
          <input className={inputCls} value={form.priceLabel} onChange={e => set('priceLabel', e.target.value)} />
        </Field>
        <Field label="Description" hint="One-liner shown on the pricing card">
          <input className={inputCls} value={form.description} onChange={e => set('description', e.target.value)} />
        </Field>
        <Field label="Sort order" hint="Lower = shown first. Also used for plan-tier rank.">
          <input
            className={inputCls}
            type="number"
            value={form.sortOrder}
            onChange={e => set('sortOrder', parseInt(e.target.value || '0', 10))}
          />
        </Field>
        <div className="flex items-end gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.highlight} onChange={e => set('highlight', e.target.checked)} />
            Show "Popular" badge
          </label>
          {!isNew && (
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} />
              Active
            </label>
          )}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-white/5">
        <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Quotas</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Max users">
            <input className={inputCls} type="number" min={1} value={form.limits.maxUsers}
              onChange={e => setL('maxUsers', parseInt(e.target.value || '0', 10))} />
          </Field>
          <Field label="Max vehicles">
            <input className={inputCls} type="number" min={1} value={form.limits.maxVehicles}
              onChange={e => setL('maxVehicles', parseInt(e.target.value || '0', 10))} />
          </Field>
          <Field label="Max bookings / month">
            <input className={inputCls} type="number" min={1} value={form.limits.maxBookingsPerMonth}
              onChange={e => setL('maxBookingsPerMonth', parseInt(e.target.value || '0', 10))} />
          </Field>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-white/5">
        <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Feature gates</div>
        <div className="flex flex-wrap gap-4 text-sm text-slate-300">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.limits.sso}      onChange={e => setL('sso',      e.target.checked)} /> SSO
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.limits.apiKeys}  onChange={e => setL('apiKeys',  e.target.checked)} /> API keys
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.limits.branding} onChange={e => setL('branding', e.target.checked)} /> Branding / white-label
          </label>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded border border-white/10 text-slate-300 hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={saving}
          className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : isNew ? 'Create plan' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
