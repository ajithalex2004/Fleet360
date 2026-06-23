'use client';

import { PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';
import { getClientMe, type ClientMeResponse } from '@/lib/client-session';
import {
  Columns3,
  Database,
  Eye,
  EyeOff,
  LayoutList,
  Save,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

type ScopeMode = 'tenant' | 'platform';
type ModulePreset = 'admin' | 'manager' | 'operator' | 'viewer';
type MessageTone = 'success' | 'error' | 'info';

interface DatasetField {
  key: string;
  label: string;
  type: string;
  groupable?: boolean;
  aggregatable?: boolean;
}

interface RegistryDataset {
  key: string;
  label: string;
  module: string;
  description: string;
  defaultColumns: string[];
  fields: DatasetField[];
}

interface CatalogEntry {
  key: string;
  enabled: boolean;
  label: string;
  description: string;
  visibleFields: string[];
  defaultColumns: string[];
  allowedRoleCodes: string[];
  allowedModulePresets: ModulePreset[];
}

type DatasetCatalog = Record<string, CatalogEntry>;

interface RoleOption {
  code: string;
  name: string;
  description: string;
}

interface PresetOption {
  key: ModulePreset;
  label: string;
  description: string;
}

interface CatalogResponse {
  scope: ScopeMode;
  tenantId?: string;
  catalog: DatasetCatalog;
  registry: RegistryDataset[];
  roleOptions: RoleOption[];
  modulePresetOptions: PresetOption[];
  error?: string;
}

function cloneCatalog(catalog: DatasetCatalog): DatasetCatalog {
  return JSON.parse(JSON.stringify(catalog)) as DatasetCatalog;
}

function MessageBanner({ tone, message }: { tone: MessageTone; message: string }) {
  const cls =
    tone === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      : tone === 'error'
        ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
        : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200';
  return <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${cls}`}>{message}</div>;
}

function SummaryTile({ label, value, hint }: { label: string; value: number | string; hint: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{hint}</p>
    </div>
  );
}

function PillButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
        active
          ? 'border-violet-400 bg-violet-500 text-white shadow-lg shadow-violet-500/20'
          : 'border-white/10 bg-slate-900 text-slate-200 hover:border-violet-400/60 hover:bg-violet-500/10'
      }`}
    >
      {children}
    </button>
  );
}

