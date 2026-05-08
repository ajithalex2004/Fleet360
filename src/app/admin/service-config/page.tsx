'use client';

/**
 * /admin/service-config — Service Configuration Engine (Phase 2A).
 *
 * Two-pane layout:
 *   Left  — searchable tree of L1 categories with their L2 service types,
 *           plus "Add new" affordances at both levels.
 *   Right — tabbed config screen for the selected service type. Phase 2A
 *           ships two tabs: Basic Info and Module Mapping. The other 8
 *           tabs (SLA, Approval, Vehicle, Trip, Finance, Ticketing, EPOD,
 *           Automation) are stubs that light up across Phase 2B.
 *
 * Existing modules keep working unchanged — this page is a metadata layer
 * that other modules will read in Phase 2C.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Settings, Plus, Search, ChevronDown, ChevronRight, Trash2, Save, Folder,
  AlertCircle, Layers, Workflow, Bell, ShieldCheck, DollarSign, Truck,
  Lock, FileCheck, Sparkles, FormInput,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import {
  LINKED_MODULES, LINKED_MODULE_LABEL, SERVICE_TONES,
  type LinkedModule, type ServiceCategoryWithTypes, type ServiceType,
  type ServiceModuleMapping, type ServiceTone, type DefaultPriority,
} from '@/types/service-config';
import { SlaTab }        from './tabs/sla-tab';
import { ApprovalTab }   from './tabs/approval-tab';
import { VehicleTab }    from './tabs/vehicle-tab';
import { TripTab }       from './tabs/trip-tab';
import { FinanceTab }    from './tabs/finance-tab';
import { TicketingTab }  from './tabs/ticketing-tab';
import { EpodTab }       from './tabs/epod-tab';
import { AutomationTab } from './tabs/automation-tab';
import { FormFieldsTab } from './tabs/form-fields-tab';

// ── Tone palette (mirrors page-theme) ───────────────────────────────────────
const TONE_BG: Record<ServiceTone, string> = {
  gold: 'bg-amber-500/10', blue: 'bg-blue-500/10', emerald: 'bg-emerald-500/10',
  amber: 'bg-amber-500/10', rose: 'bg-rose-500/10', slate: 'bg-slate-500/10',
  violet: 'bg-violet-500/10', cyan: 'bg-cyan-500/10',
};
const TONE_FG: Record<ServiceTone, string> = {
  gold: 'text-amber-300', blue: 'text-blue-300', emerald: 'text-emerald-300',
  amber: 'text-amber-300', rose: 'text-rose-300', slate: 'text-slate-300',
  violet: 'text-violet-300', cyan: 'text-cyan-300',
};

type TabKey = 'basic' | 'mapping' | 'sla' | 'approval' | 'vehicle' | 'trip' | 'finance' | 'ticketing' | 'epod' | 'automation' | 'formFields';
const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'basic',      label: 'Basic Info',      icon: Layers      },
  { key: 'mapping',    label: 'Module Mapping',  icon: Workflow    },
  { key: 'formFields', label: 'Form Fields',     icon: FormInput   },
  { key: 'sla',        label: 'SLA & Workflow',  icon: Bell        },
  { key: 'approval',   label: 'Approval',        icon: ShieldCheck },
  { key: 'vehicle',    label: 'Vehicle Rules',   icon: Truck       },
  { key: 'trip',       label: 'Trip & Dispatch', icon: Truck       },
  { key: 'finance',    label: 'Finance',         icon: DollarSign  },
  { key: 'ticketing',  label: 'Ticketing',       icon: FileCheck   },
  { key: 'epod',       label: 'EPOD',            icon: Lock        },
  { key: 'automation', label: 'Automation',      icon: Sparkles    },
];

export default function ServiceConfigPage() {
  const [categories, setCategories]           = useState<ServiceCategoryWithTypes[]>([]);
  const [mappings, setMappings]               = useState<ServiceModuleMapping[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState<string | null>(null);
  const [search, setSearch]                   = useState('');
  const [expanded, setExpanded]               = useState<Set<string>>(new Set());
  const [selectedTypeId, setSelectedTypeId]   = useState<string | null>(null);
  const [activeTab, setActiveTab]             = useState<TabKey>('basic');
  const [showNewCat, setShowNewCat]           = useState(false);
  const [showNewType, setShowNewType]         = useState<string | null>(null); // categoryId

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/admin/service-config/categories');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load');
      const cats: ServiceCategoryWithTypes[] = data.categories ?? [];
      setCategories(cats);
      setMappings(data.mappings ?? []);
      // Expand all on first load so the tree feels alive.
      setExpanded(prev => prev.size === 0 ? new Set(cats.map(c => c.id)) : prev);
      // Auto-select first type if nothing chosen yet.
      if (!selectedTypeId) {
        const firstType = cats.flatMap(c => c.types)[0];
        if (firstType) setSelectedTypeId(firstType.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [selectedTypeId]);

  useEffect(() => { void load(); }, [load]);

  // ── Derived ─────────────────────────────────────────────────────────────
  const selectedType = useMemo(() => {
    if (!selectedTypeId) return null;
    for (const c of categories) {
      const t = c.types.find(t => t.id === selectedTypeId);
      if (t) return { type: t, category: c };
    }
    return null;
  }, [categories, selectedTypeId]);

  const selectedMapping = useMemo(
    () => mappings.find(m => m.serviceTypeId === selectedTypeId) ?? null,
    [mappings, selectedTypeId],
  );

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return categories;
    const q = search.toLowerCase();
    return categories
      .map(c => ({
        ...c,
        types: c.types.filter(t =>
          t.name.toLowerCase().includes(q) ||
          t.key.toLowerCase().includes(q) ||
          (t.description ?? '').toLowerCase().includes(q),
        ),
      }))
      .filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.key.toLowerCase().includes(q) ||
        c.types.length > 0,
      );
  }, [categories, search]);

  const toggle = (id: string) =>
    setExpanded(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 max-w-[1600px]">
      <PageHeader
        title="Service Configuration"
        subtitle="One place to define the service taxonomy, module dependencies, and downstream rules"
        icon={Settings}
        accent="violet"
      />

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
        {/* ───────── Left panel — categories + types ───────── */}
        <aside className="bg-slate-900 border border-white/10 rounded-2xl p-3 space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search services…"
              className="w-full bg-slate-800 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </div>
          <button onClick={() => setShowNewCat(true)}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-200 text-xs font-semibold">
            <Plus className="w-3.5 h-3.5" /> Add category
          </button>

          {showNewCat && (
            <NewCategoryRow onCancel={() => setShowNewCat(false)} onCreated={() => { setShowNewCat(false); void load(); }} />
          )}

          {loading ? (
            <div className="space-y-2 pt-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-9 rounded-lg bg-slate-800/40 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-1 pt-1 max-h-[70vh] overflow-y-auto">
              {filteredCategories.map(cat => (
                <div key={cat.id} className="space-y-0.5">
                  <button onClick={() => toggle(cat.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm font-semibold ${TONE_FG[cat.tone]} hover:bg-white/5`}>
                    {expanded.has(cat.id) ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    <Folder className="w-3.5 h-3.5 shrink-0" />
                    <span className="flex-1 truncate">{cat.name}</span>
                    <span className="text-[10px] tabular-nums text-slate-500">{cat.types.length}</span>
                  </button>
                  {expanded.has(cat.id) && (
                    <div className="ml-5 space-y-0.5 border-l border-white/5 pl-2">
                      {cat.types.map(t => (
                        <button key={t.id} onClick={() => setSelectedTypeId(t.id)}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs ${
                            selectedTypeId === t.id
                              ? `${TONE_BG[t.tone]} ${TONE_FG[t.tone]} ring-1 ring-current/30`
                              : 'text-slate-300 hover:bg-white/5'
                          }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${TONE_BG[t.tone]} ring-1 ring-current/40`} />
                          <span className="flex-1 truncate">{t.name}</span>
                          {t.isSystem && <span className="text-[9px] uppercase text-slate-500 tracking-wider">sys</span>}
                        </button>
                      ))}
                      <button onClick={() => setShowNewType(cat.id)}
                        className="w-full inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-slate-400 hover:text-violet-300 hover:bg-white/5">
                        <Plus className="w-3 h-3" /> Add service type
                      </button>
                      {showNewType === cat.id && (
                        <NewTypeRow categoryId={cat.id}
                          onCancel={() => setShowNewType(null)}
                          onCreated={() => { setShowNewType(null); void load(); }} />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* ───────── Right panel — tabs ───────── */}
        <section className="bg-slate-900 border border-white/10 rounded-2xl">
          {!selectedType ? (
            <div className="py-20 text-center text-slate-500 text-sm">
              <Layers className="w-8 h-8 mx-auto mb-3 text-slate-600" />
              Select a service type from the left panel to view its configuration.
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center gap-3 p-5 border-b border-white/5">
                <div className={`w-10 h-10 rounded-xl ${TONE_BG[selectedType.type.tone]} ${TONE_FG[selectedType.type.tone]} flex items-center justify-center text-base font-bold`}>
                  {selectedType.type.name.slice(0, 1)}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-bold text-white truncate">{selectedType.type.name}</h2>
                  <p className="text-xs text-slate-500 truncate">
                    {selectedType.category.name} · <span className="font-mono">{selectedType.type.key}</span>
                  </p>
                </div>
              </div>

              {/* Tab strip */}
              <div className="flex flex-wrap gap-1 p-2 border-b border-white/5">
                {TABS.map(t => {
                  const Icon = t.icon;
                  const active = activeTab === t.key;
                  return (
                    <button key={t.key} onClick={() => setActiveTab(t.key)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        active
                          ? 'bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/40'
                          : 'text-slate-300 hover:bg-white/5'
                      }`}>
                      <Icon className="w-3.5 h-3.5" /> {t.label}
                    </button>
                  );
                })}
              </div>

              {/* Tab body */}
              <div className="p-5">
                {activeTab === 'basic' && (
                  <BasicInfoTab key={selectedType.type.id}
                    type={selectedType.type}
                    categories={categories}
                    onSaved={() => void load()} />
                )}
                {activeTab === 'mapping' && (
                  <ModuleMappingTab key={selectedType.type.id}
                    typeId={selectedType.type.id}
                    initial={selectedMapping}
                    onSaved={() => void load()} />
                )}
                {activeTab === 'formFields' && <FormFieldsTab key={selectedType.type.id} typeId={selectedType.type.id} />}
                {activeTab === 'sla'        && <SlaTab        key={selectedType.type.id} typeId={selectedType.type.id} />}
                {activeTab === 'approval'   && <ApprovalTab   key={selectedType.type.id} typeId={selectedType.type.id} />}
                {activeTab === 'vehicle'    && <VehicleTab    key={selectedType.type.id} typeId={selectedType.type.id} />}
                {activeTab === 'trip'       && <TripTab       key={selectedType.type.id} typeId={selectedType.type.id} />}
                {activeTab === 'finance'    && <FinanceTab    key={selectedType.type.id} typeId={selectedType.type.id} />}
                {activeTab === 'ticketing'  && <TicketingTab  key={selectedType.type.id} typeId={selectedType.type.id} />}
                {activeTab === 'epod'       && <EpodTab       key={selectedType.type.id} typeId={selectedType.type.id} />}
                {activeTab === 'automation' && <AutomationTab key={selectedType.type.id} typeId={selectedType.type.id} />}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Left-panel inline forms ─────────────────────────────────────────────────

function NewCategoryRow({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [key, setKey]   = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) { setErr('Name is required'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/admin/service-config/categories', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), key: key.trim() || name.trim() }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error ?? 'Create failed'); return; }
      onCreated();
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-slate-800/60 border border-violet-500/30 rounded-lg p-2 space-y-2">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Category name"
        className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1.5 text-xs text-white" />
      <input value={key} onChange={e => setKey(e.target.value)} placeholder="KEY (auto if blank)"
        className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1.5 text-xs text-white font-mono uppercase" />
      {err && <div className="text-[10px] text-rose-300">{err}</div>}
      <div className="flex gap-1">
        <button onClick={submit} disabled={busy} className="flex-1 px-2 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs disabled:opacity-50">
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button onClick={onCancel} className="px-2 py-1 rounded text-slate-400 hover:text-white text-xs">Cancel</button>
      </div>
    </div>
  );
}

function NewTypeRow({ categoryId, onCancel, onCreated }: { categoryId: string; onCancel: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [key, setKey]   = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) { setErr('Name is required'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/admin/service-config/types', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId, name: name.trim(), key: key.trim() || name.trim() }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error ?? 'Create failed'); return; }
      onCreated();
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-slate-800/60 border border-violet-500/30 rounded p-1.5 space-y-1.5 ml-2">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Service type name"
        className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-[11px] text-white" />
      <input value={key} onChange={e => setKey(e.target.value)} placeholder="KEY (auto if blank)"
        className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-[11px] text-white font-mono uppercase" />
      {err && <div className="text-[10px] text-rose-300">{err}</div>}
      <div className="flex gap-1">
        <button onClick={submit} disabled={busy} className="flex-1 px-2 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-[11px] disabled:opacity-50">
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button onClick={onCancel} className="px-2 py-1 rounded text-slate-400 hover:text-white text-[11px]">Cancel</button>
      </div>
    </div>
  );
}

// ── Basic Info tab ──────────────────────────────────────────────────────────

function BasicInfoTab({
  type, categories, onSaved,
}: { type: ServiceType; categories: ServiceCategoryWithTypes[]; onSaved: () => void }) {
  const [name, setName]               = useState(type.name);
  const [description, setDescription] = useState(type.description ?? '');
  const [tone, setTone]               = useState<ServiceTone>(type.tone);
  const [defaultPriority, setPriority] = useState<DefaultPriority>(type.defaultPriority);
  const [sortOrder, setSortOrder]     = useState<number>(type.sortOrder);
  const [categoryId, setCategoryId]   = useState<string>(type.categoryId);
  const [icon, setIcon]               = useState<string>(type.icon ?? '');
  const [saving, setSaving]           = useState(false);
  const [msg, setMsg]                 = useState<string | null>(null);

  const dirty =
    name !== type.name || description !== (type.description ?? '') || tone !== type.tone ||
    defaultPriority !== type.defaultPriority || sortOrder !== type.sortOrder ||
    categoryId !== type.categoryId || icon !== (type.icon ?? '');

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/service-config/types/${type.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, description, tone, defaultPriority, sortOrder, categoryId,
          icon: icon || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d?.error ?? 'Save failed'); return; }
      setMsg('Saved.');
      onSaved();
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (type.isSystem) { setMsg('System service types cannot be deleted.'); return; }
    if (!window.confirm(`Delete "${type.name}"? This is a soft delete and can be restored from the database.`)) return;
    setSaving(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/service-config/types/${type.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) { setMsg(d?.error ?? 'Delete failed'); return; }
      setMsg('Deleted.'); onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Name" required>
          <input value={name} onChange={e => setName(e.target.value)}
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
        </Field>
        <Field label="Key" hint="Stable code lookup — read-only">
          <input value={type.key} readOnly
            className="w-full bg-slate-950 border border-white/5 rounded-lg px-3 py-2 text-slate-400 text-sm font-mono" />
        </Field>
        <Field label="Category">
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)}
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Default priority">
          <select value={defaultPriority} onChange={e => setPriority(e.target.value as DefaultPriority)}
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
            <option>Low</option><option>Medium</option><option>High</option>
          </select>
        </Field>
        <Field label="Tone (colour)">
          <div className="flex flex-wrap gap-1.5">
            {SERVICE_TONES.map(t => (
              <button key={t} type="button" onClick={() => setTone(t)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium border ${TONE_BG[t]} ${TONE_FG[t]} ${
                  tone === t ? 'ring-2 ring-current/50' : 'border-white/10'
                }`}>
                {t}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Sort order">
          <input type="number" value={sortOrder}
            onChange={e => setSortOrder(parseInt(e.target.value || '0', 10))}
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
        </Field>
        <Field label="Icon (Lucide name)" hint="e.g. Wrench, Calendar — optional">
          <input value={icon} onChange={e => setIcon(e.target.value)}
            placeholder="Wrench"
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono" />
        </Field>
      </div>
      <Field label="Description">
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
          className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
      </Field>

      <div className="flex items-center gap-2 pt-2">
        <button onClick={save} disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save changes'}
        </button>
        {!type.isSystem && (
          <button onClick={remove} disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-rose-300 hover:bg-rose-500/10 text-sm disabled:opacity-50">
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        )}
        {type.isSystem && (
          <span className="text-[11px] text-slate-500 inline-flex items-center gap-1 ml-auto">
            <Lock className="w-3 h-3" /> System service type — cannot be deleted
          </span>
        )}
        {msg && <span className={`text-xs ${/Saved|Deleted/.test(msg) ? 'text-emerald-300' : 'text-rose-300'}`}>{msg}</span>}
      </div>
    </div>
  );
}

// ── Module Mapping tab ──────────────────────────────────────────────────────

function ModuleMappingTab({
  typeId, initial, onSaved,
}: { typeId: string; initial: ServiceModuleMapping | null; onSaved: () => void }) {
  const [linkedModule, setLinkedModule] = useState<LinkedModule>(initial?.linkedModule ?? 'ADMIN');
  const [subModule, setSubModule]       = useState<string>(initial?.subModule ?? '');
  const [workflow, setWorkflow]         = useState<boolean>(!!initial?.workflowEngineEnabled);
  const [notification, setNotification] = useState<boolean>(initial?.notificationEngineEnabled !== false);
  const [approval, setApproval]         = useState<boolean>(!!initial?.approvalEngineEnabled);
  const [finance, setFinance]           = useState<boolean>(!!initial?.financeEngineEnabled);
  const [dispatch, setDispatch]         = useState<boolean>(!!initial?.dispatchEngineEnabled);
  const [saving, setSaving]             = useState(false);
  const [msg, setMsg]                   = useState<string | null>(null);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/service-config/types/${typeId}/module-mapping`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          linkedModule, subModule: subModule.trim() || null,
          workflowEngineEnabled: workflow,
          notificationEngineEnabled: notification,
          approvalEngineEnabled: approval,
          financeEngineEnabled: finance,
          dispatchEngineEnabled: dispatch,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d?.error ?? 'Save failed'); return; }
      setMsg('Saved.'); onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Linked module" required hint="Which module owns this service's lifecycle">
          <select value={linkedModule} onChange={e => setLinkedModule(e.target.value as LinkedModule)}
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
            {LINKED_MODULES.map(m => (
              <option key={m} value={m}>{LINKED_MODULE_LABEL[m]}</option>
            ))}
          </select>
        </Field>
        <Field label="Sub-module" hint="Optional free text — e.g. 'Maintenance Tickets'">
          <input value={subModule} onChange={e => setSubModule(e.target.value)}
            placeholder="Optional"
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
        </Field>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Sub-engines</h4>
        <p className="text-[11px] text-slate-500">Toggle the sub-engines this service depends on. Engines stay configurable inside their own admin sections — these flags decide which apply.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2">
          <Toggle label="Workflow engine"     icon={Workflow}    checked={workflow}     onChange={setWorkflow} />
          <Toggle label="Notification engine" icon={Bell}        checked={notification} onChange={setNotification} />
          <Toggle label="Approval engine"     icon={ShieldCheck} checked={approval}     onChange={setApproval} />
          <Toggle label="Finance engine"      icon={DollarSign}  checked={finance}      onChange={setFinance} />
          <Toggle label="Dispatch engine"     icon={Truck}       checked={dispatch}     onChange={setDispatch} />
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <button onClick={save} disabled={saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save mapping'}
        </button>
        {msg && <span className={`text-xs ${msg === 'Saved.' ? 'text-emerald-300' : 'text-rose-300'}`}>{msg}</span>}
      </div>
    </div>
  );
}

// ── Reusable bits ───────────────────────────────────────────────────────────

function Field({ label, children, hint, required }: {
  label: string; children: React.ReactNode; hint?: string; required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-slate-400 uppercase tracking-wide flex items-center gap-1">
        {label} {required && <span className="text-rose-400">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}

function Toggle({ label, icon: Icon, checked, onChange }: {
  label: string; icon: React.ComponentType<{ className?: string }>;
  checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all text-left ${
        checked
          ? 'bg-violet-500/15 border-violet-500/40 text-violet-100'
          : 'bg-slate-800/60 border-white/10 text-slate-400 hover:border-white/20'
      }`}>
      <Icon className={`w-4 h-4 ${checked ? 'text-violet-300' : 'text-slate-500'}`} />
      <span className="flex-1">{label}</span>
      <span className={`w-8 h-4 rounded-full relative ${checked ? 'bg-violet-500' : 'bg-slate-700'}`}>
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${checked ? 'left-4' : 'left-0.5'}`} />
      </span>
    </button>
  );
}
