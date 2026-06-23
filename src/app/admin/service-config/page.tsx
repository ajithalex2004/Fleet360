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
  Settings, Plus, Search, ChevronDown, ChevronRight, Trash2, Save,
  AlertCircle, Layers, Workflow, Bell, ShieldCheck, DollarSign, Truck,
  Lock, FileCheck, FormInput, PackageCheck,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import {
  LINKED_MODULES, LINKED_MODULE_LABEL, SERVICE_TONES, SCOPE_LEVELS, SCOPE_LEVEL_LABEL,
  type LinkedModule, type ServiceCategoryWithTypes, type ServiceType,
  type ServiceModuleMapping, type ServiceTone, type DefaultPriority,
  type ServiceScope, type ScopeLevel,
} from '@/types/service-config';
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
import { CatalogTab }    from './tabs/catalog-tab';

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

type TabKey = 'basic' | 'mapping' | 'sla' | 'approval' | 'workflow' | 'vehicle' | 'trip' | 'finance' | 'ticketing' | 'epod' | 'automation' | 'formFields' | 'catalog';
const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'basic',      label: 'Basic Info',      icon: Layers      },
  { key: 'mapping',    label: 'Module Mapping',  icon: Workflow    },
  { key: 'workflow',   label: 'Workflows',       icon: Workflow    },
  { key: 'approval',   label: 'Approvals',       icon: ShieldCheck },
  { key: 'finance',    label: 'Finance Rules',   icon: DollarSign  },
  { key: 'vehicle',    label: 'Vehicle Rules',   icon: Truck       },
  { key: 'catalog',    label: 'Catalog',         icon: PackageCheck },
  { key: 'formFields', label: 'Form Fields',     icon: FormInput   },
  { key: 'sla',        label: 'SLA',             icon: Bell        },
  { key: 'automation', label: 'Notifications',   icon: Bell        },
  { key: 'trip',       label: 'Trip & Dispatch', icon: Truck       },
  { key: 'ticketing',  label: 'Ticketing',       icon: FileCheck   },
  { key: 'epod',       label: 'EPOD',            icon: Lock        },
];

type ModuleHubEntry = {
  type: ServiceType;
  category: ServiceCategoryWithTypes;
  mapping: ServiceModuleMapping | null;
};

type ModuleHubGroup = {
  module: LinkedModule;
  label: string;
  entries: ModuleHubEntry[];
};

function approvalMessage(body: { approvalRequest?: { id?: string | null } } | null | undefined): string {
  return `Queued for approval: ${body?.approvalRequest?.id ?? 'pending request'}. Approve it, then retry this change.`;
}

interface HealthIssue {
  severity: 'error' | 'warning' | 'info';
  tab: string;
  code: string;
  message: string;
  detail?: string;
}

interface ServiceHealth {
  status: 'OK' | 'WARN' | 'BLOCKED';
  issues: HealthIssue[];
  impact: {
    activeTickets: number;
    workflows: number;
    activeWorkflows: number;
    activeWorkflowsWithSteps: number;
    inheritedRuleCategories: string[];
  };
}

