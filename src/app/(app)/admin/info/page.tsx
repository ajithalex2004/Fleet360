'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface ModuleInfo   { id: string; name: string; path: string; color: string; description: string; }
interface ApiGroup     { module: string; base: string; count: number; endpoints: string[]; }
interface DbGroup      { category: string; models: string[]; }
interface Channel      { id: string; name: string; icon: string; description: string; status: string; configPath: string; }
interface InfoData {
  platform: { name: string; version: string; stack: string; modules: number; totalApiEndpoints: number; totalDbModels: number; notificationChannels: number; };
  modules: ModuleInfo[];
  apiEndpoints: ApiGroup[];
  dbModels: DbGroup[];
  notificationChannels: Channel[];
  dbStats: Record<string, number>;
  redis?: RedisStatus;
}
interface RedisStatus { configured: boolean; reachable: boolean; roundTripMs: number | null; host: string | null; error: string | null; checkedAt: string; }

/** Upstash Redis: carries 60-second session revocation, the session blocklist and shared rate limits. */
function RedisCard({ redis }: { redis: RedisStatus }) {
  const state = !redis.configured ? 'Not configured' : redis.reachable ? 'Connected' : 'Unreachable';
  const tone = !redis.configured || !redis.reachable
    ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  const rows: Array<[string, string]> = [
    ['Configured', redis.configured ? 'Yes' : 'No'],
    ['Reachable', redis.configured ? (redis.reachable ? 'Yes (PING → PONG)' : 'No') : '—'],
    ['Round trip', redis.roundTripMs != null ? `${redis.roundTripMs} ms` : '—'],
    ['Host', redis.host ?? '—'],
  ];
  return (
    <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-5 space-y-3" data-testid="redis-status">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider">Redis (Upstash)</h2>
        <span className={`px-3 py-1 rounded-full border text-xs font-semibold ${tone}`}>{state}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {rows.map(([label, value]) => (
          <div key={label} className="bg-[var(--bg-surface-hover)]/50 rounded-xl p-3">
            <div className="text-xs text-[var(--text-muted)]">{label}</div>
            <div className="text-sm font-semibold text-[var(--text-main)] mt-0.5 break-all">{value}</div>
          </div>
        ))}
      </div>
      {redis.error && <p className="text-xs text-rose-300">{redis.error}</p>}
      <p className="text-xs text-[var(--text-muted)]">
        {redis.configured && redis.reachable
          ? 'Sign-outs and role changes reach every session within 60 seconds; rate limits are shared across instances.'
          : 'Without Redis, role changes and sign-outs reach web sessions only when they expire (up to 24 hours), and rate limits are per instance. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN on the Next.js service and redeploy.'}
        {' '}Checked {new Date(redis.checkedAt).toLocaleTimeString()}; Refresh re-checks.
      </p>
    </div>
  );
}

const TABS = ['overview', 'modules', 'api', 'db-models', 'notifications'] as const;
type Tab = typeof TABS[number];

