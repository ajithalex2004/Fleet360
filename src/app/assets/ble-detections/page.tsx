'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';

interface Detection {
  id: string;
  tag_mac: string;
  asset_name?: string;
  asset_id?: string;
  gateway_id: string;
  gateway_name?: string;
  gateway_code?: string;
  zone?: string;
  rssi: number;
  tx_power?: number;
  battery_pct?: number;
  detected_at: string;
}

interface BLEStats {
  total_gateways: number;
  online_gateways: number;
  offline_gateways: number;
  active_tags: number;
  detections_today: number;
  detections_last_hour: number;
  open_alerts: number;
  critical_alerts: number;
  last_detection_at?: string;
}

interface Gateway {
  id: string;
  name: string;
  gateway_code: string;
}

function RssiBar({ rssi }: { rssi: number }) {
  const pct = Math.max(0, Math.min(100, ((rssi + 100) / 60) * 100));
  const color = pct > 66 ? 'bg-emerald-500' : pct > 33 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-14 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-mono ${pct > 66 ? 'text-emerald-400' : pct > 33 ? 'text-amber-400' : 'text-red-400'}`}>{rssi}</span>
    </div>
  );
}

function BatteryPill({ pct }: { pct?: number }) {
  if (pct === undefined || pct === null) return <span className="text-slate-600 text-xs">—</span>;
  const color = pct > 50 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
    : pct > 20 ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
    : 'bg-red-500/20 text-red-400 border-red-500/30';
  const icon = pct > 50 ? '🔋' : pct > 20 ? '🪫' : '⚠️';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${color}`}>
      {icon} {pct}%
    </span>
  );
}

function RelativeTime({ dt }: { dt: string }) {
  const diff = Math.floor((Date.now() - new Date(dt).getTime()) / 1000);
  let label = '';
  if (diff < 60) label = `${diff}s ago`;
  else if (diff < 3600) label = `${Math.floor(diff / 60)}m ago`;
  else if (diff < 86400) label = `${Math.floor(diff / 3600)}h ago`;
  else label = `${Math.floor(diff / 86400)}d ago`;
  return <span title={new Date(dt).toLocaleString()} className="text-slate-400 text-xs cursor-default">{label}</span>;
}