export default function ServiceConfigPage() {
  const [categories, setCategories]           = useState<ServiceCategoryWithTypes[]>([]);
  const [mappings, setMappings]               = useState<ServiceModuleMapping[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState<string | null>(null);
  const [search, setSearch]                   = useState('');
  const [expanded, setExpanded]               = useState<Set<string>>(new Set());
  const [selectedTypeId, setSelectedTypeId]   = useState<string | null>(null);
  const [selectedModule, setSelectedModule]   = useState<LinkedModule | null>(null);
  const [activeTab, setActiveTab]             = useState<TabKey>('basic');
  const [showNewCat, setShowNewCat]           = useState(false);
  const [showNewType, setShowNewType]         = useState<string | null>(null); // categoryId

  // Phase 2E — scope state. scopes is the full list for this tenant;
  // activeScopeId is the scope currently being edited (root by default).
  // scopeLookup is fed into each tab so the inheritance chip can render
  // "Inherited from {scopeName}" without an extra fetch.
  const [scopes, setScopes]                   = useState<ServiceScope[]>([]);
  const [activeScopeId, setActiveScopeId]     = useState<string | null>(null);
  const [showNewScope, setShowNewScope]       = useState(false);
  const [health, setHealth]                   = useState<ServiceHealth | null>(null);
  const [healthLoading, setHealthLoading]     = useState(false);

  const scopeLookup = useMemo(() => {
    const out: Record<string, { name: string; isRoot: boolean }> = {};
    for (const s of scopes) out[s.id] = { name: s.name, isRoot: s.isRoot };
    return out;
  }, [scopes]);

  const hydrateScopes = useCallback((list: ServiceScope[]) => {
    setScopes(list);
    setActiveScopeId(prev => prev ?? list.find(s => s.isRoot)?.id ?? null);
  }, []);

  const loadScopes = useCallback(async () => {
    const res = await fetch('/api/admin/service-config/scopes');
    const data = await res.json();
    if (!res.ok) return;
    hydrateScopes(data.scopes ?? []);
  }, [hydrateScopes]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [categoriesRes, scopesRes] = await Promise.all([
        fetch('/api/admin/service-config/categories'),
        fetch('/api/admin/service-config/scopes'),
      ]);
      const [categoriesData, scopesData] = await Promise.all([
        categoriesRes.json(),
        scopesRes.json(),
      ]);
      if (!categoriesRes.ok) throw new Error(categoriesData?.error ?? 'Failed to load');
      const cats: ServiceCategoryWithTypes[] = categoriesData.categories ?? [];
      setCategories(cats);
      setMappings(categoriesData.mappings ?? []);
      if (scopesRes.ok) {
        hydrateScopes(scopesData.scopes ?? []);
      }
      setExpanded(prev => {
        if (prev.size > 0) return prev;
        const firstMappedTypeId = cats.flatMap(c => c.types)[0]?.id;
        const firstMappedModule = (categoriesData.mappings ?? []).find((row: ServiceModuleMapping) => row.serviceTypeId === firstMappedTypeId)?.linkedModule;
        return firstMappedModule ? new Set([`module:${firstMappedModule}`]) : prev;
      });
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
  }, [hydrateScopes, selectedTypeId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selectedTypeId) { setHealth(null); return; }
    let cancelled = false;
    setHealthLoading(true);
    const qs = activeScopeId ? `?scopeId=${activeScopeId}` : '';
    fetch(`/api/admin/service-config/types/${selectedTypeId}/health${qs}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!cancelled) setHealth(data?.ok ? data : null);
      })
      .catch(() => { if (!cancelled) setHealth(null); })
      .finally(() => { if (!cancelled) setHealthLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTypeId, activeScopeId]);

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

  const moduleGroups = useMemo<ModuleHubGroup[]>(() => {
    const q = search.trim().toLowerCase();
    return LINKED_MODULES.map((module) => {
      const entries = categories.flatMap((category) =>
        category.types.flatMap((type) => {
          const mapping = mappings.find((row) => row.serviceTypeId === type.id) ?? null;
          const linkedModule = mapping?.linkedModule ?? 'ADMIN';
          if (linkedModule !== module) return [];

          const searchable = [
            LINKED_MODULE_LABEL[module],
            category.name,
            category.key,
            type.name,
            type.key,
            type.description ?? '',
            mapping?.subModule ?? '',
          ]
            .join(' ')
            .toLowerCase();
          if (q && !searchable.includes(q)) return [];

          return [{ type, category, mapping }];
        })
      );

      return {
        module,
        label: LINKED_MODULE_LABEL[module],
        entries: entries.sort((left, right) => {
          if (left.type.sortOrder !== right.type.sortOrder) return left.type.sortOrder - right.type.sortOrder;
          return left.type.name.localeCompare(right.type.name);
        }),
      };
    }).filter((group) => group.entries.length > 0 || !q);
  }, [categories, mappings, search]);

  const selectedModuleGroup = useMemo(
    () => moduleGroups.find((group) => group.module === selectedModule) ?? null,
    [moduleGroups, selectedModule],
  );

  const toggle = (id: string) =>
    setExpanded(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  useEffect(() => {
    if (selectedMapping?.linkedModule) {
      setSelectedModule(selectedMapping.linkedModule);
      return;
    }
    if (!selectedModule) {
      const firstWithEntries = moduleGroups.find((group) => group.entries.length > 0);
      if (firstWithEntries) setSelectedModule(firstWithEntries.module);
    }
  }, [moduleGroups, selectedMapping, selectedModule]);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 max-w-[1600px]">
      <PageHeader
        title="Service Configuration"
        subtitle="Full module configuration hub for workflows, approvals, finance rules, vehicle rules, form fields, SLA, and notifications"
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
        <aside className="bg-slate-900 border border-white/10 rounded-2xl p-3 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search modules and service types..."
              className="w-full bg-slate-800 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          {loading ? (
            <div className="space-y-2 pt-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-12 rounded-xl bg-slate-800/40 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-3 pt-1 max-h-[70vh] overflow-y-auto pr-1">
              {moduleGroups.map(group => {
                const modulePanelId = `module:${group.module}`;
                const isExpanded = expanded.has(modulePanelId);
                return (
                  <div key={group.module} className="rounded-xl border border-white/10 bg-slate-950/40 overflow-hidden">
                    <button
                      onClick={() => {
                        toggle(modulePanelId);
                        setSelectedModule(group.module);
                        const hasSelectedType = group.entries.some((entry) => entry.type.id === selectedTypeId);
                        if (!hasSelectedType && group.entries[0]) {
                          setSelectedTypeId(group.entries[0].type.id);
                        }
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-3 text-left transition ${
                        selectedModule === group.module ? 'bg-violet-600/10' : 'hover:bg-white/5'
                      }`}
                    >
                      <div className="w-9 h-9 rounded-lg bg-violet-500/10 text-violet-200 flex items-center justify-center text-xs font-bold shrink-0">
                        {group.label.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-white truncate">{group.label}</div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {group.entries.length} configured service type{group.entries.length === 1 ? '' : 's'}
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="border-t border-white/5 bg-slate-950/30 px-2 py-2 space-y-1">
                        {group.entries.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-slate-500">
                            No service types are linked to this module yet.
                          </div>
                        ) : (
                          group.entries.map(({ type, category, mapping }) => (
                            <button
                              key={type.id}
                              onClick={() => {
                                setSelectedModule(group.module);
                                setExpanded(prev => {
                                  const next = new Set(prev);
                                  next.add(modulePanelId);
                                  return next;
                                });
                                setSelectedTypeId(type.id);
                              }}
                              className={`w-full rounded-lg px-3 py-2 text-left transition ${
                                selectedTypeId === type.id
                                  ? `${TONE_BG[type.tone]} ${TONE_FG[type.tone]} ring-1 ring-current/30`
                                  : 'hover:bg-white/5 text-slate-200'
                              }`}
                            >
                              <div className="flex items-start gap-2">
                                <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${TONE_BG[type.tone]} ring-1 ring-current/40`} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium truncate">{type.name}</span>
                                    {type.isSystem && (
                                      <span className="text-[9px] uppercase tracking-wider text-slate-500">sys</span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-400 truncate">
                                    {category.name} · {type.key}
                                    {mapping?.subModule ? ` · ${mapping.subModule}` : ''}
                                  </div>
                                </div>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {!moduleGroups.some(group => group.entries.length > 0) && (
                <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-500">
                  No module-mapped service types match your search yet.
                </div>
              )}
            </div>
          )}

          <div className="border-t border-white/5 pt-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Advanced Taxonomy</div>
                <div className="text-[11px] text-slate-500">
                  Categories and service types still power the rules engine behind each module.
                </div>
              </div>
              <button onClick={() => setShowNewCat(true)}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-200 text-xs font-semibold shrink-0">
                <Plus className="w-3.5 h-3.5" /> Add category
              </button>
            </div>

            {showNewCat && (
              <NewCategoryRow onCancel={() => setShowNewCat(false)} onCreated={() => { setShowNewCat(false); void load(); }} />
            )}

            {selectedModuleGroup && (
              <div className="rounded-lg border border-white/5 bg-slate-950/40 p-2">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">
                  Add service type to {selectedModuleGroup.label}
                </div>
                <div className="space-y-1">
                  {categories.map((category) => (
                    <div key={category.id}>
                      <button onClick={() => setShowNewType(category.id)}
                        className="w-full inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-slate-300 hover:text-violet-300 hover:bg-white/5">
                        <Plus className="w-3 h-3" /> {category.name}
                      </button>
                      {showNewType === category.id && (
                        <NewTypeRow categoryId={category.id}
                          onCancel={() => setShowNewType(null)}
                          onCreated={() => { setShowNewType(null); void load(); }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ───────── Right panel — tabs ───────── */}
        <section className="bg-slate-900 border border-white/10 rounded-2xl">
          {!selectedType ? (
            <div className="py-20 text-center text-slate-500 text-sm">
              <Layers className="w-8 h-8 mx-auto mb-3 text-slate-600" />
              Select a module-linked service type from the left panel to view its configuration hub.
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
                    {LINKED_MODULE_LABEL[selectedMapping?.linkedModule ?? 'ADMIN']} · {selectedType.category.name} · <span className="font-mono">{selectedType.type.key}</span>
                  </p>
                </div>
              </div>

              {/* Scope picker — Phase 2E. Editing a non-root scope creates
                  rule overrides that inherit from the parent chain. */}
              <ScopePicker
                scopes={scopes}
                activeScopeId={activeScopeId}
                onChange={setActiveScopeId}
                showNewScope={showNewScope}
                onShowNewScope={setShowNewScope}
                onScopeCreated={() => { setShowNewScope(false); void loadScopes(); }}
                onScopesChanged={() => { void loadScopes(); }} />

              <HealthPanel health={health} loading={healthLoading} onTab={k => setActiveTab(k)} />

              {/* Tab strip */}
              <div className="flex flex-wrap gap-1 p-2 border-b border-white/5">
                {TABS.map(t => {
                  const Icon = t.icon;
                  const active = activeTab === t.key;
                  return (
                    <button key={t.key} onClick={() => setActiveTab(t.key)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        active
                          ? 'bg-violet-100 text-violet-900 ring-1 ring-violet-300 shadow-sm'
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
                    // Phase B++ — Form Fields tab consumes this to drive
                    // module-aware bindings (e.g. when Module Mapping has
                    // linkedModule='MAINTENANCE', Form Fields' bind-to
                    // dropdown shows MaintenanceRequest fields).
                    linkedModule: selectedMapping?.linkedModule ?? null,
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
                      {activeTab === 'catalog'    && <CatalogTab    key={k} {...ruleProps} />}
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

function HealthPanel({
  health, loading, onTab,
}: {
  health: ServiceHealth | null;
  loading: boolean;
  onTab: (tab: TabKey) => void;
}) {
  const tabMap: Record<string, TabKey> = {
    'Module Mapping': 'mapping',
    Approval: 'approval',
    Workflow: 'workflow',
    Finance: 'finance',
    'Trip & Dispatch': 'trip',
    'Form Fields': 'formFields',
    'Vehicle Rules': 'vehicle',
    Scope: 'basic',
  };

  if (loading) {
    return (
      <div className="px-5 py-3 border-b border-white/5 bg-slate-950/30 text-xs text-slate-500">
        Checking configuration health...
      </div>
    );
  }
  if (!health) return null;

  const tone = health.status === 'BLOCKED'
    ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
    : health.status === 'WARN'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';

  return (
    <div className="px-5 py-3 border-b border-white/5 bg-slate-950/30 space-y-3">
      <div className={`rounded-lg border px-3 py-2 ${tone}`}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <AlertCircle className="w-4 h-4" />
          Config Health: {health.status}
          <span className="ml-auto text-[11px] font-normal opacity-80">
            {health.impact.activeTickets} active ticket(s) · {health.impact.activeWorkflowsWithSteps}/{health.impact.activeWorkflows} active workflow(s) with steps
          </span>
        </div>
      </div>

      {health.issues.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
          {health.issues.slice(0, 6).map(issue => (
            <button
              key={`${issue.code}:${issue.message}`}
              type="button"
              onClick={() => onTab(tabMap[issue.tab] ?? 'basic')}
              className={`text-left rounded-lg border px-3 py-2 text-xs ${
                issue.severity === 'error'
                  ? 'border-rose-500/25 bg-rose-500/5 text-rose-200'
                  : issue.severity === 'warning'
                    ? 'border-amber-500/25 bg-amber-500/5 text-amber-200'
                    : 'border-blue-500/25 bg-blue-500/5 text-blue-200'
              }`}
            >
              <div className="font-semibold">{issue.tab} · {issue.severity.toUpperCase()}</div>
              <div className="mt-0.5 text-slate-300">{issue.message}</div>
            </button>
          ))}
        </div>
      )}

      {health.issues.length === 0 && (
        <div className="text-xs text-emerald-300">No cross-tab configuration gaps detected for this service and scope.</div>
      )}
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
      if (res.status === 428) { setErr(approvalMessage(d)); return; }
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
      if (res.status === 428) { setErr(approvalMessage(d)); return; }
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
      if (res.status === 428) { setMsg(approvalMessage(d)); return; }
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
      if (res.status === 428) { setMsg(approvalMessage(d)); return; }
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
      if (res.status === 428) { setMsg(approvalMessage(d)); return; }
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
          ? 'bg-violet-100 border-violet-300 text-violet-900 shadow-sm'
          : 'bg-slate-800/60 border-white/10 text-slate-400 hover:border-white/20'
      }`}>
      <Icon className={`w-4 h-4 ${checked ? 'text-violet-700' : 'text-slate-500'}`} />
      <span className="flex-1">{label}</span>
      <span className={`w-8 h-4 rounded-full relative ${checked ? 'bg-violet-500' : 'bg-slate-700'}`}>
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${checked ? 'left-4' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

// ── Scope picker ────────────────────────────────────────────────────────────

function ScopePicker({
  scopes, activeScopeId, onChange, showNewScope, onShowNewScope, onScopeCreated, onScopesChanged,
}: {
  scopes: ServiceScope[];
  activeScopeId: string | null;
  onChange: (id: string) => void;
  showNewScope: boolean;
  onShowNewScope: (b: boolean) => void;
  onScopeCreated: () => void;
  onScopesChanged: () => void;
}) {
  const active = scopes.find(s => s.id === activeScopeId);
  const [manageOpen, setManageOpen] = useState(false);
  const activePath = useMemo(() => {
    const byId = new Map(scopes.map(s => [s.id, s]));
    const path: ServiceScope[] = [];
    let cursor = active;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor.id)) {
      path.unshift(cursor);
      guard.add(cursor.id);
      cursor = cursor.parentScopeId ? byId.get(cursor.parentScopeId) : undefined;
    }
    return path;
  }, [active, scopes]);

  return (
    <div className="px-5 py-3 border-b border-white/5 bg-slate-950/40">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Scope</span>
        <select value={activeScopeId ?? ''}
          onChange={e => onChange(e.target.value)}
          className="bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500">
          {scopes.map(s => (
            <option key={s.id} value={s.id}>
              {s.isRoot ? '🏢 ' : '↳ '}
              {s.name}
              {!s.isRoot && ` (${SCOPE_LEVEL_LABEL[s.level]})`}
            </option>
          ))}
        </select>
        {active && !active.isRoot && (
          <span className="text-[11px] text-blue-900 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 border border-blue-300 shadow-sm">
            Editing at {SCOPE_LEVEL_LABEL[active.level]}
          </span>
        )}
        <span className="ml-auto" />
        <button type="button" onClick={() => setManageOpen(v => !v)}
          className="text-xs px-2.5 py-1 rounded-md bg-slate-800/70 hover:bg-slate-800 border border-white/10 text-slate-300 inline-flex items-center gap-1">
          <Settings className="w-3.5 h-3.5" /> Manage
        </button>
        <button type="button" onClick={() => onShowNewScope(true)}
          className="text-xs px-2.5 py-1 rounded-md bg-violet-100 hover:bg-violet-200 border border-violet-300 text-violet-900 shadow-sm inline-flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" /> Add scope
        </button>
      </div>
      {activePath.length > 0 && (
        <div className="pt-2 flex items-center gap-1 flex-wrap text-[11px] text-slate-500">
          <span className="uppercase tracking-wider">Path</span>
          {activePath.map((s, idx) => (
            <span key={s.id} className="inline-flex items-center gap-1">
              {idx > 0 && <ChevronRight className="w-3 h-3 text-slate-600" />}
              <span className={`px-2 py-0.5 rounded-full border ${s.id === activeScopeId ? 'border-blue-300 bg-blue-100 text-blue-900 shadow-sm' : 'border-white/10 bg-slate-800/50 text-slate-400'}`}>
                {s.name}
              </span>
            </span>
          ))}
        </div>
      )}
      {showNewScope && (
        <div className="pt-3">
          <NewScopeForm
            scopes={scopes}
            defaultParentId={activeScopeId ?? scopes.find(s => s.isRoot)?.id ?? ''}
            onCancel={() => onShowNewScope(false)}
            onCreated={onScopeCreated} />
        </div>
      )}
      {manageOpen && active && (
        <ScopeQuickEdit
          scope={active}
          scopes={scopes}
          onChanged={onScopesChanged}
          onDeleted={() => {
            const root = scopes.find(s => s.isRoot);
            if (root) onChange(root.id);
            onScopesChanged();
            setManageOpen(false);
          }} />
      )}
    </div>
  );
}

function ScopeQuickEdit({
  scope, scopes, onChanged, onDeleted,
}: {
  scope: ServiceScope;
  scopes: ServiceScope[];
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(scope.name);
  const [description, setDescription] = useState(scope.description ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setName(scope.name);
    setDescription(scope.description ?? '');
    setMsg(null);
  }, [scope.id, scope.name, scope.description]);

  const save = async () => {
    if (scope.isRoot) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/service-config/scopes/${scope.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 428) { setMsg(approvalMessage(d)); return; }
      if (!res.ok) { setMsg(d?.error ?? 'Update failed'); return; }
      setMsg('Scope updated.');
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (scope.isRoot) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/service-config/scopes/${scope.id}`, { method: 'DELETE' });
      const d = await res.json().catch(() => ({}));
      if (res.status === 428) { setMsg(approvalMessage(d)); return; }
      if (!res.ok) { setMsg(d?.error ?? 'Delete failed'); return; }
      setMsg('Scope deleted.');
      onDeleted();
    } finally {
      setBusy(false);
    }
  };

  const childCount = scopes.filter(s => s.parentScopeId === scope.id).length;

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-slate-900/70 p-3 space-y-2">
      {scope.isRoot ? (
        <div className="text-[11px] text-slate-400">Tenant root scope is the base of the hierarchy and cannot be edited or deleted.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <div className="space-y-1">
              <label className="text-[10px] text-slate-400 uppercase tracking-wide">Scope name</label>
              <input value={name} onChange={e => setName(e.target.value)}
                className="w-full bg-slate-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-slate-400 uppercase tracking-wide">Description</label>
              <input value={description} onChange={e => setDescription(e.target.value)}
                className="w-full bg-slate-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white" />
            </div>
            <div className="flex gap-1">
              <button onClick={save} disabled={busy || !name.trim()}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs disabled:opacity-50">
                <Save className="w-3.5 h-3.5" /> Save
              </button>
              <button onClick={remove} disabled={busy || childCount > 0}
                title={childCount > 0 ? 'Delete child scopes first' : 'Delete scope'}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-200 text-xs disabled:opacity-50">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-500">
            <span>Level: {SCOPE_LEVEL_LABEL[scope.level]}</span>
            <span>Key: <span className="font-mono">{scope.key}</span></span>
            <span>Children: {childCount}</span>
          </div>
        </>
      )}
      {msg && <div className={`text-[11px] ${msg === 'Scope updated.' || msg === 'Scope deleted.' ? 'text-emerald-300' : 'text-amber-300'}`}>{msg}</div>}
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
    if (!name.trim()) { setErr('Name is required'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/admin/service-config/scopes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentScopeId, level,
          key: key.trim() || name.trim(),
          name: name.trim(),
        }),
      });
      const d = await res.json();
      if (res.status === 428) { setErr(approvalMessage(d)); return; }
      if (!res.ok) { setErr(d?.error ?? 'Create failed'); return; }
      onCreated();
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-slate-800/60 border border-violet-500/30 rounded-lg p-3 space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] text-slate-400 uppercase tracking-wide">Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Dubai Branch"
            className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1.5 text-xs text-white" />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-slate-400 uppercase tracking-wide">Key</label>
          <input value={key} onChange={e => setKey(e.target.value)} placeholder="auto"
            className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1.5 text-xs text-white font-mono uppercase" />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-slate-400 uppercase tracking-wide">Level</label>
          <select value={level} onChange={e => setLevel(e.target.value as ScopeLevel)}
            className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1.5 text-xs text-white">
            {SCOPE_LEVELS.filter(l => l !== 'COMPANY').map(l => (
              <option key={l} value={l}>{SCOPE_LEVEL_LABEL[l]}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-slate-400 uppercase tracking-wide">Parent</label>
          <select value={parentScopeId} onChange={e => setParentScopeId(e.target.value)}
            className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1.5 text-xs text-white">
            {scopes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      {err && <div className="text-[10px] text-rose-300">{err}</div>}
      <div className="flex gap-1">
        <button onClick={submit} disabled={busy} className="px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs disabled:opacity-50">
          {busy ? 'Adding…' : 'Add scope'}
        </button>
        <button onClick={onCancel} className="px-2 py-1.5 rounded text-slate-400 hover:text-white text-xs">Cancel</button>
      </div>
    </div>
  );
}