export default function AdminInfoPage() {
  const [data, setData]     = useState<InfoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]       = useState<Tab>('overview');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/info');
      const d = await res.json();
      setData(d);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-[var(--text-muted)] animate-pulse">Loading platform info...</div></div>;
  if (!data) return <div className="text-rose-400 p-8">Failed to load</div>;

  const { platform, modules, apiEndpoints, dbModels, notificationChannels, dbStats } = data;

  const TAB_LABELS: Record<Tab, string> = {
    overview: 'Overview',
    modules: `Modules (${modules.length})`,
    api: `API Endpoints (${platform.totalApiEndpoints})`,
    'db-models': `DB Models (${platform.totalDbModels})`,
    notifications: `Notification Channels (${platform.notificationChannels})`,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mb-2">Platform Info</h1>
          <p className="text-xs text-[var(--text-muted)]">{platform.name} v{platform.version} - {platform.stack}</p>
        </div>
        <button onClick={load} className="px-4 py-2 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm hover:bg-[var(--bg-surface-hover)]">
          Refresh
        </button>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Platform Modules',    value: platform.modules,             color: 'from-blue-500 to-indigo-600' },
          { label: 'API Endpoints',        value: platform.totalApiEndpoints,   color: 'from-emerald-500 to-teal-600' },
          { label: 'Database Models',      value: platform.totalDbModels,       color: 'from-violet-500 to-purple-600' },
          { label: 'Notification Channels',value: platform.notificationChannels,color: 'from-amber-500 to-orange-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className={`rounded-2xl bg-gradient-to-br ${color} p-5`}>
            <div className="text-3xl font-bold text-[var(--text-main)]">{value}</div>
            <div className="text-sm text-[var(--text-main)]/80 mt-1">{label}</div>
          </div>
        ))}
      </div>

      {data.redis && <RedisCard redis={data.redis} />}

      {/* DB live stats */}
      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">Live Database Counts</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Object.entries(dbStats).map(([key, val]) => (
            <div key={key} className="bg-[var(--bg-surface-hover)]/50 rounded-xl p-3 text-center">
              <div className="text-xl font-bold text-[var(--text-main)]">{val.toLocaleString()}</div>
              <div className="text-xs text-[var(--text-muted)] mt-0.5 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-[var(--border-subtle)] flex-wrap">
        {TABS.map(t => (
          <button key={t} onClick={() => { setTab(t); setSearch(''); }}
            className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px whitespace-nowrap ${tab === t ? 'text-[var(--text-main)] border-blue-500' : 'text-[var(--text-muted)] border-transparent hover:text-[var(--text-muted)]'}`}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Search bar for most tabs */}
      {tab !== 'overview' && (
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={`Search ${tab}...`}
          className="w-full max-w-sm px-4 py-2 rounded-lg bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none text-sm"/>
      )}

      {/* MODULES TAB */}
      {tab === 'modules' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {modules.filter(m => !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.description.toLowerCase().includes(search.toLowerCase())).map(m => (
            <a key={m.id} href={m.path} className="block bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-5 hover:border-[var(--border-strong)] transition-all">
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${m.color} flex items-center justify-center text-white font-bold text-sm`}>
                  {m.name[0]}
                </div>
                <div>
                  <div className="font-semibold text-[var(--text-main)]">{m.name}</div>
                  <div className="text-xs font-mono text-[var(--text-faint)]">{m.path}</div>
                </div>
              </div>
              <p className="text-[var(--text-muted)] text-sm">{m.description}</p>
            </a>
          ))}
        </div>
      )}

      {/* API ENDPOINTS TAB */}
      {tab === 'api' && (
        <div className="space-y-4">
          {apiEndpoints.filter(g => !search || g.module.toLowerCase().includes(search.toLowerCase()) || g.endpoints.some(e => e.toLowerCase().includes(search.toLowerCase()))).map(g => (
            <div key={g.module} className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="font-semibold text-[var(--text-main)]">{g.module}</span>
                  <span className="ml-2 text-xs font-mono text-[var(--text-faint)]">{g.base}</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30">{g.count} routes</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {g.endpoints.filter(e => !search || e.toLowerCase().includes(search.toLowerCase())).map(ep => (
                  <span key={ep} className="text-xs font-mono px-2 py-1 rounded bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border border-[var(--border-subtle)]">{ep}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* DB MODELS TAB */}
      {tab === 'db-models' && (
        <div className="space-y-4">
          {dbModels.filter(g => !search || g.category.toLowerCase().includes(search.toLowerCase()) || g.models.some(m => m.toLowerCase().includes(search.toLowerCase()))).map(g => (
            <div key={g.category} className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <span className="font-semibold text-[var(--text-main)]">{g.category}</span>
                <span className="text-xs text-[var(--text-faint)]">{g.models.length} models</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {g.models.filter(m => !search || m.toLowerCase().includes(search.toLowerCase())).map(model => (
                  <span key={model} className="text-xs font-mono px-2 py-1.5 rounded-lg bg-violet-500/10 text-violet-300 border border-violet-500/20">{model}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* NOTIFICATIONS TAB */}
      {tab === 'notifications' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {notificationChannels.filter(ch => !search || ch.name.toLowerCase().includes(search.toLowerCase()) || ch.description.toLowerCase().includes(search.toLowerCase())).map(ch => (
            <div key={ch.id} className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-main)] font-bold text-sm">{ch.icon}</div>
                <div>
                  <div className="font-semibold text-[var(--text-main)]">{ch.name}</div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${ch.status === 'active' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border-amber-500/30'}`}>
                    {ch.status === 'active' ? 'Active' : 'Configurable'}
                  </span>
                </div>
              </div>
              <p className="text-[var(--text-muted)] text-sm mb-3">{ch.description}</p>
              <a href={ch.configPath} className="text-xs text-blue-400 hover:text-blue-300 hover:underline">Configure &rarr;</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
