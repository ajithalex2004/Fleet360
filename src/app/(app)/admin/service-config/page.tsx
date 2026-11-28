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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Settings, Plus, Search, ChevronDown, ChevronRight, Trash2, Save, Folder,
  AlertCircle, Layers, Workflow, Bell, ShieldCheck, DollarSign, Truck,
  Lock, FileCheck, Sparkles, FormInput, Pencil, CheckCircle2, X, ExternalLink,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import {
  LINKED_MODULES, LINKED_MODULE_LABEL, SERVICE_TONES, SCOPE_LEVELS, SCOPE_LEVEL_LABEL,
  type LinkedModule, type ServiceCategoryWithTypes, type ServiceType,
  type ServiceModuleMapping, type ServiceTone, type DefaultPriority,
  type ServiceScope, type ScopeLevel,
} from '@/types/service-config';
import {
  canDeleteServiceCategory,
  canDeleteServiceType,
  pickNextSelectedTypeId,
  validateServiceConfigName,
} from '@/lib/service-config/tree-helpers';
import { SlaTab }        from './tabs/sla-tab';
import { ApprovalTab }   from './tabs/approval-tab';
import { WorkflowTab }   from './tabs/workflow-tab';
import { VehicleTab }    from './tabs/vehicle-tab';
import { TripTab }       from './tabs/trip-tab';
import { FinanceTab }    from './tabs/finance-tab';
import { TicketingTab }  from './tabs/ticketing-tab';
import { EpodTab }       from './tabs/epod-tab';
import { AutomationTab } from './tabs/automation-tab';
import { FormFieldsTab } from './tabs/form-fields-tab';
import { FacilitiesTemplateCard, DepartmentsPanel } from './facilities-and-departments';

// ── Tone palette (mirrors page-theme) ───────────────────────────────────────
const TONE_BG: Record<ServiceTone, string> = {
  gold: 'bg-amber-500/10', blue: 'bg-blue-500/10', emerald: 'bg-emerald-500/10',
  amber: 'bg-amber-500/10', rose: 'bg-rose-500/10', slate: 'bg-slate-500/10',
  violet: 'bg-violet-500/10', cyan: 'bg-cyan-500/10',
};
const TONE_FG: Record<ServiceTone, string> = {
  gold: 'text-yellow-700 dark:text-amber-300', blue: 'text-blue-700 dark:text-blue-300', emerald: 'text-emerald-700 dark:text-emerald-300',
  amber: 'text-amber-700 dark:text-amber-300', rose: 'text-rose-700 dark:text-rose-300', slate: 'text-[var(--text-muted)]',
  violet: 'text-violet-700 dark:text-violet-300', cyan: 'text-cyan-700 dark:text-cyan-300',
};

