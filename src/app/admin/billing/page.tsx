'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

// API returns snake_case — match exactly
interface BillingOverview {
  mrr: number;
  arr: number;
  active_subscriptions: number;
  status_breakdown: Record<string, number>;
}

interface ModuleRevenue {
  module_code: string;
  active_count: number;
  trial_count: number;
  suspended_count: number;
  cancelled_count: number;
  mrr_contribution: number;
}

interface UpcomingRenewal {
  id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_code?: string;
  module_code: string;
  plan_tier: string;
  base_price: number;
  next_billing_date: string;
}

interface BillingRun {
  id: string;
  run_date: string;
  status: string;
  total_tenants: number;
  invoices_created: number;
  total_amount: number;
}

interface OutstandingInvoices {
  count: number;
  total_outstanding: number;
  total_overdue: number;
  invoices: unknown[];
}

interface BillingDashboard {
  overview: BillingOverview;
  by_module: ModuleRevenue[];
  upcoming_renewals: UpcomingRenewal[];
  outstanding_invoices: OutstandingInvoices;
  recent_billing_runs: BillingRun[];
  canonical_subscriptions?: Array<{
    id: string;
    tenant_id: string;
    tenant_name?: string;
    tenant_code?: string | null;
    module_code: string;
    plan_tier: string;
    billing_cycle: string;
    status: string;
    base_price: number;
    currency: string;
    next_billing_date: string | null;
  }>;
  reconciliation?: {
    status: 'OK' | 'DRIFT';
    issues: string[];
    source_of_truth: string;
  };
}

interface Subscription {
  id: string;
  tenant_id: string;
  tenant_name?: string;
  tenant_code?: string;
  tenant_email?: string;
  module_code: string;
  plan_tier: string;
  base_price: number;
  max_vehicles: number;
  max_users: number;
  status: string;
  next_billing_date: string;
  billing_cycle: string;
}

interface PendingSubscriptionAction {
  subscription: Subscription;
  action: 'SUSPEND' | 'ACTIVATE' | 'CANCEL';
}