export default function BLEDetectionsPage() {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [stats, setStats] = useState<BLEStats | null>(null);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Filters
  const [gatewayFilter, setGatewayFilter] = useState('');
  const [tagMacFilter, setTagMacFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');
  const [limit, setLimit] = useState(50);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const r = await fetch('/api/assets/ble/stats');
      if (r.ok) setStats(await r.json());
    } catch {}
    setStatsLoading(false);
  }, []);

  const loadGateways = useCallback(async () => {
    try {
      const r = await fetch('/api/assets/ble-gateways?tenantId=default');
      const d = await r.json();
      setGateways(Array.isArray(d) ? d : d.data ?? []);
    } catch {}
  }, []);

  const loadDetections = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (gatewayFilter) params.set('gateway_id', gatewayFilter);
      if (tagMacFilter) params.set('tag_mac', tagMacFilter);
      if (fromFilter) params.set('from', fromFilter);
      if (toFilter) params.set('to', toFilter);
      params.set('page', String(page));
      params.set('limit', String(limit));
      const r = await fetch(`/api/assets/ble/detections?${params}`);
      if (!r.ok) throw new Error('Failed to fetch');
      const d = await r.json();
      setDetections(d.detections ?? []);
      setTotal(d.total ?? 0);
      setLastRefresh(new Date());
    } catch { setError('Failed to load detections'); }
    setLoading(false);
  }, [gatewayFilter, tagMacFilter, fromFilter, toFilter, page, limit]);

  useEffect(() => { loadGateways(); loadStats(); }, [loadGateways, loadStats]);
  useEffect(() => { loadDetections(); }, [loadDetections]);

  useEffect(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    if (autoRefresh) {
      refreshTimer.current = setInterval(() => {
        loadDetections();
        loadStats();
      }, 10000);
    }
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [autoRefresh, loadDetections, loadStats]);

  const totalPages = Math.ceil(total / limit);

  const kpis = [
    { label: 'Detections Today', value: stats?.detections_today ?? '—', color: 'text-yellow-400' },
    { label: 'Last Hour', value: stats?.detections_last_hour ?? '—', color: 'text-blue-400' },
    { label: 'Active Tags', value: stats?.active_tags ?? '—', color: 'text-emerald-400' },
    { label: 'Online Gateways', value: stats ? `${stats.online_gateways}/${stats.total_gateways}` : '—', color: 'text-violet-400' },
  ];

  return (
    <div className="p-8 space-y-6">
      {toast && <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">{toast}</div>}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">📡 BLE Detection Log</h1>
          <p className="text-slate-400 text-sm mt-1">Real-time signal feed from connected gateways</p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-slate-500">Last refresh: {lastRefresh.toLocaleTimeString()}</span>
          )}
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
              autoRefresh
                ? 'bg-yellow-400/10 border-yellow-500/40 text-yellow-400'
                : 'bg-slate-800 border-white/8 text-slate-400 hover:text-white'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-yellow-400 animate-pulse' : 'bg-slate-600'}`} />
            🔄 Auto-refresh {autoRefresh ? 'ON' : 'OFF'}
          </button>
          <button onClick={loadDetections} className="text-xs bg-slate-800 border border-white/8 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg">
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>}

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-4">
        {kpis.map(k => (
          <div key={k.label} className="bg-slate-900 border border-white/8 rounded-xl p-4">
            {statsLoading ? (
              <div className="space-y-2">
                <div className="h-7 bg-slate-800 rounded animate-pulse w-16" />
                <div className="h-3 bg-slate-800 rounded animate-pulse w-24" />
              </div>
            ) : (
              <>
                <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                <p className="text-slate-400 text-xs mt-1">{k.label}</p>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-slate-900 border border-white/8 rounded-xl p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2">
            <label className="block text-xs text-slate-400 mb-1">Gateway</label>
            <select
              value={gatewayFilter}
              onChange={e => { setGatewayFilter(e.target.value); setPage(1); }}
              className="w-full bg-slate-800 border border-white/8 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="">All Gateways</option>
              {gateways.map(g => (
                <option key={g.id} value={g.id}>{g.name} ({g.gateway_code})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Tag MAC</label>
            <input
              value={tagMacFilter}
              onChange={e => { setTagMacFilter(e.target.value); setPage(1); }}
              placeholder="AA:BB:CC..."
              className="w-full bg-slate-800 border border-white/8 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">From</label>
            <input
              type="datetime-local"
              value={fromFilter}
              onChange={e => { setFromFilter(e.target.value); setPage(1); }}
              className="w-full bg-slate-800 border border-white/8 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">To</label>
            <input
              type="datetime-local"
              value={toFilter}
              onChange={e => { setToFilter(e.target.value); setPage(1); }}
              className="w-full bg-slate-800 border border-white/8 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Limit</label>
            <select
              value={limit}
              onChange={e => { setLimit(Number(e.target.value)); setPage(1); }}
              className="w-full bg-slate-800 border border-white/8 rounded-lg px-3 py-2 text-sm text-white"
            >
              {[50, 100, 200].map(l => <option key={l}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end mt-3">
          <button
            onClick={() => { setGatewayFilter(''); setTagMacFilter(''); setFromFilter(''); setToFilter(''); setPage(1); }}
            className="text-xs text-slate-400 hover:text-white"
          >
            Clear filters
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-white/8 flex items-center justify-between">
          <span className="text-sm text-slate-400">{total.toLocaleString()} detections total</span>
          {stats?.last_detection_at && (
            <span className="text-xs text-slate-500">
              Last detection: <RelativeTime dt={stats.last_detection_at} />
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/50 border-b border-white/8">
              <tr className="text-slate-400 text-xs uppercase">
                {['Time', 'Gateway', 'Zone', 'Tag MAC', 'Asset Name', 'RSSI Signal', 'Battery', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-slate-800 rounded animate-pulse" style={{ width: `${40 + Math.random() * 60}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : detections.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-slate-500">
                    <div className="text-4xl mb-3">📡</div>
                    <p className="font-medium">No detections received yet.</p>
                    <p className="text-sm mt-1">Connect a BLE gateway to start receiving data.</p>
                  </td>
                </tr>
              ) : detections.map(d => (
                <tr key={d.id} className="hover:bg-white/3 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <RelativeTime dt={d.detected_at} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-white text-xs font-medium">{d.gateway_name ?? d.gateway_code ?? d.gateway_id}</div>
                    {d.gateway_code && d.gateway_name && (
                      <div className="text-slate-600 text-xs font-mono">{d.gateway_code}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{d.zone ?? '—'}</td>
                  <td className="px-4 py-3">
                    <code className="text-yellow-300 font-mono text-xs bg-yellow-300/5 px-1.5 py-0.5 rounded">{d.tag_mac}</code>
                  </td>
                  <td className="px-4 py-3">
                    {d.asset_name ? (
                      <a href={`/assets/registry?id=${d.asset_id}`} className="text-blue-400 hover:text-blue-300 text-xs font-medium hover:underline">
                        {d.asset_name}
                      </a>
                    ) : (
                      <span className="text-slate-500 text-xs italic">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <RssiBar rssi={d.rssi} />
                  </td>
                  <td className="px-4 py-3">
                    <BatteryPill pct={d.battery_pct} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] text-slate-600 font-mono" title={new Date(d.detected_at).toLocaleString()}>
                      {new Date(d.detected_at).toLocaleTimeString()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-white/8">
            <span className="text-xs text-slate-500">
              Page {page} of {totalPages} — {total.toLocaleString()} results
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="text-xs px-3 py-1.5 bg-slate-800 border border-white/8 text-slate-400 hover:text-white rounded-lg disabled:opacity-40"
              >
                ← Prev
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pg = page <= 3 ? i + 1 : page + i - 2;
                if (pg < 1 || pg > totalPages) return null;
                return (
                  <button
                    key={pg}
                    onClick={() => setPage(pg)}
                    className={`text-xs px-3 py-1.5 rounded-lg border ${pg === page ? 'bg-yellow-400 text-slate-950 border-yellow-400 font-semibold' : 'bg-slate-800 border-white/8 text-slate-400 hover:text-white'}`}
                  >
                    {pg}
                  </button>
                );
              })}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="text-xs px-3 py-1.5 bg-slate-800 border border-white/8 text-slate-400 hover:text-white rounded-lg disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