type TabKey = 'basic' | 'mapping' | 'sla' | 'approval' | 'workflow' | 'vehicle' | 'trip' | 'finance' | 'ticketing' | 'epod' | 'automation' | 'formFields';
const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'basic',      label: 'Basic Info',      icon: Layers      },
  { key: 'mapping',    label: 'Module Mapping',  icon: Workflow    },
  { key: 'formFields', label: 'Form Fields',     icon: FormInput   },
  { key: 'sla',        label: 'SLA & Workflow',  icon: Bell        },
  { key: 'approval',   label: 'Approval',        icon: ShieldCheck },
  { key: 'workflow',   label: 'Workflow',        icon: Workflow    },
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
  const [banner, setBanner]                   = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [search, setSearch]                   = useState('');
  const [expanded, setExpanded]               = useState<Set<string>>(new Set());
  const [selectedTypeId, setSelectedTypeId]   = useState<string | null>(null);
  const [activeTab, setActiveTab]             = useState<TabKey>('basic');
  const [showNewCat, setShowNewCat]           = useState(false);
  const [editingCatId, setEditingCatId]       = useState<string | null>(null);
  const [showNewType, setShowNewType]         = useState<string | null>(null); // categoryId
  const [deletingTypeId, setDeletingTypeId]   = useState<string | null>(null);
  const [deletingCatId, setDeletingCatId]     = useState<string | null>(null);
  const [focusEditTarget, setFocusEditTarget] = useState<{ typeId: string; token: number } | null>(null);
  const [deptRefresh, setDeptRefresh]         = useState(0);

  // Phase 2E — scope state. scopes is the full list for this tenant;
  // activeScopeId is the scope currently being edited (root by default).
  // scopeLookup is fed into each tab so the inheritance chip can render
  // "Inherited from {scopeName}" without an extra fetch.
  const [scopes, setScopes]                   = useState<ServiceScope[]>([]);
  const [activeScopeId, setActiveScopeId]     = useState<string | null>(null);
  const [showNewScope, setShowNewScope]       = useState(false);
  const categoryRefs                          = useRef<Record<string, HTMLDivElement | null>>({});
  const knownCategoryIdsRef                   = useRef<Set<string>>(new Set());
  const pendingScrollCatIdRef                 = useRef<string | null>(null);
  const selectedTypeIdRef                     = useRef<string | null>(null);

  useEffect(() => {
    selectedTypeIdRef.current = selectedTypeId;
  }, [selectedTypeId]);

  const FM_CATEGORY_PREFIX = 'FM_';

  const scopeLookup = useMemo(() => {
    const out: Record<string, { name: string; isRoot: boolean }> = {};
    for (const s of scopes) out[s.id] = { name: s.name, isRoot: s.isRoot };
    return out;
  }, [scopes]);

  const loadScopes = useCallback(async () => {
    const res = await fetch('/api/admin/service-config/scopes');
    const data = await res.json();
    if (!res.ok) return;
    const list: ServiceScope[] = data.scopes ?? [];
    setScopes(list);
    // Default active scope to the root if not picked yet.
    setActiveScopeId(prev => prev ?? list.find(s => s.isRoot)?.id ?? null);
  }, []);

  const load = useCallback(async (opts?: { focusNewOrFm?: boolean; selectTypeId?: string | null }) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/admin/service-config/categories');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load');
      const cats: ServiceCategoryWithTypes[] = data.categories ?? [];
      const prevIds = knownCategoryIdsRef.current;
      const newlyAdded = cats.filter(c => !prevIds.has(c.id));
      knownCategoryIdsRef.current = new Set(cats.map(c => c.id));
      setCategories(cats);
      setMappings(data.mappings ?? []);

      // Expand all on first load; on subsequent loads auto-expand any newly added categories.
      setExpanded(prev => {
        if (prev.size === 0) return new Set(cats.map(c => c.id));
        if (newlyAdded.length === 0 && !opts?.focusNewOrFm) return prev;
        const next = new Set(prev);
        for (const c of newlyAdded) next.add(c.id);
        if (opts?.focusNewOrFm) {
          for (const c of cats) {
            if (c.key.startsWith(FM_CATEGORY_PREFIX) || c.key.startsWith('FSM_')) next.add(c.id);
          }
        }
        return next;
      });

      const allTypes = cats.flatMap(c => c.types);
      const currentSelected = selectedTypeIdRef.current;

      if (opts && 'selectTypeId' in opts) {
        const nextId = opts.selectTypeId && allTypes.some(t => t.id === opts.selectTypeId)
          ? opts.selectTypeId
          : (allTypes[0]?.id ?? null);
        selectedTypeIdRef.current = nextId;
        setSelectedTypeId(nextId);
      } else if (opts?.focusNewOrFm) {
        const focusTarget =
          newlyAdded.find(c => c.types.length > 0) ??
          cats.find(c => (c.key.startsWith(FM_CATEGORY_PREFIX) || c.key.startsWith('FSM_')) && c.types.length > 0);
        if (focusTarget) {
          setSearch('');
          if (focusTarget.types[0]) {
            selectedTypeIdRef.current = focusTarget.types[0].id;
            setSelectedTypeId(focusTarget.types[0].id);
          }
          pendingScrollCatIdRef.current = focusTarget.id;
        }
      } else if (!currentSelected || !allTypes.some(t => t.id === currentSelected)) {
        // Auto-select first type if nothing chosen yet or previously selected type no longer exists.
        const firstId = allTypes[0]?.id ?? null;
        selectedTypeIdRef.current = firstId;
        setSelectedTypeId(firstId);
      }
      await loadScopes();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [loadScopes]);

  useEffect(() => { void load(); }, [load]);

  // Smoothly scroll newly focused / installed category into view after tree renders.
  useEffect(() => {
    const targetId = pendingScrollCatIdRef.current;
    if (!targetId) return;
    const el = categoryRefs.current[targetId];
    if (el) {
      pendingScrollCatIdRef.current = null;
      requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }, [categories, expanded]);

  const jumpToFieldServiceCategories = useCallback(() => {
    setSearch('');
    const targets = categories.filter(c => c.key.startsWith(FM_CATEGORY_PREFIX) || c.key.startsWith('FSM_'));
    if (targets.length === 0) return;
    setExpanded(prev => {
      const next = new Set(prev);
      for (const c of targets) next.add(c.id);
      return next;
    });
    const first = targets.find(c => c.types.length > 0) ?? targets[0];
    if (first.types[0]) setSelectedTypeId(first.types[0].id);
    pendingScrollCatIdRef.current = first.id;
    const el = categoryRefs.current[first.id];
    if (el) {
      pendingScrollCatIdRef.current = null;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [categories]);

  const handleEditTypeFromTree = useCallback((typeId: string) => {
    setSelectedTypeId(typeId);
    setActiveTab('basic');
    setFocusEditTarget(prev => ({ typeId, token: (prev?.token ?? 0) + 1 }));
  }, []);

  const handleDeleteType = useCallback(async (type: ServiceType) => {
    const check = canDeleteServiceType(type);
    if (!check.allowed) {
      setBanner({ kind: 'error', text: check.reason ?? 'System service types cannot be deleted.' });
      return;
    }
    if (!window.confirm(`Delete service type "${type.name}"? This is a soft delete and can be restored from the database.`)) {
      return;
    }
    setDeletingTypeId(type.id);
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/service-config/types/${type.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) {
        setBanner({ kind: 'error', text: d?.error ?? 'Failed to delete service type.' });
        return;
      }
      const nextId = selectedTypeIdRef.current === type.id
        ? pickNextSelectedTypeId(categories, type.id)
        : selectedTypeIdRef.current;
      setBanner({ kind: 'success', text: `Deleted service type "${type.name}".` });
      await load({ selectTypeId: nextId });
    } catch {
      setBanner({ kind: 'error', text: 'Failed to delete service type.' });
    } finally {
      setDeletingTypeId(null);
    }
  }, [categories, load]);

  const handleDeleteCategory = useCallback(async (category: ServiceCategoryWithTypes) => {
    const check = canDeleteServiceCategory(category);
    if (!check.allowed) {
      setBanner({ kind: 'error', text: check.reason ?? 'Cannot delete this category.' });
      return;
    }
    if (!window.confirm(`Delete category "${category.name}"? This is a soft delete and can be restored from the database.`)) {
      return;
    }
    setDeletingCatId(category.id);
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/service-config/categories/${category.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) {
        setBanner({ kind: 'error', text: d?.error ?? 'Failed to delete category.' });
        return;
      }
      setEditingCatId(prev => (prev === category.id ? null : prev));
      setBanner({ kind: 'success', text: `Deleted category "${category.name}".` });
      await load();
    } catch {
      setBanner({ kind: 'error', text: 'Failed to delete category.' });
    } finally {
      setDeletingCatId(null);
    }
  }, [load]);

  // ── Derived ─────────────────────────────────────────────────────────────
  const rawCategoryById = useMemo(
    () => new Map(categories.map(c => [c.id, c])),
    [categories],
  );

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
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-700 dark:text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {banner && (
        <div
          className={`rounded-xl px-4 py-2.5 text-sm flex items-center gap-2 border ${
            banner.kind === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
          }`}
        >
          {banner.kind === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span className="flex-1">{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            aria-label="Dismiss notification"
            className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <FacilitiesTemplateCard
          onInstalled={() => { void load({ focusNewOrFm: true }); setDeptRefresh(n => n + 1); }}
          onJumpToFm={jumpToFieldServiceCategories}
        />
        <DepartmentsPanel refreshKey={deptRefresh} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
        {/* ───────── Left panel — categories + types ───────── */}
        <aside className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-3 space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search services…"
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg pl-9 pr-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setShowNewCat(true)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-700 dark:text-violet-200 text-xs font-semibold">
              <Plus className="w-3.5 h-3.5" /> Add category
            </button>
            <button
              type="button"
              onClick={() =>
                setExpanded(prev =>
                  prev.size >= categories.length ? new Set() : new Set(categories.map(c => c.id)),
                )
              }
              className="px-2.5 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] hover:bg-[var(--bg-surface-hover)] text-[11px] font-semibold text-[var(--text-muted)] shrink-0"
              title={expanded.size >= categories.length ? 'Collapse all categories' : 'Expand all categories'}
            >
              {expanded.size >= categories.length ? 'Collapse all' : 'Expand all'}
            </button>
          </div>

          {showNewCat && (
            <NewCategoryRow
              onCancel={() => setShowNewCat(false)}
              onCreated={() => {
                setShowNewCat(false);
                setBanner({ kind: 'success', text: 'Category created.' });
                void load({ focusNewOrFm: true });
              }}
            />
          )}

          {loading ? (
            <div className="space-y-2 pt-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-9 rounded-lg bg-[var(--bg-surface)]/40 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-1 pt-1 max-h-[70vh] overflow-y-auto">
              {filteredCategories.map(cat => {
                const rawCat = rawCategoryById.get(cat.id) ?? cat;
                const catDeleteCheck = canDeleteServiceCategory(rawCat);
                return (
                  <div key={cat.id} ref={el => { categoryRefs.current[cat.id] = el; }} className="space-y-0.5">
                    <div className="group flex items-center gap-1 rounded-lg hover:bg-[var(--bg-surface-hover)] pr-1">
                      <button
                        type="button"
                        onClick={() => toggle(cat.id)}
                        className={`flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm font-semibold ${TONE_FG[cat.tone]}`}
                      >
                        {expanded.has(cat.id) ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                        <Folder className="w-3.5 h-3.5 shrink-0" />
                        <span className="flex-1 truncate">{cat.name}</span>
                        <span className="text-[10px] tabular-nums text-[var(--text-faint)] shrink-0">{cat.types.length}</span>
                      </button>
                      <div
                        className={`flex items-center gap-0.5 shrink-0 transition-opacity ${
                          editingCatId === cat.id
                            ? 'opacity-100'
                            : 'opacity-65 group-hover:opacity-100 group-focus-within:opacity-100'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCatId(prev => (prev === cat.id ? null : cat.id));
                            setExpanded(prev => new Set(prev).add(cat.id));
                          }}
                          title={`Edit category "${cat.name}"`}
                          aria-label={`Edit category ${cat.name}`}
                          className={`p-1 rounded transition-colors ${
                            editingCatId === cat.id
                              ? 'bg-violet-600 text-white'
                              : 'text-[var(--text-muted)] hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-500/15'
                          }`}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        {!rawCat.isSystem && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteCategory(rawCat)}
                            disabled={!catDeleteCheck.allowed || deletingCatId === cat.id}
                            title={catDeleteCheck.allowed ? `Delete category "${cat.name}"` : catDeleteCheck.reason}
                            aria-label={`Delete category ${cat.name}`}
                            className="p-1 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-500/15 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {editingCatId === cat.id && (
                      <EditCategoryRow
                        category={rawCat}
                        deleting={deletingCatId === cat.id}
                        onCancel={() => setEditingCatId(null)}
                        onSaved={(updatedName) => {
                          setEditingCatId(null);
                          setBanner({ kind: 'success', text: `Updated category "${updatedName}".` });
                          void load();
                        }}
                        onDelete={() => void handleDeleteCategory(rawCat)}
                      />
                    )}

                    {expanded.has(cat.id) && (
                      <div className="ml-5 space-y-0.5 border-l border-[var(--border-subtle)] pl-2">
                        {cat.types.map(t => {
                          const isSelected = selectedTypeId === t.id;
                          const typeDeleteCheck = canDeleteServiceType(t);
                          return (
                            <div
                              key={t.id}
                              className={`group flex items-center gap-1 rounded-md pr-1 transition-colors ${
                                isSelected
                                  ? `${TONE_BG[t.tone]} ${TONE_FG[t.tone]} ring-1 ring-current/30`
                                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => { setFocusEditTarget(null); setSelectedTypeId(t.id); }}
                                className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-left text-xs"
                              >
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TONE_BG[t.tone]} ring-1 ring-current/40`} />
                                <span className="flex-1 truncate">{t.name}</span>
                              </button>
                              {t.isSystem && (
                                <span
                                  title={typeDeleteCheck.reason}
                                  className="text-[9px] uppercase text-[var(--text-faint)] tracking-wider px-1 shrink-0"
                                >
                                  sys
                                </span>
                              )}
                              <div
                                className={`flex items-center gap-0.5 shrink-0 transition-opacity ${
                                  isSelected
                                    ? 'opacity-100'
                                    : 'opacity-65 group-hover:opacity-100 group-focus-within:opacity-100'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => handleEditTypeFromTree(t.id)}
                                  title={`Edit "${t.name}"`}
                                  aria-label={`Edit service type ${t.name}`}
                                  className="p-1 rounded text-[var(--text-muted)] hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-500/15 transition-colors"
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                                {typeDeleteCheck.allowed && (
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteType(t)}
                                    disabled={deletingTypeId === t.id}
                                    title={`Delete "${t.name}"`}
                                    aria-label={`Delete service type ${t.name}`}
                                    className="p-1 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-500/15 disabled:opacity-40 transition-colors"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        <button type="button" onClick={() => setShowNewType(cat.id)}
                          className="w-full inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-[var(--text-muted)] hover:text-violet-700 dark:hover:text-violet-300 hover:bg-[var(--bg-surface-hover)]">
                          <Plus className="w-3 h-3" /> Add service type
                        </button>
                        {showNewType === cat.id && (
                          <NewTypeRow
                            categoryId={cat.id}
                            onCancel={() => setShowNewType(null)}
                            onCreated={(createdId, createdName) => {
                              setShowNewType(null);
                              setActiveTab('basic');
                              setBanner({ kind: 'success', text: `Added service type "${createdName}".` });
                              void load(createdId ? { selectTypeId: createdId } : undefined);
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        {/* ───────── Right panel — tabs ───────── */}
        <section className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl">
          {!selectedType ? (
            <div className="py-20 text-center text-[var(--text-faint)] text-sm">
              <Layers className="w-8 h-8 mx-auto mb-3 text-[var(--text-faint)]" />
              Select a service type from the left panel to view its configuration.
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center gap-3 p-5 border-b border-[var(--border-subtle)] flex-wrap">
                <div className={`w-10 h-10 rounded-xl shrink-0 ${TONE_BG[selectedType.type.tone]} ${TONE_FG[selectedType.type.tone]} flex items-center justify-center text-base font-bold`}>
                  {selectedType.type.name.slice(0, 1)}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-bold text-[var(--text-main)] truncate">{selectedType.type.name}</h2>
                  <p className="text-xs text-[var(--text-faint)] truncate">
                    {selectedType.category.name} · <span className="font-mono">{selectedType.type.key}</span>
                  </p>
                </div>
                {selectedType.type.isSystem ? (
                  <span
                    title={canDeleteServiceType(selectedType.type).reason}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-muted)] shrink-0"
                  >
                    <Lock className="w-3.5 h-3.5" /> System type
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleDeleteType(selectedType.type)}
                    disabled={deletingTypeId === selectedType.type.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 dark:bg-rose-500/15 dark:hover:bg-rose-500/25 dark:border-rose-500/30 dark:text-rose-300 text-xs font-semibold transition-colors disabled:opacity-50 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> {deletingTypeId === selectedType.type.id ? 'Deleting…' : 'Delete type'}
                  </button>
                )}
              </div>

              {/* Scope picker — Phase 2E. Editing a non-root scope creates
                  rule overrides that inherit from the parent chain. */}
              <ScopePicker
                scopes={scopes}
                activeScopeId={activeScopeId}
                onChange={setActiveScopeId}
                showNewScope={showNewScope}
                onShowNewScope={setShowNewScope}
                onScopeCreated={() => { setShowNewScope(false); void loadScopes(); }} />

              {/* Tab strip */}
              <div className="flex flex-wrap gap-1 p-2 border-b border-[var(--border-subtle)]">
                {TABS.map(t => {
                  const Icon = t.icon;
                  const active = activeTab === t.key;
                  return (
                    <button key={t.key} type="button" onClick={() => setActiveTab(t.key)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        active
                          ? 'bg-violet-500/20 text-violet-700 dark:text-violet-200 ring-1 ring-violet-500/40'
                          : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]'
                      }`}>
                      <Icon className="w-3.5 h-3.5" /> {t.label}
                    </button>
                  );
                })}
              </div>

              {/* Tab body */}
              <div className="p-5">
                {activeTab === 'basic' && (
                  <BasicInfoTab
                    key={selectedType.type.id}
                    type={selectedType.type}
                    categories={categories}
                    focusNameToken={focusEditTarget?.typeId === selectedType.type.id ? focusEditTarget.token : 0}
                    deleting={deletingTypeId === selectedType.type.id}
                    onSaved={() => void load()}
                    onDelete={() => void handleDeleteType(selectedType.type)}
                  />
                )}
                {activeTab === 'mapping' && (
                  <ModuleMappingTab key={selectedType.type.id}
                    typeId={selectedType.type.id}
                    initial={selectedMapping}
                    onSaved={() => void load()} />
                )}
                {(() => {
                  // Common props every rule tab consumes. typeKey / categoryKey
                  // are needed by the Workflow tab (filter) and the Approval
                  // tab (workflow dropdown). onSwitchTab lets the Approval
                  // tab jump to the Workflow tab via the "Edit workflow →" link.
                  const ruleProps = {
                    typeId:      selectedType.type.id,
                    scopeId:     activeScopeId ?? undefined,
                    scopeLookup,
                    typeKey:     selectedType.type.key,
                    typeName:    selectedType.type.name,
                    categoryKey: selectedType.category.key,
                    onSwitchTab: (k: string) => setActiveTab(k as TabKey),
                  };
                  const k = `${selectedType.type.id}:${activeScopeId}`;
                  return (
                    <>
                      {activeTab === 'formFields' && <FormFieldsTab key={k} {...ruleProps} />}
                      {activeTab === 'sla'        && <SlaTab        key={k} {...ruleProps} />}
                      {activeTab === 'approval'   && <ApprovalTab   key={k} {...ruleProps} />}
                      {activeTab === 'workflow'   && <WorkflowTab   key={k} {...ruleProps} />}
                      {activeTab === 'vehicle'    && <VehicleTab    key={k} {...ruleProps} />}
                      {activeTab === 'trip'       && <TripTab       key={k} {...ruleProps} />}
                      {activeTab === 'finance'    && <FinanceTab    key={k} {...ruleProps} />}
                      {activeTab === 'ticketing'  && <TicketingTab  key={k} {...ruleProps} />}
                      {activeTab === 'epod'       && <EpodTab       key={k} {...ruleProps} />}
                      {activeTab === 'automation' && <AutomationTab key={k} {...ruleProps} />}
                    </>
                  );
                })()}
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
    const check = validateServiceConfigName(name);
    if (!check.ok) { setErr(check.error); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/admin/service-config/categories', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: check.value, key: key.trim() || check.value }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error ?? 'Create failed'); return; }
      onCreated();
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-[var(--bg-surface)]/60 border border-violet-500/30 rounded-lg p-2 space-y-2">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Category name"
        className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-xs text-[var(--text-main)]" />
      <input value={key} onChange={e => setKey(e.target.value)} placeholder="KEY (auto if blank)"
        className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-xs text-[var(--text-main)] font-mono uppercase" />
      {err && <div className="text-[10px] text-rose-700 dark:text-rose-300">{err}</div>}
      <div className="flex gap-1">
        <button type="button" onClick={submit} disabled={busy} className="flex-1 px-2 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs disabled:opacity-50">
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button type="button" onClick={onCancel} className="px-2 py-1 rounded text-[var(--text-muted)] hover:text-[var(--text-main)] text-xs">Cancel</button>
      </div>
    </div>
  );
}

function EditCategoryRow({
  category,
  deleting,
  onCancel,
  onSaved,
  onDelete,
}: {
  category: ServiceCategoryWithTypes;
  deleting: boolean;
  onCancel: () => void;
  onSaved: (updatedName: string) => void;
  onDelete: () => void;
}) {
  const [name, setName]               = useState(category.name);
  const [description, setDescription] = useState(category.description ?? '');
  const [tone, setTone]               = useState<ServiceTone>(category.tone);
  const [sortOrder, setSortOrder]     = useState<number>(category.sortOrder);
  const [busy, setBusy]               = useState(false);
  const [err, setErr]                 = useState<string | null>(null);

  const delCheck = canDeleteServiceCategory(category);

  const submit = async () => {
    const check = validateServiceConfigName(name);
    if (!check.ok) { setErr(check.error); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/admin/service-config/categories/${category.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: check.value,
          description: description.trim() || null,
          tone,
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error ?? 'Save failed'); return; }
      onSaved(check.value);
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-[var(--bg-canvas)] border border-violet-500/35 rounded-lg p-2.5 space-y-2 ml-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
          Edit category · <span className="font-mono">{category.key}</span>
        </span>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close category editor"
          className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-main)]"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Category name"
        className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-violet-500"
      />
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        rows={2}
        placeholder="Description (optional)"
        className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[11px] text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-violet-500"
      />
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] shrink-0">Sort</span>
        <input
          type="number"
          value={sortOrder}
          onChange={e => setSortOrder(parseInt(e.target.value || '0', 10))}
          className="w-20 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[11px] text-[var(--text-main)]"
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {SERVICE_TONES.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTone(t)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium border ${TONE_BG[t]} ${TONE_FG[t]} ${
              tone === t ? 'ring-2 ring-current/50' : 'border-[var(--border-subtle)]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {err && <div className="text-[10px] text-rose-700 dark:text-rose-300">{err}</div>}
      <div className="flex items-center gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={submit}
          disabled={busy || deleting}
          className="inline-flex items-center justify-center gap-1 flex-1 px-2 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-50"
        >
          <Save className="w-3 h-3" /> {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-2 py-1 rounded text-[var(--text-muted)] hover:text-[var(--text-main)] text-xs"
        >
          Cancel
        </button>
        {!category.isSystem && (
          <button
            type="button"
            onClick={onDelete}
            disabled={!delCheck.allowed || busy || deleting}
            title={delCheck.allowed ? `Delete "${category.name}"` : delCheck.reason}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 dark:bg-rose-500/15 dark:hover:bg-rose-500/25 dark:border-rose-500/30 dark:text-rose-300 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
      {!category.isSystem && !delCheck.allowed && (
        <p className="text-[10px] text-[var(--text-faint)]">{delCheck.reason}</p>
      )}
    </div>
  );
}

function NewTypeRow({
  categoryId,
  onCancel,
  onCreated,
}: {
  categoryId: string;
  onCancel: () => void;
  onCreated: (createdId: string | undefined, createdName: string) => void;
}) {
  const [name, setName] = useState('');
  const [key, setKey]   = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);

  const submit = async () => {
    const check = validateServiceConfigName(name);
    if (!check.ok) { setErr(check.error); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/admin/service-config/types', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId, name: check.value, key: key.trim() || check.value }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error ?? 'Create failed'); return; }
      onCreated(typeof d?.type?.id === 'string' ? d.type.id : undefined, check.value);
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-[var(--bg-surface)]/60 border border-violet-500/30 rounded p-1.5 space-y-1.5 ml-2">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Service type name"
        className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[11px] text-[var(--text-main)]" />
      <input value={key} onChange={e => setKey(e.target.value)} placeholder="KEY (auto if blank)"
        className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[11px] text-[var(--text-main)] font-mono uppercase" />
      {err && <div className="text-[10px] text-rose-700 dark:text-rose-300">{err}</div>}
      <div className="flex gap-1">
        <button type="button" onClick={submit} disabled={busy} className="flex-1 px-2 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-[11px] disabled:opacity-50">
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button type="button" onClick={onCancel} className="px-2 py-1 rounded text-[var(--text-muted)] hover:text-[var(--text-main)] text-[11px]">Cancel</button>
      </div>
    </div>
  );
}

// ── Basic Info tab ──────────────────────────────────────────────────────────

function BasicInfoTab({
  type, categories, focusNameToken, deleting, onSaved, onDelete,
}: {
  type: ServiceType;
  categories: ServiceCategoryWithTypes[];
  focusNameToken: number;
  deleting: boolean;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [name, setName]               = useState(type.name);
  const [description, setDescription] = useState(type.description ?? '');
  const [tone, setTone]               = useState<ServiceTone>(type.tone);
  const [defaultPriority, setPriority] = useState<DefaultPriority>(type.defaultPriority);
  const [sortOrder, setSortOrder]     = useState<number>(type.sortOrder);
  const [categoryId, setCategoryId]   = useState<string>(type.categoryId);
  const [icon, setIcon]               = useState<string>(type.icon ?? '');
  const [saving, setSaving]           = useState(false);
  const [msg, setMsg]                 = useState<string | null>(null);
  const nameInputRef                  = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (focusNameToken === 0) return;
    const input = nameInputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  }, [focusNameToken]);

  const dirty =
    name !== type.name || description !== (type.description ?? '') || tone !== type.tone ||
    defaultPriority !== type.defaultPriority || sortOrder !== type.sortOrder ||
    categoryId !== type.categoryId || icon !== (type.icon ?? '');

  const save = async () => {
    const check = validateServiceConfigName(name);
    if (!check.ok) { setMsg(check.error); return; }
    setSaving(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/service-config/types/${type.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: check.value, description, tone, defaultPriority, sortOrder, categoryId,
          icon: icon.trim() || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d?.error ?? 'Save failed'); return; }
      setMsg('Saved.');
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Name" required>
          <input ref={nameInputRef} value={name} onChange={e => setName(e.target.value)}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
        </Field>
        <Field label="Key" hint="Stable code lookup — read-only">
          <input value={type.key} readOnly
            className="w-full bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-muted)] text-sm font-mono" />
        </Field>
        <Field label="Category">
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] text-sm">
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Default priority">
          <select value={defaultPriority} onChange={e => setPriority(e.target.value as DefaultPriority)}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] text-sm">
            <option>Low</option><option>Medium</option><option>High</option><option>Critical</option>
          </select>
        </Field>
        <Field label="Tone (colour)">
          <div className="flex flex-wrap gap-1.5">
            {SERVICE_TONES.map(t => (
              <button key={t} type="button" onClick={() => setTone(t)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium border ${TONE_BG[t]} ${TONE_FG[t]} ${
                  tone === t ? 'ring-2 ring-current/50' : 'border-[var(--border-subtle)]'
                }`}>
                {t}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Sort order">
          <input type="number" value={sortOrder}
            onChange={e => setSortOrder(parseInt(e.target.value || '0', 10))}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] text-sm" />
        </Field>
        <Field label="Icon (Lucide name)" hint="e.g. Wrench, Calendar — optional">
          <input value={icon} onChange={e => setIcon(e.target.value)}
            placeholder="Wrench"
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] text-sm font-mono" />
        </Field>
      </div>
      <Field label="Description">
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
          className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
      </Field>

      <div className="flex items-center gap-2 flex-wrap pt-2">
        <button type="button" onClick={save} disabled={!dirty || saving || deleting}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save changes'}
        </button>
        {!type.isSystem && (
          <button type="button" onClick={onDelete} disabled={saving || deleting}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 dark:bg-rose-500/15 dark:hover:bg-rose-500/25 dark:border-rose-500/30 dark:text-rose-300 text-sm font-semibold transition-colors disabled:opacity-50">
            <Trash2 className="w-4 h-4" /> {deleting ? 'Deleting…' : 'Delete'}
          </button>
        )}
        {type.isSystem && (
          <span className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5 ml-auto flex-wrap">
            <Lock className="w-3.5 h-3.5 shrink-0" /> System type — cannot be deleted.
            <Link
              href="/service-tickets/catalog"
              className="inline-flex items-center gap-1 text-violet-700 dark:text-violet-300 hover:underline font-medium"
            >
              Disable in Service Catalog <ExternalLink className="w-3 h-3" />
            </Link>
          </span>
        )}
        {msg && <span className={`text-xs font-medium ${/Saved|Deleted/.test(msg) ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>{msg}</span>}
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
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] text-sm">
            {LINKED_MODULES.map(m => (
              <option key={m} value={m}>{LINKED_MODULE_LABEL[m]}</option>
            ))}
          </select>
        </Field>
        <Field label="Sub-module" hint="Optional free text — e.g. 'Maintenance Tickets'">
          <input value={subModule} onChange={e => setSubModule(e.target.value)}
            placeholder="Optional"
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] text-sm" />
        </Field>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Sub-engines</h4>
        <p className="text-[11px] text-[var(--text-faint)]">Toggle the sub-engines this service depends on. Engines stay configurable inside their own admin sections — these flags decide which apply.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2">
          <Toggle label="Workflow engine"     icon={Workflow}    checked={workflow}     onChange={setWorkflow} />
          <Toggle label="Notification engine" icon={Bell}        checked={notification} onChange={setNotification} />
          <Toggle label="Approval engine"     icon={ShieldCheck} checked={approval}     onChange={setApproval} />
          <Toggle label="Finance engine"      icon={DollarSign}  checked={finance}      onChange={setFinance} />
          <Toggle label="Dispatch engine"     icon={Truck}       checked={dispatch}     onChange={setDispatch} />
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <button type="button" onClick={save} disabled={saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save mapping'}
        </button>
        {msg && <span className={`text-xs font-medium ${msg === 'Saved.' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>{msg}</span>}
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
      <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide flex items-center gap-1">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-[var(--text-faint)]">{hint}</p>}
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
          ? 'bg-violet-500/15 border-violet-500/40 text-violet-900 dark:text-violet-100'
          : 'bg-[var(--bg-surface)]/60 border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--border-strong)]'
      }`}>
      <Icon className={`w-4 h-4 ${checked ? 'text-violet-600 dark:text-violet-300' : 'text-[var(--text-faint)]'}`} />
      <span className="flex-1">{label}</span>
      <span className={`w-8 h-4 rounded-full relative ${checked ? 'bg-violet-500' : 'bg-[var(--bg-surface-hover)]'}`}>
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${checked ? 'left-4' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

// ── Scope picker ────────────────────────────────────────────────────────────

function ScopePicker({
  scopes, activeScopeId, onChange, showNewScope, onShowNewScope, onScopeCreated,
}: {
  scopes: ServiceScope[];
  activeScopeId: string | null;
  onChange: (id: string) => void;
  showNewScope: boolean;
  onShowNewScope: (b: boolean) => void;
  onScopeCreated: () => void;
}) {
  const active = scopes.find(s => s.id === activeScopeId);

  return (
    <div className="px-5 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)]/40">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">Scope</span>
        <select value={activeScopeId ?? ''}
          onChange={e => onChange(e.target.value)}
          className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-violet-500">
          {scopes.map(s => (
            <option key={s.id} value={s.id}>
              {s.isRoot ? '🏢 ' : '↳ '}
              {s.name}
              {!s.isRoot && ` (${SCOPE_LEVEL_LABEL[s.level]})`}
            </option>
          ))}
        </select>
        {active && !active.isRoot && (
          <span className="text-[11px] text-blue-700 dark:text-blue-300 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30">
            Editing at {SCOPE_LEVEL_LABEL[active.level]}
          </span>
        )}
        <span className="ml-auto" />
        <button type="button" onClick={() => onShowNewScope(true)}
          className="text-xs px-2.5 py-1 rounded-md bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-700 dark:text-violet-200 inline-flex items-center gap-1 font-medium">
          <Plus className="w-3.5 h-3.5" /> Add scope
        </button>
      </div>
      {showNewScope && (
        <div className="pt-3">
          <NewScopeForm
            scopes={scopes}
            defaultParentId={activeScopeId ?? scopes.find(s => s.isRoot)?.id ?? ''}
            onCancel={() => onShowNewScope(false)}
            onCreated={onScopeCreated} />
        </div>
      )}
    </div>
  );
}

function NewScopeForm({
  scopes, defaultParentId, onCancel, onCreated,
}: {
  scopes: ServiceScope[];
  defaultParentId: string;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [name, setName]               = useState('');
  const [key, setKey]                 = useState('');
  const [level, setLevel]             = useState<ScopeLevel>('BRANCH');
  const [parentScopeId, setParentScopeId] = useState(defaultParentId);
  const [busy, setBusy]               = useState(false);
  const [err, setErr]                 = useState<string | null>(null);

  const submit = async () => {
    const check = validateServiceConfigName(name);
    if (!check.ok) { setErr(check.error); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/admin/service-config/scopes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentScopeId, level,
          key: key.trim() || check.value,
          name: check.value,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error ?? 'Create failed'); return; }
      onCreated();
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-[var(--bg-surface)]/60 border border-violet-500/30 rounded-lg p-3 space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Dubai Branch"
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-xs text-[var(--text-main)]" />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Key</label>
          <input value={key} onChange={e => setKey(e.target.value)} placeholder="auto"
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-xs text-[var(--text-main)] font-mono uppercase" />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Level</label>
          <select value={level} onChange={e => setLevel(e.target.value as ScopeLevel)}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-xs text-[var(--text-main)]">
            {SCOPE_LEVELS.filter(l => l !== 'COMPANY').map(l => (
              <option key={l} value={l}>{SCOPE_LEVEL_LABEL[l]}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Parent</label>
          <select value={parentScopeId} onChange={e => setParentScopeId(e.target.value)}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-xs text-[var(--text-main)]">
            {scopes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      {err && <div className="text-[10px] text-rose-700 dark:text-rose-300">{err}</div>}
      <div className="flex gap-1">
        <button type="button" onClick={submit} disabled={busy} className="px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs disabled:opacity-50">
          {busy ? 'Adding…' : 'Add scope'}
        </button>
        <button type="button" onClick={onCancel} className="px-2 py-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-main)] text-xs">Cancel</button>
      </div>
    </div>
  );
}
