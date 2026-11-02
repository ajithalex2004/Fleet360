'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { RefreshCw, Server, Database, Layers, Radio, Bell, Search, ExternalLink } from 'lucide-react';

interface ModuleInfo {
  id: string;
  name: string;
  path: string;
  color: string;
  description: string;
}

interface ApiGroup {
  module: string;
  base: string;
  count: number;
  endpoints: string[];
}

interface DbGroup {
  category: string;
  models: string[];
}

interface Channel {
  id: string;
  name: string;
  icon: string;
  description: string;
  status: string;
  configPath: string;
}

interface RedisStatus {
  configured: boolean;
  reachable: boolean;
  roundTripMs: number | null;
  host: string | null;
  error: string | null;
  checkedAt: string;
}

interface InfoData {
  platform: {
    name: string;
    version: string;
    stack: string;
    modules: number;
    totalApiEndpoints: number;
    totalDbModels: number;
    notificationChannels: number;
  };
  modules: ModuleInfo[];
  apiEndpoints: ApiGroup[];
  dbModels: DbGroup[];
  notificationChannels: Channel[];
  dbStats: Record<string, number>;
  redis?: RedisStatus;
}

const TABS = ['overview', 'modules', 'api', 'db-models', 'notifications'] as const;
type SubTab = (typeof TABS)[number];

