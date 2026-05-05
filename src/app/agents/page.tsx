'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

// ── Types ──────────────────────────────────────────────────────────────────────
interface LastRun {
  status: string;
  at: string;
  duration_ms: number;
  items_processed: number;
  actions_created: number;
}

interface Stats7d {
  runs: number;
  items_processed: number;
  actions_created: number;
}

interface PendingRoute {
  id: string;
  route_name: string;
  route_number: string;
  distance_saved_km: number;
  distance_saved_pct: number;
  matched_stop_count: number;
  created_at: string;
}

interface BatchAgent {
  id: string;
  name: string;
  module: string;
  model: string;
  resultsHref: string;
  lastRun: LastRun | null;
  stats7d: Stats7d;
  pendingCount: number;
  pendingItems: PendingRoute[];
}

interface ConvStats {
  sessions?: number;
  resolved?: number;
  resolvedRate?: number;
  avgResponseMs?: number;
  total_messages?: number;
  bookings_created?: number;
  total_queries?: number;
  tools_invoked?: number;
}

interface ConvAgent {
  id: string;
  name: string;
  model: string;
  endpoint: string;
  stats7d: ConvStats;
}

interface FeedRow {
  agent_id: string;
  event_type: string;
  status: string;
  items_processed: number;
  actions_created: number;
  created_at: string;
  duration_ms: number;
}

interface EcosystemData {
  commandStrip: {
    activeAgents: number;
    actionsToday: number;
    pendingApprovals: number;
    routeKmSaved7d: number;
    anomaliesFlagged7d: number;
  };
  batchAgents: BatchAgent[];
  convAgents: ConvAgent[];
  activityFeed: FeedRow[];
}

interface Thresholds {
  [agentId: string]: Record<string, unknown>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtTime(iso: string) {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch { return '—'; }
}

function statusColor(s: string) {
  if (s === 'COMPLETED') return 'text-emerald-400';
  if (s === 'FAILED')    return 'text-red-400';
  if (s === 'PARTIAL')   return 'text-amber-400';
  return 'text-slate-400';
}

function statusDot(s: string | null) {
  if (!s) return 'bg-slate-600';
  if (s === 'COMPLETED') return 'bg-emerald-400';
  if (s === 'FAILED')    return 'bg-red-400';
  return 'bg-amber-400';
}

function agentFeedLabel(agentId: string, actions: number, items: number) {
  const map: Record<string, (a: number, i: number) => string> = {
    'predictive-maintenance': (a, i) => `${i} vehicles scored · ${a} work orders created`,
    'finance-anomaly':        (a, i) => `${i} transactions scanned · ${a} anomalies flagged`,
    'route-optimiser':        (a, i) => `${i} routes analysed · ${a} routes optimised`,
    'incident-triage':        (a, i) => `${i} incidents triaged · ${a} escalated`,
    'dispatch-optimiser':     (a, i) => `${i} jobs scored · ${a} recommendations made`,
    'driver-coach':           (a, i) => `${i} drivers reviewed · ${a} coaching plans created`,
    'demand-forecasting':     (a, i) => `${i} segments forecast · ${a} alerts raised`,
    'whatsapp-agent':         (a, i) => `${i} messages received · ${a} resolved`,
    'chat-widget':            (a, i) => `${i} chat sessions · ${a} bookings made`,
    'ops-assistant':          (a, i) => `${i} queries answered · ${a} tools invoked`,
  };
  return map[agentId]?.(actions, items) ?? `${items} processed · ${actions} actions`;
}

// ── Threshold display value ────────────────────────────────────────────────────
function ThresholdValue({ val, unit }: { val: unknown; unit?: string }) {
  if (typeof val === 'number') {
    const display = Number.isInteger(val) ? val : val.toFixed(2);
    return <span className="font-bold text-amber-400">{display}{unit}</span>;
  }
  return <span className="font-bold text-amber-400">{String(val)}</span>;
}

// ── Inline threshold editor ────────────────────────────────────────────────────
function ThresholdEditor({
  agentId, config, onSaved,
}: {
  agentId: string;
  config: Record<string, unknown>;
  onSaved: () => void;
}) {
  const [open, setOpen]   = useState(false);
  const [val, setVal]     = useState<string>('');
  const [saving, setSaving] = useState(false);

  const key = Object.keys(config).find(k =>
    !['label', 'min', 'max', 'step', 'unit', 'options'].includes(k)
  ) ?? '';
  const currentVal = config[key];
  const label      = config.label as string ?? key;
  const unit       = config.unit as string ?? '';
  const options    = config.options as string[] | undefined;

  const handleOpen = () => { setVal(String(currentVal)); setOpen(true); };

  const handleSave = async () => {
    setSaving(true);
    const parsed = options ? val : (typeof currentVal === 'number' ? parseFloat(val) : val);
    await fetch('/api/agents/thresholds', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, thresholds: { [key]: parsed } }),
    });
    setSaving(false);
    setOpen(false);
    onSaved();
  };

  if (!key) return null;

  return (
    <div className="bg-slate-800/60 rounded-lg px-3 py-2 flex items-center justify-between gap-2 mb-2">
      <span className="text-xs text-slate-400 truncate">{label}</span>
      {open ? (
        <div className="flex items-center gap-1 flex-shrink-0">
          {options ? (
            <select
              className="bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-xs text-white"
              value={val}
              onChange={e => setVal(e.target.value)}
            >
              {options.map(o => <option key={o}>{o}</option>)}
            </select>
          ) : (
            <input
              type="number"
              min={config.min as number}
              max={config.max as number}
              step={config.step as number}
              value={val}
              onChange={e => setVal(e.target.value)}
              className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-xs text-white text-right"
            />
          )}
          <span className="text-xs text-slate-500">{unit}</span>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving ? '…' : '✓'}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-600 text-slate-300 hover:bg-slate-500"
          >
            ✕
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-shrink-0">
          <ThresholdValue val={currentVal} unit={unit} />
          <button
            onClick={handleOpen}
            className="text-[10px] text-blue-400 hover:text-blue-300 underline"
          >
            edit
          </button>
        </div>
      )}
    </div>
  );
}

