'use client';
/**
 * Module + feature flag picker for a tenant. Used by the Create Tenant
 * modal and the tenant Manage page, so both show every module in the
 * registry (@/lib/modules) with the flags mapped to it
 * (@/lib/module-features).
 *
 * Always-on modules are shown ticked and cannot be cleared (the API adds
 * them anyway). A module's flags can be set while it is off; they only take
 * effect once the module is enabled.
 */
import React, { useState } from 'react';
import { MODULES, MODULE_BY_KEY, type ModuleDef, type ModuleKey } from '@/lib/modules';
import { FEATURES_BY_MODULE, activeFeatureKeys, type FeatureFlagMap } from '@/lib/module-features';

interface ModuleGroupSpec {
  label: string;
  icon: string;
  color: keyof typeof GROUP_STYLE;
  description: string;
  keys: readonly ModuleKey[];
}

const GROUP_STYLE = {
  blue:    { card: 'border-blue-500/30 bg-blue-500/5',       icon: 'bg-blue-500/20 text-blue-300',       accent: 'accent-blue-400' },
  emerald: { card: 'border-emerald-500/30 bg-emerald-500/5', icon: 'bg-emerald-500/20 text-emerald-300', accent: 'accent-emerald-400' },
  rose:    { card: 'border-rose-500/30 bg-rose-500/5',       icon: 'bg-rose-500/20 text-rose-300',       accent: 'accent-rose-400' },
  teal:    { card: 'border-teal-500/30 bg-teal-500/5',       icon: 'bg-teal-500/20 text-teal-300',       accent: 'accent-teal-400' },
  violet:  { card: 'border-violet-500/30 bg-violet-500/5',   icon: 'bg-violet-500/20 text-violet-300',   accent: 'accent-violet-400' },
  amber:   { card: 'border-amber-500/30 bg-amber-500/5',     icon: 'bg-amber-500/20 text-amber-300',     accent: 'accent-amber-400' },
  slate:   { card: 'border-slate-500/30 bg-slate-500/5',     icon: 'bg-slate-500/20 text-slate-300',     accent: 'accent-slate-400' },
} as const;

/** Visual buckets in curated order. Modules missing from every group land in "Other". */
const MODULE_GROUP_SPECS: readonly ModuleGroupSpec[] = [
  { label: 'Booking & Transport', icon: '🚗', color: 'blue',
    description: 'Rentals, leases, shuttles, school runs, freight and self-service booking',
    keys: ['rental', 'leasing', 'bus-ops', 'school-bus', 'logistics', 'booking-portal'] },
  { label: 'Fleet Management', icon: '🚌', color: 'emerald',
    description: 'Vehicles, drivers, assets and the work that keeps them moving',
    keys: ['fleet', 'maintenance', 'driver-mgmt', 'assets'] },
  { label: 'Operations & Emergency', icon: '🚨', color: 'rose',
    description: 'Dispatch control, incidents, ambulance and service tickets',
    keys: ['dispatch', 'incidents', 'service-tickets'] },
  { label: 'Customers & Apps', icon: '📱', color: 'teal',
    description: 'Customer master data, the customer app and the mobile PWAs',
    keys: ['customer-mgmt', 'customer', 'mobile-apps'] },
  { label: 'Finance & Compliance', icon: '💼', color: 'violet',
    description: 'Invoicing, regulatory tracking and ESG reporting',
    keys: ['finance', 'compliance', 'sustainability'] },
  { label: 'Analytics & AI', icon: '📊', color: 'amber',
    description: 'Cross-module reporting and the AI agent ecosystem',
    keys: ['reports', 'agents'] },
];

export interface ModuleGroup {
  spec: ModuleGroupSpec;
  modules: ModuleDef[];
}

export const MODULE_GROUPS: readonly ModuleGroup[] = (() => {
  const grouped = new Set<string>(MODULE_GROUP_SPECS.flatMap((g) => g.keys));
  const groups: ModuleGroup[] = MODULE_GROUP_SPECS.map((spec) => ({
    spec,
    modules: spec.keys.map((k) => MODULE_BY_KEY[k]).filter(Boolean),
  }));
  const other = MODULES.filter((m) => !grouped.has(m.key));
  if (other.length > 0) {
    groups.push({
      spec: { label: 'Other', icon: '🧩', color: 'slate', description: 'Other platform modules', keys: other.map((m) => m.key) },
      modules: other,
    });
  }
  return groups;
})();