export function PlatformInfoTab() {
  const [data, setData] = useState<InfoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<SubTab>('overview');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/info');
      const d = await res.json();
      setData(d);
    } catch (err) {
      console.error('[PlatformInfoTab] load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="py-16 flex flex-col items-center justify-center space-y-3">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
        <div className="text-sm font-semibold text-[var(--text-muted)]">Loading Platform Architecture & Registry...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-300 space-y-3">
        <p className="font-semibold text-sm">Failed to query platform information</p>
        <button
          onClick={load}
          className="px-4 py-2 rounded-xl bg-rose-500 text-white text-xs font-semibold hover:bg-rose-600 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const { platform, modules, apiEndpoints, dbModels, notificationChannels, dbStats, redis } = data;

  const TAB_LABELS: Record<SubTab, string> = {
    overview: 'Overview',
    modules: `Modules (${modules.length})`,
    api: `API Endpoints (${platform.totalApiEndpoints})`,
    'db-models': `DB Models (${platform.totalDbModels})`,
    notifications: `Notification Channels (${platform.notificationChannels})`,
  };

  return (
    <div className="space-y-6">
      {/* Subheader action bar */}
      <div className="flex items-center justify-between flex-wrap gap-3 pb-2 border-b border-[var(--border-subtle)]">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-main)] flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-400" />
            <span>Platform Topology & Architecture</span>
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {platform.name} v{platform.version} &bull; Stack: {platform.stack}
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]/80 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Metadata</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Platform Modules', value: platform.modules, color: 'from-blue-600 to-indigo-700', icon: Layers },
          { label: 'API Endpoints', value: platform.totalApiEndpoints, color: 'from-emerald-600 to-teal-700', icon: Radio },
          { label: 'Database Models', value: platform.totalDbModels, color: 'from-violet-600 to-purple-700', icon: Database },
          { label: 'Notification Channels', value: platform.notificationChannels, color: 'from-amber-600 to-orange-700', icon: Bell },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className={`rounded-2xl bg-gradient-to-br ${color} p-5 text-white shadow-md relative overflow-hidden`}>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-white/80 font-semibold">{label}</span>
              <Icon className="w-4 h-4 text-white/70" />
            </div>
            <div className="text-3xl font-extrabold mt-2 font-mono">{value}</div>
          </div>
        ))}
      </div>

      {/* Upstash Redis Session Cache Card */}
      {redis && (
        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-base">⚡</span>
              <h3 className="text-sm font-semibold text-[var(--text-main)]">Upstash Redis Session State</h3>
            </div>
            <span
              className={`px-3 py-1 rounded-full border text-xs font-semibold ${
                redis.configured && redis.reachable
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
              }`}
            >
              {redis.configured ? (redis.reachable ? 'Connected (PING → PONG)' : 'Unreachable') : 'Not Configured'}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="bg-[var(--bg-surface-hover)]/60 rounded-xl p-3 border border-[var(--border-subtle)]">
              <div className="text-[var(--text-muted)]">Round-Trip Latency</div>
              <div className="text-sm font-bold text-[var(--text-main)] mt-0.5 font-mono">
                {redis.roundTripMs != null ? `${redis.roundTripMs} ms` : '—'}
              </div>
            </div>
            <div className="bg-[var(--bg-surface-hover)]/60 rounded-xl p-3 border border-[var(--border-subtle)]">
              <div className="text-[var(--text-muted)]">Instance Host</div>
              <div className="text-xs font-semibold text-[var(--text-main)] mt-0.5 truncate font-mono">
                {redis.host ?? '—'}
              </div>
            </div>
            <div className="bg-[var(--bg-surface-hover)]/60 rounded-xl p-3 border border-[var(--border-subtle)]">
              <div className="text-[var(--text-muted)]">Session Revocation</div>
              <div className="text-sm font-bold text-emerald-400 mt-0.5">&le; 60 Seconds</div>
            </div>
            <div className="bg-[var(--bg-surface-hover)]/60 rounded-xl p-3 border border-[var(--border-subtle)]">
              <div className="text-[var(--text-muted)]">Last Verified</div>
              <div className="text-xs font-semibold text-[var(--text-muted)] mt-0.5">
                {new Date(redis.checkedAt).toLocaleTimeString()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Live Database Record Counts */}
      <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-400" />
            <span>Live Database Table Populations (PostgreSQL)</span>
          </div>
          <span className="text-xs text-[var(--text-faint)]">Active schema objects</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {Object.entries(dbStats).map(([key, val]) => (
            <div key={key} className="bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-[var(--text-main)] font-mono">{val.toLocaleString()}</div>
              <div className="text-xs text-[var(--text-muted)] mt-0.5 capitalize truncate">
                {key.replace(/([A-Z])/g, ' $1').trim()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Internal Navigation Subtabs */}
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] flex-wrap gap-3 pt-2">
        <div className="flex gap-2 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => {
                setSubTab(t);
                setSearch('');
              }}
              className={`px-4 py-2.5 text-xs font-semibold transition-all border-b-2 -mb-px whitespace-nowrap ${
                subTab === t
                  ? 'text-blue-400 border-blue-500'
                  : 'text-[var(--text-muted)] border-transparent hover:text-[var(--text-main)]'
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {subTab !== 'overview' && (
          <div className="relative pb-2">
            <Search className="w-3.5 h-3.5 text-[var(--text-faint)] absolute left-3 top-3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Filter ${subTab}...`}
              className="pl-9 pr-3 py-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:ring-1 focus:ring-blue-500/50 w-56"
            />
          </div>
        )}
      </div>

      {/* SUBTAB: MODULES */}
      {subTab === 'modules' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {modules
            .filter(
              (m) =>
                !search ||
                m.name.toLowerCase().includes(search.toLowerCase()) ||
                m.description.toLowerCase().includes(search.toLowerCase())
            )
            .map((m) => (
              <Link
                key={m.id}
                href={m.path}
                className="block bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-5 hover:border-blue-500/40 hover:bg-[var(--bg-surface-hover)] transition-all group"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div
                    className={`w-9 h-9 rounded-xl bg-gradient-to-br ${m.color} flex items-center justify-center text-white font-bold text-sm shadow-sm`}
                  >
                    {m.name[0]}
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-sm text-[var(--text-main)] group-hover:text-blue-400 transition-colors">
                      {m.name}
                    </div>
                    <div className="text-xs font-mono text-[var(--text-faint)]">{m.path}</div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-[var(--text-faint)] group-hover:text-blue-400 transition-colors" />
                </div>
                <p className="text-xs text-[var(--text-muted)] line-clamp-2">{m.description}</p>
              </Link>
            ))}
        </div>
      )}

      {/* SUBTAB: API ENDPOINTS */}
      {subTab === 'api' && (
        <div className="space-y-4">
          {apiEndpoints
            .filter(
              (g) =>
                !search ||
                g.module.toLowerCase().includes(search.toLowerCase()) ||
                g.endpoints.some((e) => e.toLowerCase().includes(search.toLowerCase()))
            )
            .map((g) => (
              <div key={g.module} className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-sm text-[var(--text-main)]">{g.module}</span>
                    <span className="ml-2 text-xs font-mono text-[var(--text-faint)]">{g.base}</span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/30">
                    {g.count} endpoints
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {g.endpoints
                    .filter((e) => !search || e.toLowerCase().includes(search.toLowerCase()))
                    .map((ep) => (
                      <span
                        key={ep}
                        className="text-xs font-mono px-2.5 py-1 rounded-lg bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border border-[var(--border-subtle)]"
                      >
                        {ep}
                      </span>
                    ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* SUBTAB: DB MODELS */}
      {subTab === 'db-models' && (
        <div className="space-y-4">
          {dbModels
            .filter(
              (g) =>
                !search ||
                g.category.toLowerCase().includes(search.toLowerCase()) ||
                g.models.some((m) => m.toLowerCase().includes(search.toLowerCase()))
            )
            .map((g) => (
              <div key={g.category} className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-[var(--text-main)]">{g.category}</span>
                  <span className="text-xs text-[var(--text-faint)]">{g.models.length} Prisma models</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {g.models
                    .filter((m) => !search || m.toLowerCase().includes(search.toLowerCase()))
                    .map((model) => (
                      <span
                        key={model}
                        className="text-xs font-mono px-2.5 py-1.5 rounded-lg bg-violet-500/10 text-violet-300 border border-violet-500/20"
                      >
                        {model}
                      </span>
                    ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* SUBTAB: NOTIFICATIONS */}
      {subTab === 'notifications' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {notificationChannels
            .filter(
              (ch) =>
                !search ||
                ch.name.toLowerCase().includes(search.toLowerCase()) ||
                ch.description.toLowerCase().includes(search.toLowerCase())
            )
            .map((ch) => (
              <div key={ch.id} className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] flex items-center justify-center text-lg">
                      {ch.icon}
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-[var(--text-main)]">{ch.name}</div>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${
                          ch.status === 'active'
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                        }`}
                      >
                        {ch.status === 'active' ? 'Active' : 'Configurable'}
                      </span>
                    </div>
                  </div>
                  <Link
                    href={ch.configPath}
                    className="text-xs text-blue-400 hover:text-blue-300 font-semibold hover:underline flex items-center gap-1"
                  >
                    Configure &rarr;
                  </Link>
                </div>
                <p className="text-xs text-[var(--text-muted)]">{ch.description}</p>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