// ── Batch Agent Card ───────────────────────────────────────────────────────────
function BatchAgentCard({
  agent, threshold, onRun, onRouteAction, onThresholdSaved,
}: {
  agent: BatchAgent;
  threshold: Record<string, unknown> | undefined;
  onRun: (id: string) => void;
  onRouteAction: (id: string, action: 'apply' | 'reject') => void;
  onThresholdSaved: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [showFeed, setShowFeed] = useState(agent.pendingCount > 0);

  const handleRun = async () => {
    setRunning(true);
    await onRun(agent.id);
    setRunning(false);
  };

  return (
    <div className={`bg-slate-800/50 border rounded-2xl p-5 flex flex-col gap-3 transition-all ${
      agent.pendingCount > 0
        ? 'border-amber-500/40 shadow-amber-500/10 shadow-lg'
        : 'border-white/10 hover:border-white/20'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-bold text-white leading-tight">{agent.name}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{agent.module} · {agent.model}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {agent.pendingCount > 0 && (
            <span className="text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40 rounded-full px-2 py-0.5">
              {agent.pendingCount} pending
            </span>
          )}
          <div className={`w-2.5 h-2.5 rounded-full mt-0.5 ${statusDot(agent.lastRun?.status ?? null)}`} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-900/60 rounded-xl px-3 py-2">
          <div className="text-lg font-bold text-white">{agent.stats7d.items_processed.toLocaleString()}</div>
          <div className="text-[10px] text-slate-500">Items processed 7d</div>
        </div>
        <div className="bg-slate-900/60 rounded-xl px-3 py-2">
          <div className="text-lg font-bold text-white">{agent.stats7d.actions_created.toLocaleString()}</div>
          <div className="text-[10px] text-slate-500">Actions created 7d</div>
        </div>
      </div>

      {/* Last run */}
      {agent.lastRun ? (
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <span className={`font-semibold ${statusColor(agent.lastRun.status)}`}>
            {agent.lastRun.status}
          </span>
          <span>·</span>
          <span>{fmtTime(agent.lastRun.at)}</span>
          <span>·</span>
          <span>{(agent.lastRun.duration_ms / 1000).toFixed(1)}s</span>
        </div>
      ) : (
        <div className="text-[11px] text-slate-600">No runs yet</div>
      )}

      {/* Threshold */}
      {threshold && (
        <ThresholdEditor agentId={agent.id} config={threshold} onSaved={onThresholdSaved} />
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleRun}
          disabled={running}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-400 text-xs font-bold transition-all disabled:opacity-50"
        >
          {running ? (
            <><span className="animate-spin">⟳</span> Running…</>
          ) : (
            <><span>▶</span> Run Now</>
          )}
        </button>
        <Link
          href={agent.resultsHref}
          className="flex items-center justify-center gap-1 px-4 py-2 rounded-xl bg-slate-700/50 hover:bg-slate-700 border border-white/10 text-slate-400 text-xs font-medium transition-all"
        >
          Results →
        </Link>
      </div>

      {/* Inline approval panel for route optimiser */}
      {agent.pendingItems.length > 0 && (
        <div className="border-t border-amber-500/20 pt-3">
          <button
            onClick={() => setShowFeed(v => !v)}
            className="flex items-center justify-between w-full text-[11px] font-bold text-amber-400 mb-2"
          >
            <span>⏳ {agent.pendingCount} route{agent.pendingCount > 1 ? 's' : ''} awaiting approval</span>
            <span className="text-slate-500">{showFeed ? '▲' : '▼'}</span>
          </button>
          {showFeed && (
            <div className="space-y-2">
              {agent.pendingItems.map(item => (
                <div key={item.id} className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="text-xs font-semibold text-white">{item.route_name}</div>
                      <div className="text-[10px] text-slate-400">
                        {item.route_number} · Saves {item.distance_saved_km.toFixed(1)} km
                        ({item.distance_saved_pct.toFixed(0)}%) · {item.matched_stop_count} stops
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => onRouteAction(item.id, 'apply')}
                      className="flex-1 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/40 text-emerald-400 text-[11px] font-bold transition-all"
                    >
                      ✓ Apply Route
                    </button>
                    <button
                      onClick={() => onRouteAction(item.id, 'reject')}
                      className="flex-1 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/40 border border-red-500/40 text-red-400 text-[11px] font-bold transition-all"
                    >
                      ✗ Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Conversational Agent Card ──────────────────────────────────────────────────
function ConvAgentCard({ agent }: { agent: ConvAgent }) {
  const s = agent.stats7d;
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(agent.endpoint);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const statPairs: [string, string | number][] = agent.id === 'whatsapp-agent'
    ? [['Messages 7d', s.sessions ?? 0], ['Resolved', `${s.resolvedRate ?? 0}%`]]
    : agent.id === 'chat-widget'
    ? [['Sessions 7d', s.sessions ?? 0], ['Bookings made', s.bookings_created ?? 0]]
    : [['Queries 7d', s.total_queries ?? 0], ['Tools invoked', s.tools_invoked ?? 0]];

  return (
    <div className="bg-emerald-950/30 border border-emerald-500/25 rounded-2xl p-5 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-bold text-white">{agent.name}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{agent.model}</div>
        </div>
        <div className="flex items-center gap-1.5 bg-emerald-900/60 border border-emerald-500/30 rounded-full px-2.5 py-1">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] font-bold text-emerald-400">LIVE</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        {statPairs.map(([label, value]) => (
          <div key={label} className="bg-slate-900/50 rounded-xl px-3 py-2">
            <div className="text-lg font-bold text-white">{typeof value === 'number' ? value.toLocaleString() : value}</div>
            <div className="text-[10px] text-slate-500">{label}</div>
          </div>
        ))}
      </div>

      {/* Endpoint */}
      <button
        onClick={copy}
        className="flex items-center justify-between bg-slate-900/60 rounded-xl px-3 py-2 hover:bg-slate-800/60 transition-all group"
      >
        <span className="text-[10px] font-mono text-emerald-400 truncate">{agent.endpoint}</span>
        <span className="text-[10px] text-slate-500 group-hover:text-slate-300 flex-shrink-0 ml-2">
          {copied ? '✓ copied' : '⎘ copy'}
        </span>
      </button>
    </div>
  );
}

// ── Activity Feed ──────────────────────────────────────────────────────────────
function ActivityFeed({ rows }: { rows: FeedRow[] }) {
  const AGENT_ICONS: Record<string, string> = {
    'predictive-maintenance': '🔧',
    'finance-anomaly':        '💰',
    'route-optimiser':        '🗺️',
    'incident-triage':        '🚨',
    'dispatch-optimiser':     '📡',
    'driver-coach':           '🎯',
    'demand-forecasting':     '📈',
    'whatsapp-agent':         '💬',
    'chat-widget':            '🤖',
    'ops-assistant':          '🖥️',
  };

  return (
    <div className="bg-slate-800/40 border border-white/10 rounded-2xl p-5">
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Activity Feed</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600 text-center py-6">No agent runs yet — trigger an agent to see activity here.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((row, i) => (
            <div key={i} className="flex items-start gap-3 py-2.5 border-b border-white/5 last:border-0">
              <span className="text-base flex-shrink-0 mt-0.5">{AGENT_ICONS[row.agent_id] ?? '🤖'}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-300">
                  <span className="font-semibold text-white">{row.agent_id.replace(/-/g, ' ')}</span>
                  {' — '}
                  {agentFeedLabel(row.agent_id, row.actions_created, row.items_processed)}
                </div>
                <div className="text-[10px] text-slate-600 mt-0.5">{row.event_type}</div>
              </div>
              <div className="flex-shrink-0 text-right">
                <div className={`text-[10px] font-semibold ${statusColor(row.status)}`}>{row.status}</div>
                <div className="text-[10px] text-slate-600">{fmtTime(row.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function AgentsPage() {
  const [data, setData]           = useState<EcosystemData | null>(null);
  const [thresholds, setThresholds] = useState<Thresholds>({});
  const [loading, setLoading]     = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [toast, setToast]         = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = useCallback(async () => {
    const [ecoRes, thrRes] = await Promise.all([
      fetch('/api/agents/ecosystem').then(r => r.json()).catch(() => null),
      fetch('/api/agents/thresholds').then(r => r.json()).catch(() => ({ thresholds: {} })),
    ]);
    if (ecoRes) setData(ecoRes);
    setThresholds(thrRes.thresholds ?? {});
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(loadData, 30_000);
    return () => clearInterval(id);
  }, [loadData]);

  const handleRun = async (agentId: string) => {
    setRunningId(agentId);
    try {
      const res = await fetch('/api/agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          event_type: 'manual.trigger',
          tenant_id: 'default',
        }),
      });
      const result = await res.json();
      if (res.ok) {
        const summary = (result?.output as { summary?: string })?.summary ?? `${agentId} completed`;
        showToast(`✓ ${summary}`, 'ok');
        await loadData();
      } else {
        showToast(`Failed to run ${agentId}`, 'err');
      }
    } catch {
      showToast(`Error running ${agentId}`, 'err');
    }
    setRunningId(null);
  };

  const handleRouteAction = async (resultId: string, action: 'apply' | 'reject') => {
    try {
      const res = await fetch(`/api/agents/route-results/${resultId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action.toUpperCase() }),
      });
      if (res.ok) {
        showToast(action === 'apply' ? '✓ Route applied successfully' : '✓ Route rejected', 'ok');
        await loadData();
      } else {
        showToast('Failed to update route', 'err');
      }
    } catch {
      showToast('Error updating route', 'err');
    }
  };

  const strip = data?.commandStrip;

  return (
    <div className="min-h-full bg-slate-900 p-6 space-y-8">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-xl border backdrop-blur-sm transition-all ${
          toast.type === 'ok'
            ? 'bg-emerald-900/90 border-emerald-500/50 text-emerald-300'
            : 'bg-red-900/90 border-red-500/50 text-red-300'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            🤖 AI Agent Ecosystem
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            10 agents · autonomous intelligence across every module · real-time control
          </p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 border border-white/10 hover:border-white/20 text-slate-300 text-sm font-medium transition-all"
        >
          <span className="text-base">⟳</span> Refresh
        </button>
      </div>

      {/* Command Strip — Impact KPIs */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-slate-800/50 border border-white/10 rounded-2xl p-5 animate-pulse h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {[
            { label: 'Active Agents',       value: strip?.activeAgents ?? 0,               color: 'text-emerald-400', icon: '🟢' },
            { label: 'Actions Today',        value: strip?.actionsToday ?? 0,               color: 'text-blue-400',    icon: '⚡' },
            { label: 'Awaiting Approval',    value: strip?.pendingApprovals ?? 0,           color: strip?.pendingApprovals ? 'text-amber-400' : 'text-slate-400', icon: '⏳' },
            { label: 'Route km Saved 7d',   value: `${strip?.routeKmSaved7d ?? 0} km`,     color: 'text-purple-400',  icon: '🗺️' },
            { label: 'Anomalies Flagged 7d', value: strip?.anomaliesFlagged7d ?? 0,         color: 'text-red-400',     icon: '🔍' },
          ].map(k => (
            <div key={k.label} className="bg-slate-800/50 border border-white/10 rounded-2xl p-5">
              <div className="text-lg mb-1">{k.icon}</div>
              <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
              <div className="text-[11px] text-slate-500 mt-1">{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── BATCH AGENTS ─────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-[11px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-full px-3 py-1 uppercase tracking-wider">
            Batch Agents
          </span>
          <span className="text-sm text-slate-400">On-demand &amp; scheduled intelligence</span>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...Array(7)].map((_, i) => (
              <div key={i} className="bg-slate-800/50 border border-white/10 rounded-2xl p-5 animate-pulse h-52" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {(data?.batchAgents ?? []).map(agent => (
              <BatchAgentCard
                key={agent.id}
                agent={agent}
                threshold={thresholds[agent.id]}
                onRun={handleRun}
                onRouteAction={handleRouteAction}
                onThresholdSaved={loadData}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── CONVERSATIONAL AGENTS ─────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full px-3 py-1 uppercase tracking-wider">
            Conversational Agents
          </span>
          <span className="text-sm text-slate-400">Always-on · 24/7 live</span>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-slate-800/50 border border-white/10 rounded-2xl p-5 animate-pulse h-44" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(data?.convAgents ?? []).map(agent => (
              <ConvAgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>

      {/* ── ACTIVITY FEED ─────────────────────────────────────────────────────── */}
      {!loading && data && (
        <ActivityFeed rows={data.activityFeed} />
      )}

    </div>
  );
}