export default function DatasetCatalogAdminPage() {
  const [me, setMe] = useState<ClientMeResponse | null>(null);
  const [scope, setScope] = useState<ScopeMode>('tenant');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: MessageTone; text: string } | null>(null);
  const [registry, setRegistry] = useState<RegistryDataset[]>([]);
  const [catalog, setCatalog] = useState<DatasetCatalog>({});
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [presetOptions, setPresetOptions] = useState<PresetOption[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [query, setQuery] = useState('');

  const canEditPlatform = me?.isSuperAdmin ?? false;

  const load = useCallback(async (mode: ScopeMode) => {
    setLoading(true);
    setMessage(null);
    try {
      const meData = await getClientMe();
      setMe(meData);
      const qs = new URLSearchParams({ scope: mode });
      const res = await fetch(`/api/admin/reports/datasets?${qs.toString()}`, { cache: 'no-store' });
      const data = (await res.json()) as CatalogResponse;
      if (!res.ok) throw new Error(data.error ?? 'Failed to load dataset catalog');
      setRegistry(data.registry ?? []);
      setCatalog(cloneCatalog(data.catalog ?? {}));
      setRoleOptions(data.roleOptions ?? []);
      setPresetOptions(data.modulePresetOptions ?? []);
      setSelectedKey((current) => current && data.catalog?.[current] ? current : data.registry?.[0]?.key ?? '');
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to load dataset catalog' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(scope);
  }, [load, scope]);

  const selectedRegistry = registry.find((dataset) => dataset.key === selectedKey) ?? registry[0];
  const selected = selectedRegistry ? catalog[selectedRegistry.key] : null;

  const filteredRegistry = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return registry;
    return registry.filter((dataset) => {
      const entry = catalog[dataset.key];
      return [
        dataset.label,
        dataset.module,
        dataset.key,
        entry?.label,
        entry?.description,
      ].some((value) => String(value ?? '').toLowerCase().includes(needle));
    });
  }, [catalog, query, registry]);

  const summary = useMemo(() => {
    const entries = Object.values(catalog);
    const enabled = entries.filter((entry) => entry.enabled).length;
    const visibleFields = entries.reduce((sum, entry) => sum + entry.visibleFields.length, 0);
    const restricted = entries.filter((entry) => entry.allowedRoleCodes.length < roleOptions.length).length;
    return { total: entries.length, enabled, visibleFields, restricted };
  }, [catalog, roleOptions.length]);

  const updateSelected = (patch: Partial<CatalogEntry>) => {
    if (!selectedRegistry || !selected) return;
    setCatalog((current) => ({
      ...current,
      [selectedRegistry.key]: {
        ...selected,
        ...patch,
      },
    }));
  };

  const toggleField = (fieldKey: string) => {
    if (!selected) return;
    const exists = selected.visibleFields.includes(fieldKey);
    const visibleFields = exists
      ? selected.visibleFields.filter((key) => key !== fieldKey)
      : [...selected.visibleFields, fieldKey];
    updateSelected({
      visibleFields,
      defaultColumns: selected.defaultColumns.filter((key) => visibleFields.includes(key)),
    });
  };

  const toggleDefaultColumn = (fieldKey: string) => {
    if (!selected || !selected.visibleFields.includes(fieldKey)) return;
    updateSelected({
      defaultColumns: selected.defaultColumns.includes(fieldKey)
        ? selected.defaultColumns.filter((key) => key !== fieldKey)
        : [...selected.defaultColumns, fieldKey],
    });
  };

  const toggleRole = (roleCode: string) => {
    if (!selected) return;
    updateSelected({
      allowedRoleCodes: selected.allowedRoleCodes.includes(roleCode)
        ? selected.allowedRoleCodes.filter((code) => code !== roleCode)
        : [...selected.allowedRoleCodes, roleCode],
    });
  };

  const togglePreset = (preset: ModulePreset) => {
    if (!selected) return;
    updateSelected({
      allowedModulePresets: selected.allowedModulePresets.includes(preset)
        ? selected.allowedModulePresets.filter((key) => key !== preset)
        : [...selected.allowedModulePresets, preset],
    });
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const qs = new URLSearchParams({ scope });
      const res = await fetch(`/api/admin/reports/datasets?${qs.toString()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalog }),
      });
      const data = (await res.json()) as CatalogResponse;
      if (!res.ok) throw new Error(data.error ?? 'Failed to save dataset catalog');
      setCatalog(cloneCatalog(data.catalog));
      setRegistry(data.registry ?? registry);
      setMessage({ tone: 'success', text: 'Dataset catalog saved and applied to Dynamic Reports.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to save dataset catalog' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="space-y-6">
      <PageHeader
        title="Dataset Catalog"
        subtitle="Govern Dynamic Reports datasets, labels, visible fields, and role access across tenants."
        icon={Database}
        accent="violet"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PillButton active={scope === 'tenant'} onClick={() => setScope('tenant')}>
              Tenant catalog
            </PillButton>
            {canEditPlatform && (
              <PillButton active={scope === 'platform'} onClick={() => setScope('platform')}>
                Platform defaults
              </PillButton>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving || loading}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-100 px-4 py-2 text-sm font-semibold text-blue-950 shadow-lg shadow-emerald-500/10 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save catalog'}
            </button>
          </div>
        }
      />

      {message && <MessageBanner tone={message.tone} message={message.text} />}

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryTile label="Datasets" value={summary.total} hint="Registered report sources" />
        <SummaryTile label="Enabled" value={summary.enabled} hint="Visible to permitted users" />
        <SummaryTile label="Fields" value={summary.visibleFields} hint="Visible fields across catalog" />
        <SummaryTile label="Restricted" value={summary.restricted} hint="Role-filtered datasets" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Panel title="Datasets" subtitle="Select a dataset to configure its report builder surface." icon={LayoutList} accent="blue">
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search datasets..."
              className="w-full bg-transparent text-sm font-medium text-white placeholder-slate-500 outline-none"
            />
          </div>

          <div className="space-y-3">
            {loading ? (
              [...Array(4)].map((_, index) => (
                <div key={index} className="h-24 animate-pulse rounded-2xl bg-slate-900/70" />
              ))
            ) : filteredRegistry.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm text-slate-400">No datasets match your search.</div>
            ) : (
              filteredRegistry.map((dataset) => {
                const entry = catalog[dataset.key];
                const active = dataset.key === selectedRegistry?.key;
                return (
                  <button
                    type="button"
                    key={dataset.key}
                    onClick={() => setSelectedKey(dataset.key)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      active
                        ? 'border-violet-400 bg-violet-500/15 shadow-lg shadow-violet-500/10'
                        : 'border-white/10 bg-slate-900/60 hover:border-violet-400/50 hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-white">{entry?.label ?? dataset.label}</p>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{dataset.module}</p>
                      </div>
                      <StatusPill status={entry?.enabled ? 'active' : 'cancelled'} label={entry?.enabled ? 'Enabled' : 'Disabled'} />
                    </div>
                    <p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-400">{entry?.description ?? dataset.description}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-slate-400">
                      <span className="rounded-full bg-slate-800 px-2 py-1">{entry?.visibleFields.length ?? dataset.fields.length} fields</span>
                      <span className="rounded-full bg-slate-800 px-2 py-1">{entry?.allowedRoleCodes.length ?? 0} roles</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </Panel>

        <Panel
          title={selected?.label ?? 'Dataset details'}
          subtitle={selectedRegistry ? `${selectedRegistry.module} - ${selectedRegistry.key}` : 'Choose a dataset to configure'}
          icon={Columns3}
          accent="violet"
          actions={selected && (
            <button
              type="button"
              onClick={() => updateSelected({ enabled: !selected.enabled })}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                selected.enabled
                  ? 'border-emerald-300 bg-emerald-100 text-blue-950 hover:bg-emerald-200'
                  : 'border-slate-300 bg-slate-100 text-blue-950 hover:bg-white'
              }`}
            >
              {selected.enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              {selected.enabled ? 'Enabled' : 'Disabled'}
            </button>
          )}
        >
          {!selected || !selectedRegistry ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-slate-400">
              Select a dataset to manage labels, columns, and access.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Display label</span>
                  <input
                    value={selected.label}
                    onChange={(event) => updateSelected({ label: event.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm font-semibold text-white outline-none focus:border-violet-400"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Dataset key</span>
                  <input
                    value={selected.key}
                    readOnly
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-400 outline-none"
                  />
                </label>
              </div>

              <label className="space-y-2 block">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Description</span>
                <textarea
                  value={selected.description}
                  onChange={(event) => updateSelected({ description: event.target.value })}
                  rows={3}
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm font-medium leading-6 text-white outline-none focus:border-violet-400"
                />
              </label>

              <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="mb-4">
                  <h3 className="text-sm font-bold text-white">Visible fields and default columns</h3>
                  <p className="mt-1 text-xs text-slate-400">Visible fields control what users can query. Default columns control the first report layout.</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {selectedRegistry.fields.map((field) => {
                    const visible = selected.visibleFields.includes(field.key);
                    const isDefault = selected.defaultColumns.includes(field.key);
                    return (
                      <div
                        key={field.key}
                        className={`rounded-xl border p-3 transition ${
                          visible ? 'border-cyan-400/30 bg-cyan-500/10' : 'border-white/10 bg-slate-900/60'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <label className="flex min-w-0 cursor-pointer items-start gap-2">
                            <input
                              type="checkbox"
                              checked={visible}
                              onChange={() => toggleField(field.key)}
                              className="mt-1 h-4 w-4 rounded border-slate-500 accent-violet-500"
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-white">{field.label}</span>
                              <span className="block truncate text-[11px] text-slate-500">{field.key} - {field.type}</span>
                            </span>
                          </label>
                        </div>
                        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-300">
                          <input
                            type="checkbox"
                            disabled={!visible}
                            checked={visible && isDefault}
                            onChange={() => toggleDefaultColumn(field.key)}
                            className="h-4 w-4 rounded border-slate-500 accent-emerald-500 disabled:opacity-40"
                          />
                          Default column
                        </label>
                      </div>
                    );
                  })}
                </div>
              </section>

              <div className="grid gap-5 lg:grid-cols-2">
                <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <div className="mb-4 flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-300" />
                    <div>
                      <h3 className="text-sm font-bold text-white">Allowed tenant roles</h3>
                      <p className="mt-1 text-xs text-slate-400">RBAC role codes that can use this dataset.</p>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    {roleOptions.map((role) => (
                      <label key={role.code} className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-slate-900/60 p-3 hover:border-violet-400/40">
                        <input
                          type="checkbox"
                          checked={selected.allowedRoleCodes.includes(role.code)}
                          onChange={() => toggleRole(role.code)}
                          className="mt-1 h-4 w-4 rounded border-slate-500 accent-violet-500"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-white">{role.name}</span>
                          <span className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{role.code}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </section>

                <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <div className="mb-4">
                    <h3 className="text-sm font-bold text-white">Allowed Reports module presets</h3>
                    <p className="mt-1 text-xs text-slate-400">Module Access presets that can use this dataset even without a named RBAC role.</p>
                  </div>
                  <div className="grid gap-3">
                    {presetOptions.map((preset) => (
                      <label key={preset.key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-slate-900/60 p-3 hover:border-emerald-400/40">
                        <input
                          type="checkbox"
                          checked={selected.allowedModulePresets.includes(preset.key)}
                          onChange={() => togglePreset(preset.key)}
                          className="mt-1 h-4 w-4 rounded border-slate-500 accent-emerald-500"
                        />
                        <span>
                          <span className="block text-sm font-semibold text-white">{preset.label}</span>
                          <span className="mt-1 block text-xs leading-5 text-slate-400">{preset.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </main>
  );
}