interface PreviewInvoice {
  subscription_id: string;
  tenant_id: string;
  tenant_name: string;
  module_code: string;
  invoice_number: string;
  line_items: { description: string; amount: number }[];
  subtotal: number;
  vat_amount: number;
  total_amount: number;
  currency: string;
  billing_cycle: string;
  next_billing_date: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MODULE_ICONS: Record<string, string> = {
  RAC:             '🚗',
  SCHOOL_BUS:      '🏫',
  LOGISTICS:       '🚛',
  LEASING:         '🔑',
  STAFF_TRANSPORT: '🚌',
  AMBULANCE:       '🚑',
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE:    'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  SUSPENDED: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  CANCELLED: 'bg-red-500/20 text-red-400 border-red-500/30',
  TRIAL:     'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

const ALL_MODULES = ['RAC', 'SCHOOL_BUS', 'LOGISTICS', 'LEASING', 'STAFF_TRANSPORT', 'AMBULANCE'];

function fmt(n: number) {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', minimumFractionDigits: 0 }).format(n);
}
function fmtDate(d: string) {
  return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

function canonicalSubscriptionsToRows(dashboard: BillingDashboard | null): Subscription[] {
  return (dashboard?.canonical_subscriptions ?? []).map(sub => ({
    id: sub.id,
    tenant_id: sub.tenant_id,
    tenant_name: sub.tenant_name,
    tenant_code: sub.tenant_code ?? undefined,
    module_code: sub.module_code,
    plan_tier: sub.plan_tier,
    base_price: Number(sub.base_price ?? 0),
    max_vehicles: 0,
    max_users: 0,
    status: sub.status,
    next_billing_date: sub.next_billing_date ?? '',
    billing_cycle: sub.billing_cycle,
  }));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, red }: { label: string; value: string; sub?: string; red?: boolean }) {
  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 flex flex-col gap-1">
      <p className="text-xs text-slate-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold ${red ? 'text-red-400' : 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? 'bg-slate-700 text-slate-300 border-slate-600';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {status}
    </span>
  );
}

// ── Tenant Autocomplete ───────────────────────────────────────────────────────

interface TenantOption {
  id: string;
  name: string;
  code: string | null;
  plan: string;
  contactEmail: string | null;
}

function TenantAutocomplete({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string, name: string) => void;
}) {
  const [query, setQuery]       = useState('');
  const [options, setOptions]   = useState<TenantOption[]>([]);
  const [loading, setLoading]   = useState(false);
  const [open, setOpen]         = useState(false);
  const [selected, setSelected] = useState<TenantOption | null>(null);
  const timerRef                = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef                = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!value) { setSelected(null); setQuery(''); } }, [value]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query) { setOptions([]); setOpen(false); return; }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res  = await fetch(`/api/admin/tenants?search=${encodeURIComponent(query)}&limit=10`);
        const data = await res.json();
        const list: TenantOption[] = Array.isArray(data) ? data : [];
        setOptions(list);
        setOpen(list.length > 0 || query.length >= 1);
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query]);

  function select(t: TenantOption) {
    setSelected(t);
    onChange(t.id, t.name);
    setOpen(false);
    setQuery('');
  }

  function clear() {
    setSelected(null);
    onChange('', '');
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const inputBase = 'w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500';

  return (
    <div className="relative">
      {selected ? (
        <div className="flex items-center gap-3 bg-slate-800 border border-emerald-500/50 rounded-lg px-3 py-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {selected.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{selected.name}</p>
            <p className="text-xs text-slate-400 truncate font-mono">
              {selected.code ? `${selected.code} · ` : ''}{selected.id.slice(0, 16)}…
            </p>
          </div>
          <button type="button" onClick={clear} title="Change tenant"
            className="text-slate-400 hover:text-white text-lg leading-none flex-shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 transition-colors">
            &times;
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            ref={inputRef}
            className={inputBase}
            placeholder="Type tenant name, code or ID…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => options.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 180)}
            autoComplete="off"
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-blue-400 rounded-full animate-spin" />
            </div>
          )}
        </div>
      )}

      {open && !selected && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-slate-800 border border-white/10 rounded-xl shadow-2xl overflow-hidden">
          {options.length > 0 ? options.map((t, i) => (
            <button key={t.id} type="button" onMouseDown={() => select(t)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-700 transition-colors text-left ${i > 0 ? 'border-t border-white/5' : ''}`}>
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {t.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{t.name}</p>
                <p className="text-xs text-slate-400 truncate">
                  {t.code ? <span className="font-mono bg-slate-700/60 px-1 rounded mr-1">{t.code}</span> : null}
                  {t.id.slice(0, 12)}…
                  {t.contactEmail ? ` · ${t.contactEmail}` : ''}
                </p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full border flex-shrink-0 ${
                t.plan === 'ENTERPRISE'    ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' :
                t.plan === 'PROFESSIONAL' ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' :
                                            'bg-slate-700 text-slate-400 border-slate-600'
              }`}>{t.plan}</span>
            </button>
          )) : !loading && (
            <div className="px-4 py-3 text-xs text-slate-400 text-center">
              No tenants found for &ldquo;{query}&rdquo;
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Add Subscription Modal ────────────────────────────────────────────────────

function AddSubscriptionModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState({
    tenantId:    '',
    tenantName:  '',
    module:      'RAC',
    planTier:    'STANDARD',
    basePrice:   '',
    maxVehicles: '',
    maxUsers:    '',
    maxStudents: '',
    setupFee:    '',
    billingCycle: 'MONTHLY',
    notes:       '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.tenantId) { setError('Please select a tenant first.'); return; }
    setError('');
    setSaving(true);
    await onSave({
      tenantId:    form.tenantId,
      moduleCode:  form.module,
      planTier:    form.planTier,
      basePrice:   parseFloat(form.basePrice)  || 0,
      maxVehicles: parseInt(form.maxVehicles)  || 50,
      maxUsers:    parseInt(form.maxUsers)     || 5,
      maxStudents: parseInt(form.maxStudents)  || 0,
      setupFee:    parseFloat(form.setupFee)   || 0,
      billingCycle: form.billingCycle,
      status:      'ACTIVE',
      notes:       form.notes || null,
    });
    setSaving(false);
  }

  const inputCls = 'w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500';
  const labelCls = 'block text-xs text-slate-400 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/10 flex-shrink-0">
          <div>
            <h3 className="text-lg font-semibold text-white">Add Subscription</h3>
            <p className="text-xs text-slate-400 mt-0.5">Assign a module plan to a tenant</p>
          </div>
          <button onClick={onClose}
            className="text-slate-400 hover:text-white text-xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
            &times;
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Tenant picker */}
          <div>
            <label className={labelCls}>
              Tenant <span className="text-red-400">*</span>
            </label>
            <TenantAutocomplete
              value={form.tenantId}
              onChange={(id, name) => {
                setForm(p => ({ ...p, tenantId: id, tenantName: name }));
                if (id) setError('');
              }}
            />
            {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
          </div>

          {/* Module + Plan tier */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Module <span className="text-red-400">*</span></label>
              <select className={inputCls} value={form.module} onChange={e => setForm(p => ({ ...p, module: e.target.value }))}>
                {ALL_MODULES.map(m => (
                  <option key={m} value={m}>{MODULE_ICONS[m]} {m.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Plan Tier</label>
              <select className={inputCls} value={form.planTier} onChange={e => setForm(p => ({ ...p, planTier: e.target.value }))}>
                {['STARTER', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Price + Setup fee */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Base Price (AED/cycle) <span className="text-red-400">*</span></label>
              <input className={inputCls} type="number" min="0" step="0.01" required
                value={form.basePrice} onChange={e => setForm(p => ({ ...p, basePrice: e.target.value }))}
                placeholder="e.g. 2500" />
            </div>
            <div>
              <label className={labelCls}>Setup Fee (AED)</label>
              <input className={inputCls} type="number" min="0" step="0.01"
                value={form.setupFee} onChange={e => setForm(p => ({ ...p, setupFee: e.target.value }))}
                placeholder="0" />
            </div>
          </div>

          {/* Billing cycle — pill toggles */}
          <div>
            <label className={labelCls}>Billing Cycle</label>
            <div className="flex gap-2">
              {['MONTHLY', 'QUARTERLY', 'ANNUAL'].map(c => (
                <button key={c} type="button"
                  onClick={() => setForm(p => ({ ...p, billingCycle: c }))}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                    form.billingCycle === c
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-slate-800 border-white/10 text-slate-400 hover:text-white hover:bg-slate-700'
                  }`}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Usage limits */}
          <div>
            <label className={labelCls}>Usage Limits <span className="text-slate-600">(overage billed automatically)</span></label>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-slate-500 mb-1">Max Vehicles</p>
                <input className={inputCls} type="number" min="0"
                  value={form.maxVehicles} onChange={e => setForm(p => ({ ...p, maxVehicles: e.target.value }))} placeholder="50" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Max Users</p>
                <input className={inputCls} type="number" min="0"
                  value={form.maxUsers} onChange={e => setForm(p => ({ ...p, maxUsers: e.target.value }))} placeholder="5" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Max Students</p>
                <input className={inputCls} type="number" min="0"
                  value={form.maxStudents} onChange={e => setForm(p => ({ ...p, maxStudents: e.target.value }))} placeholder="0" />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className={labelCls}>Notes (optional)</label>
            <textarea className={`${inputCls} resize-none`} rows={2}
              value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              placeholder="Internal notes about this subscription…" />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 flex-shrink-0">
          <div className="text-xs text-slate-500">
            {form.tenantName
              ? <span className="text-emerald-400 flex items-center gap-1"><span>✓</span> {form.tenantName}</span>
              : <span>No tenant selected</span>
            }
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg border border-white/10 text-sm text-slate-300 hover:bg-slate-800 transition-colors">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit as unknown as React.MouseEventHandler}
              disabled={saving || !form.tenantId || !form.basePrice}
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving ? (
                <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
              ) : 'Create Subscription'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Preview Run Modal ─────────────────────────────────────────────────────────

function PreviewRunModal({
  previews,
  onClose,
  onConfirm,
  confirming,
}: {
  previews: PreviewInvoice[];
  onClose: () => void;
  onConfirm: () => void;
  confirming: boolean;
}) {
  const total = previews.reduce((s, p) => s + (p.total_amount ?? 0), 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Billing Run Preview</h3>
            <p className="text-xs text-slate-400">{previews.length} invoice(s) would be generated — total {fmt(total)}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {previews.length === 0 && (
            <p className="text-slate-400 text-sm text-center py-8">No invoices to generate at this time.</p>
          )}
          {previews.map((inv, i) => (
            <div key={i} className="bg-slate-800/60 border border-white/10 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-white font-medium text-sm">{inv.tenant_name}</span>
                  <span className="ml-2 text-xs text-slate-400">{inv.tenant_id}</span>
                </div>
                <span className="text-sm font-semibold text-emerald-400">{fmt(inv.total_amount)}</span>
              </div>
              <div className="text-xs text-slate-400 mb-2">
                {MODULE_ICONS[inv.module_code] ?? ''} {inv.module_code} — {inv.invoice_number}
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {(inv.line_items ?? []).map((li, j) => (
                    <tr key={j} className="border-t border-white/5">
                      <td className="py-1 text-slate-300">{li.description}</td>
                      <td className="py-1 text-right text-slate-300">{fmt(li.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t border-white/10 mt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-white/10 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={confirming || previews.length === 0}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50"
          >
            {confirming ? 'Running…' : `Confirm & Run (${previews.length} invoices)`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function SubscriptionActionModal({
  pending,
  onClose,
  onConfirm,
  confirming,
}: {
  pending: PendingSubscriptionAction;
  onClose: () => void;
  onConfirm: () => void;
  confirming: boolean;
}) {
  const { subscription, action } = pending;
  const label = action === 'CANCEL' ? 'Cancel subscription' : action === 'SUSPEND' ? 'Suspend subscription' : 'Activate subscription';
  const tenantLabel = subscription.tenant_name ?? subscription.tenant_code ?? `${subscription.tenant_id.slice(0, 8)}...`;
  const tone = action === 'CANCEL'
    ? 'border-red-500/30 bg-red-500/10 text-red-200'
    : action === 'SUSPEND'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
        <div className="px-6 py-5 border-b border-white/10">
          <h3 className="text-lg font-semibold text-white">{label}</h3>
          <p className="text-sm text-slate-400 mt-1">Review this billing change before it enters the approval workflow.</p>
        </div>
        <div className="p-6 space-y-4">
          <div className={`rounded-xl border px-4 py-3 text-sm ${tone}`}>
            {label} for {tenantLabel} - {subscription.module_code}
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg bg-slate-950/70 border border-white/10 p-3">
              <div className="text-slate-500">Current status</div>
              <div className="text-white font-semibold mt-1">{subscription.status}</div>
            </div>
            <div className="rounded-lg bg-slate-950/70 border border-white/10 p-3">
              <div className="text-slate-500">Billing</div>
              <div className="text-white font-semibold mt-1">{fmt(subscription.base_price)} / {subscription.billing_cycle}</div>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-slate-300 hover:text-white hover:bg-white/5">Keep unchanged</button>
          <button onClick={onConfirm} disabled={confirming}
            className={`px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 ${
              action === 'CANCEL' ? 'bg-red-600 hover:bg-red-500' : action === 'SUSPEND' ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'
            }`}>
            {confirming ? 'Submitting...' : label}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BillingPage() {
  const [dashboard, setDashboard]           = useState<BillingDashboard | null>(null);
  const [subscriptions, setSubscriptions]   = useState<Subscription[]>([]);
  const [loading, setLoading]               = useState(true);
  const [activeTab, setActiveTab]           = useState<'overview' | 'subscriptions'>('overview');
  const [searchQuery, setSearchQuery]       = useState('');
  const [statusFilter, setStatusFilter]     = useState('');
  const [moduleFilter, setModuleFilter]     = useState('');
  const [runningBilling, setRunningBilling] = useState(false);
  const [billingMsg, setBillingMsg]         = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previews, setPreviews]             = useState<PreviewInvoice[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirmingRun, setConfirmingRun]   = useState(false);
  const [showAddModal, setShowAddModal]     = useState(false);
  const [pendingSubscriptionAction, setPendingSubscriptionAction] = useState<PendingSubscriptionAction | null>(null);
  const [confirmingSubscriptionAction, setConfirmingSubscriptionAction] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, subRes] = await Promise.all([
        fetch('/api/billing?type=dashboard'),
        fetch('/api/tenant-subscriptions'),
      ]);
      const dash = dashRes.ok ? await dashRes.json() : null;
      if (dash) setDashboard(dash);
      if (subRes.ok) {
        const d = await subRes.json();
        const rows = Array.isArray(d.data) ? d.data : [];
        setSubscriptions(rows.length ? rows : canonicalSubscriptionsToRows(dash));
      } else {
        setSubscriptions(canonicalSubscriptionsToRows(dash));
      }
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleRunBilling() {
    setRunningBilling(true);
    setBillingMsg(null);
    try {
      const res = await fetch('/api/billing/auto-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-confirm-action': 'billing.run' },
        body: JSON.stringify({ action: 'run_billing' }),
      });
      const data = await res.json();
      if (res.ok) {
        setBillingMsg({ type: 'success', text: `Billing run complete — ${data.invoices_created ?? 0} invoice(s) created.` });
        loadData();
      } else {
        setBillingMsg({ type: 'error', text: data.error ?? 'Billing run failed.' });
      }
    } catch {
      setBillingMsg({ type: 'error', text: 'Network error running billing.' });
    } finally {
      setRunningBilling(false);
    }
  }

  async function handlePreview() {
    setLoadingPreview(true);
    setShowPreviewModal(true);
    try {
      const res = await fetch('/api/billing/auto-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'preview' }),
      });
      const data = await res.json();
      setPreviews(data.previews ?? []);
    } catch {
      setPreviews([]);
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleConfirmRun() {
    setConfirmingRun(true);
    try {
      const res = await fetch('/api/billing/auto-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-confirm-action': 'billing.run' },
        body: JSON.stringify({ action: 'run_billing' }),
      });
      const data = await res.json();
      if (res.ok) {
        setBillingMsg({ type: 'success', text: `Billing run complete — ${data.invoices_created ?? 0} invoice(s) created.` });
        setShowPreviewModal(false);
        loadData();
      }
    } catch {
      // ignore
    } finally {
      setConfirmingRun(false);
    }
  }

  async function handleSubscriptionAction(id: string, action: 'SUSPEND' | 'ACTIVATE' | 'CANCEL') {
    const actionMap: Record<string, string> = { SUSPEND: 'suspend', ACTIVATE: 'activate', CANCEL: 'cancel' };
    try {
      const res = await fetch('/api/tenant-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-confirm-action': 'billing.subscription.update' },
        body: JSON.stringify({ action: actionMap[action], id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 428) {
        setBillingMsg({ type: 'success', text: `Subscription ${action.toLowerCase()} queued for approval: ${data.approvalRequest?.id ?? 'pending request'}.` });
        return;
      }
      if (!res.ok) {
        setBillingMsg({ type: 'error', text: data.error ?? 'Subscription update failed.' });
        return;
      }
      setBillingMsg({ type: 'success', text: `Subscription ${action.toLowerCase()} submitted.` });
      await loadData();
    } catch {
      setBillingMsg({ type: 'error', text: 'Network error updating subscription.' });
    }
  }

  async function confirmSubscriptionAction() {
    if (!pendingSubscriptionAction) return;
    setConfirmingSubscriptionAction(true);
    try {
      await handleSubscriptionAction(pendingSubscriptionAction.subscription.id, pendingSubscriptionAction.action);
      setPendingSubscriptionAction(null);
    } finally {
      setConfirmingSubscriptionAction(false);
    }
  }

  async function handleAddSubscription(data: Record<string, unknown>) {
    try {
      const res = await fetch('/api/tenant-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-confirm-action': 'billing.subscription.update' },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 428) {
        setBillingMsg({ type: 'success', text: `Subscription create/update queued for approval: ${body.approvalRequest?.id ?? 'pending request'}.` });
        setShowAddModal(false);
        return;
      }
      if (!res.ok) {
        setBillingMsg({ type: 'error', text: body.error ?? 'Subscription create/update failed.' });
        return;
      }
      setBillingMsg({ type: 'success', text: 'Subscription saved.' });
      setShowAddModal(false);
      await loadData();
    } catch {
      setBillingMsg({ type: 'error', text: 'Network error saving subscription.' });
    }
  }

  // ── Filtered subscriptions ────────────────────────────────────────────────
  const filteredSubs = subscriptions.filter(s => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q || s.tenant_id.toLowerCase().includes(q) || (s.tenant_name ?? '').toLowerCase().includes(q) || s.module_code.toLowerCase().includes(q);
    const matchesStatus = !statusFilter || s.status === statusFilter;
    const matchesModule = !moduleFilter || s.module_code === moduleFilter;
    return matchesSearch && matchesStatus && matchesModule;
  });

  const ov = dashboard?.overview;

  // ── Run Status ────────────────────────────────────────────────────────────
  function runStatusColor(status: string) {
    if (status === 'COMPLETED') return 'text-emerald-400';
    if (status === 'FAILED')    return 'text-red-400';
    if (status === 'RUNNING')   return 'text-blue-400';
    return 'text-slate-400';
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0c1a3e] text-white p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Billing &amp; Subscriptions</h1>
          <p className="text-sm text-slate-400 mt-0.5">Platform SaaS operator view — manage tenant subscriptions &amp; billing runs</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handlePreview}
            disabled={loadingPreview}
            className="px-4 py-2 rounded-xl border border-white/10 text-sm text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {loadingPreview ? 'Loading…' : 'Preview Billing Run'}
          </button>
          <button
            onClick={handleRunBilling}
            disabled={runningBilling}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {runningBilling ? (
              <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Running…</>
            ) : 'Run Billing Now'}
          </button>
        </div>
      </div>

      {/* Billing run message */}
      {billingMsg && (
        <div className={`mb-6 px-4 py-3 rounded-xl border text-sm flex items-center justify-between ${billingMsg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
          <span>{billingMsg.text}</span>
          <button onClick={() => setBillingMsg(null)} className="text-current opacity-60 hover:opacity-100 ml-4">&times;</button>
        </div>
      )}

      {dashboard?.reconciliation && (
        <div className={`mb-6 px-4 py-3 rounded-xl border text-sm ${dashboard.reconciliation.status === 'OK' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-200'}`}>
          <div className="font-semibold">
            Billing reconciliation: {dashboard.reconciliation.status === 'OK' ? 'Overview and subscriptions are aligned' : 'Drift detected'}
          </div>
          {dashboard.reconciliation.issues.length > 0 && (
            <div className="mt-1 text-xs">{dashboard.reconciliation.issues.join(' | ')}</div>
          )}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 bg-slate-900/60 border border-white/10 rounded-xl p-1 w-fit">
        {(['overview', 'subscriptions'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${activeTab === tab ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {!loading && activeTab === 'overview' && (
        <div className="space-y-8">
          {/* MRR / ARR stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Monthly Recurring Revenue" value={fmt(ov?.mrr ?? 0)} sub="MRR (AED)" />
            <StatCard label="Annual Recurring Revenue" value={fmt(ov?.arr ?? 0)} sub="ARR (AED)" />
            <StatCard label="Active Subscriptions" value={String(ov?.active_subscriptions ?? 0)} sub="across all tenants" />
            <StatCard
              label="Outstanding Invoices"
              value={fmt(dashboard?.outstanding_invoices?.total_outstanding ?? 0)}
              sub={`${dashboard?.outstanding_invoices?.count ?? 0} invoice(s) unpaid`}
              red={(dashboard?.outstanding_invoices?.total_outstanding ?? 0) > 0}
            />
          </div>

          {/* Module Revenue Breakdown */}
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10">
              <h2 className="text-base font-semibold text-white">Module Revenue Breakdown</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left px-6 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Module</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Active Tenants</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">MRR</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Active</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Suspended</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Cancelled</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Trial</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard?.by_module ?? []).map(row => (
                    <tr key={row.module_code} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-6 py-3 text-white font-medium">
                        {MODULE_ICONS[row.module_code] ?? ''} {row.module_code.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">{row.active_count}</td>
                      <td className="px-4 py-3 text-right text-emerald-400 font-medium">{fmt(row.mrr_contribution)}</td>
                      <td className="px-4 py-3 text-right"><span className="text-emerald-400">{row.active_count}</span></td>
                      <td className="px-4 py-3 text-right"><span className="text-amber-400">{row.suspended_count}</span></td>
                      <td className="px-4 py-3 text-right"><span className="text-red-400">{row.cancelled_count}</span></td>
                      <td className="px-4 py-3 text-right"><span className="text-blue-400">{row.trial_count}</span></td>
                    </tr>
                  ))}
                  {(dashboard?.by_module ?? []).length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-slate-500 text-sm">No module data available</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Upcoming Renewals */}
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10">
              <h2 className="text-base font-semibold text-white">Upcoming Renewals <span className="text-xs font-normal text-slate-400 ml-2">(next 7 days)</span></h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left px-6 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Tenant</th>
                    <th className="text-left px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Module</th>
                    <th className="text-left px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Plan</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Amount</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Renewal Date</th>
                    <th className="text-center px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard?.upcoming_renewals ?? []).map(r => (
                    <tr key={r.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-6 py-3">
                        <div className="text-white font-medium text-sm">{r.tenant_name || '—'}</div>
                        <div className="text-xs text-slate-500 font-mono mt-0.5">
                          {r.tenant_code ?? r.tenant_id.slice(0, 8) + '…'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{MODULE_ICONS[r.module_code] ?? ''} {r.module_code}</td>
                      <td className="px-4 py-3 text-slate-300">{r.plan_tier}</td>
                      <td className="px-4 py-3 text-right text-white font-medium">{fmt(r.base_price)}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{fmtDate(r.next_billing_date)}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => {
                            fetch('/api/billing/auto-invoice', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'preview', tenantId: r.tenant_id, module: r.module_code }),
                            }).then(res => res.json()).then(data => {
                              setPreviews(data.previews ?? []);
                              setShowPreviewModal(true);
                            }).catch(() => {});
                          }}
                          className="text-xs px-3 py-1 rounded-lg border border-white/10 text-slate-300 hover:bg-slate-800 transition-colors"
                        >
                          Preview Invoice
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(dashboard?.upcoming_renewals ?? []).length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-slate-500 text-sm">No renewals in the next 7 days</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Billing Runs */}
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10">
              <h2 className="text-base font-semibold text-white">Recent Billing Runs</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left px-6 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Run Date</th>
                    <th className="text-left px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Tenants</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Invoices</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Total Amount</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard?.recent_billing_runs ?? []).map(run => (
                    <tr key={run.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-6 py-3 text-slate-300">{fmtDate(run.run_date)}</td>
                      <td className="px-4 py-3">
                        <span className={`font-medium ${runStatusColor(run.status)}`}>{run.status}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">{run.total_tenants}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{run.invoices_created}</td>
                      <td className="px-4 py-3 text-right text-white font-medium">{fmt(run.total_amount)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-slate-500">—</span>
                      </td>
                    </tr>
                  ))}
                  {(dashboard?.recent_billing_runs ?? []).length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-slate-500 text-sm">No billing runs yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Subscriptions Tab ───────────────────────────────────────────────── */}
      {!loading && activeTab === 'subscriptions' && (
        <div className="space-y-5">
          {/* Search / filter bar */}
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search tenant, module…"
              className="flex-1 bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <select
              value={moduleFilter}
              onChange={e => setModuleFilter(e.target.value)}
              className="bg-slate-900/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none"
            >
              <option value="">All Modules</option>
              {ALL_MODULES.map(m => <option key={m} value={m}>{MODULE_ICONS[m]} {m}</option>)}
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-slate-900/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none"
            >
              <option value="">All Statuses</option>
              {['ACTIVE','SUSPENDED','CANCELLED','TRIAL'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors whitespace-nowrap"
            >
              + Add Subscription
            </button>
          </div>

          <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">All Subscriptions</h2>
              <span className="text-xs text-slate-500">{filteredSubs.length} result(s)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left px-6 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Tenant</th>
                    <th className="text-left px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Module</th>
                    <th className="text-left px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Plan Tier</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Base Price</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Vehicles</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Users</th>
                    <th className="text-center px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Next Billing</th>
                    <th className="text-center px-4 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSubs.map(sub => (
                    <tr key={sub.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                            {(sub.tenant_name ?? sub.tenant_id).charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-white font-medium text-sm">{sub.tenant_name || '—'}</div>
                            <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                              {sub.tenant_code
                                ? <span className="font-mono bg-slate-800 border border-white/10 px-1.5 py-0.5 rounded text-slate-400">{sub.tenant_code}</span>
                                : <span className="font-mono text-slate-600">{sub.tenant_id.slice(0, 8)}…</span>
                              }
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {MODULE_ICONS[sub.module_code] ?? ''} {sub.module_code.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3 text-slate-300">{sub.plan_tier}</td>
                      <td className="px-4 py-3 text-right text-white font-medium">{fmt(sub.base_price)}</td>
                      <td className="px-4 py-3 text-right text-slate-400">{sub.max_vehicles || '—'}</td>
                      <td className="px-4 py-3 text-right text-slate-400">{sub.max_users || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={sub.status} />
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">{fmtDate(sub.next_billing_date)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          {sub.status !== 'ACTIVE' && (
                            <button
                              onClick={() => handleSubscriptionAction(sub.id, 'ACTIVATE')}
                              className="text-xs px-2 py-1 rounded-md border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                            >
                              Activate
                            </button>
                          )}
                          {sub.status === 'ACTIVE' && (
                            <button
                              onClick={() => handleSubscriptionAction(sub.id, 'SUSPEND')}
                              className="text-xs px-2 py-1 rounded-md border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors"
                            >
                              Suspend
                            </button>
                          )}
                          {sub.status !== 'CANCELLED' && (
                            <button
                              onClick={() => setPendingSubscriptionAction({ subscription: sub, action: 'CANCEL' })}
                              className="text-xs px-2 py-1 rounded-md border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredSubs.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-6 py-12 text-center text-slate-500 text-sm">
                        {subscriptions.length === 0 ? 'No subscriptions yet.' : 'No results match your filter.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {showPreviewModal && !loadingPreview && (
        <PreviewRunModal
          previews={previews}
          onClose={() => setShowPreviewModal(false)}
          onConfirm={handleConfirmRun}
          confirming={confirmingRun}
        />
      )}
      {showPreviewModal && loadingPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-10 flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            <p className="text-slate-400 text-sm">Generating preview…</p>
          </div>
        </div>
      )}
      {showAddModal && (
        <AddSubscriptionModal
          onClose={() => setShowAddModal(false)}
          onSave={handleAddSubscription}
        />
      )}
      {pendingSubscriptionAction && (
        <SubscriptionActionModal
          pending={pendingSubscriptionAction}
          onClose={() => setPendingSubscriptionAction(null)}
          onConfirm={confirmSubscriptionAction}
          confirming={confirmingSubscriptionAction}
        />
      )}
    </div>
  );
}