/** Every registry module key, in the order the picker shows them. */
export const ALL_MODULE_KEYS: readonly ModuleKey[] = MODULE_GROUPS.flatMap((g) => g.modules.map((m) => m.key));

const isAlwaysOn = (m: ModuleDef) => m.subscription === 'always-on';

interface Props {
  /** Canonical module keys; non-module keys such as 'admin' are ignored. */
  enabledModules: readonly string[];
  featureFlags: FeatureFlagMap;
  onModulesChange: (next: string[]) => void;
  onFlagsChange: (next: FeatureFlagMap) => void;
  /** Tenant plan, used to mark enterprise-only modules as add-ons. */
  plan?: string;
}

export function ModuleFeaturePicker({ enabledModules, featureFlags, onModulesChange, onFlagsChange, plan }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const enabled = new Set(enabledModules);
  // Always-on modules count as enabled whether or not the caller lists them.
  for (const m of MODULES) if (isAlwaysOn(m)) enabled.add(m.key);

  const enabledCount = ALL_MODULE_KEYS.filter((k) => enabled.has(k)).length;
  const activeFlagCount = activeFeatureKeys(enabled, featureFlags).length;

  const setModules = (keys: Set<string>) => onModulesChange([...keys]);
  const toggleModule = (key: ModuleKey) => {
    const next = new Set(enabled);
    if (next.has(key)) next.delete(key); else next.add(key);
    setModules(next);
  };
  const toggleGroup = (group: ModuleGroup, on: boolean) => {
    const next = new Set(enabled);
    for (const m of group.modules) {
      if (isAlwaysOn(m)) continue;
      if (on) next.add(m.key); else next.delete(m.key);
    }
    setModules(next);
  };
  const setFlag = (key: string, value: boolean) => onFlagsChange({ ...featureFlags, [key]: value });
  const setModuleFlags = (key: ModuleKey, value: boolean) =>
    onFlagsChange({ ...featureFlags, ...Object.fromEntries(FEATURES_BY_MODULE[key].map((d) => [d.key, value])) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          {enabledCount} of {ALL_MODULE_KEYS.length} modules enabled
        </span>
        <span className="px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
          ⚡ {activeFlagCount} feature flags active
        </span>
        <span className="text-[var(--text-faint)]">Expand a module to choose its feature flags.</span>
      </div>

      {MODULE_GROUPS.map((group) => {
        const style = GROUP_STYLE[group.spec.color];
        const toggleable = group.modules.filter((m) => !isAlwaysOn(m));
        const allOn = toggleable.length > 0 && toggleable.every((m) => enabled.has(m.key));
        return (
          <div key={group.spec.label} className={`rounded-xl border p-4 ${style.card}`}>
            <div className="flex items-center justify-between mb-3 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0 ${style.icon}`}>
                  {group.spec.icon}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--text-main)]">{group.spec.label}</div>
                  <div className="text-[11px] text-[var(--text-faint)] leading-tight">{group.spec.description}</div>
                </div>
              </div>
              {toggleable.length > 0 && (
                <button type="button" onClick={() => toggleGroup(group, !allOn)}
                  className="text-xs text-blue-400 hover:text-blue-300 flex-shrink-0">
                  {allOn ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>

            <div className="space-y-2">
              {group.modules.map((m) => {
                const on = enabled.has(m.key);
                const locked = isAlwaysOn(m);
                const flags = FEATURES_BY_MODULE[m.key];
                const flagsOn = flags.filter((d) => featureFlags[d.key]).length;
                const open = !!expanded[m.key];
                return (
                  <div key={m.key}
                    className={`rounded-lg border transition-all ${on
                      ? 'border-[var(--border-strong)] bg-[var(--bg-surface-hover)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]/40'}`}>
                    <div className="flex items-start gap-3 p-2.5">
                      <input type="checkbox" checked={on} disabled={locked}
                        onChange={() => toggleModule(m.key)}
                        aria-label={`Enable ${m.name}`}
                        className={`mt-0.5 w-4 h-4 flex-shrink-0 ${style.accent} ${locked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`} />
                      <button type="button" onClick={() => setExpanded((p) => ({ ...p, [m.key]: !p[m.key] }))}
                        className="flex-1 min-w-0 text-left">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-[var(--text-main)]">{m.name}</span>
                          {locked && <Badge className="bg-slate-500/20 text-slate-300 border-slate-500/30">Always on</Badge>}
                          {m.subscription === 'enterprise-only' && (
                            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30">
                              {plan === 'ENTERPRISE' ? 'Enterprise' : 'Enterprise add-on'}
                            </Badge>
                          )}
                          {m.status !== 'live' && <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30">{m.status.toUpperCase()}</Badge>}
                        </div>
                        <div className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2">{m.description}</div>
                      </button>
                      {flags.length > 0 && (
                        <button type="button" onClick={() => setExpanded((p) => ({ ...p, [m.key]: !p[m.key] }))}
                          className="flex items-center gap-1.5 flex-shrink-0 text-[11px] px-2 py-1 rounded-md border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
                          aria-expanded={open} aria-label={`${m.name} feature flags`}>
                          ⚡ {flagsOn}/{flags.length}
                          <span className="text-[9px]">{open ? '▲' : '▼'}</span>
                        </button>
                      )}
                    </div>

                    {open && flags.length > 0 && (
                      <div className="border-t border-[var(--border-subtle)] px-3 py-2.5 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
                            Feature flags {on ? '' : '— take effect when the module is enabled'}
                          </span>
                          <button type="button" onClick={() => setModuleFlags(m.key, flagsOn < flags.length)}
                            className="text-[11px] text-blue-400 hover:text-blue-300">
                            {flagsOn < flags.length ? 'Enable all' : 'Disable all'}
                          </button>
                        </div>
                        {flags.map((d) => (
                          <label key={d.key}
                            className={`flex items-start gap-3 p-2 rounded-md cursor-pointer hover:bg-[var(--bg-surface)]/60 ${on ? '' : 'opacity-60'}`}>
                            <Switch checked={!!featureFlags[d.key]} onChange={(v) => setFlag(d.key, v)} label={d.name} />
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-[var(--text-main)]">{d.name}</div>
                              <div className="text-[11px] text-[var(--text-muted)]">{d.description}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Read-only view of a tenant's enabled modules and the feature flags active
 * on each (Manage page summary).
 */
export function TenantModuleFeatureSummary({ enabledModules, featureFlags }: {
  enabledModules: readonly string[];
  featureFlags: FeatureFlagMap;
}) {
  const enabled = new Set(enabledModules);
  for (const m of MODULES) if (isAlwaysOn(m)) enabled.add(m.key);
  const mods = ALL_MODULE_KEYS.filter((k) => enabled.has(k)).map((k) => MODULE_BY_KEY[k]);
  if (mods.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">No modules enabled.</p>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {mods.map((m) => {
        const active = FEATURES_BY_MODULE[m.key].filter((d) => featureFlags[d.key]);
        return (
          <div key={m.key} className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-[var(--text-main)]">{m.name}</span>
              <span className="text-[10px] text-emerald-400 flex-shrink-0">
                {isAlwaysOn(m) ? 'ALWAYS ON' : 'ENABLED'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {active.length === 0
                ? <span className="text-[11px] text-[var(--text-faint)]">No feature flags active</span>
                : active.map((d) => (
                    <span key={d.key}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      ⚡ {d.name}
                    </span>
                  ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${className}`}>{children}</span>;
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="relative inline-flex flex-shrink-0 mt-0.5">
      <input type="checkbox" role="switch" className="sr-only peer" checked={checked}
        onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="w-8 h-4 rounded-full bg-[var(--border-strong)] peer-checked:bg-emerald-500 transition-colors" />
      <span className="absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
    </span>
  );
}
