'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';

interface BLETag {
  id: string;
  tag_mac: string;
  tag_name?: string;
  assigned_asset_name?: string;
  assigned_asset_type?: string;
  battery_pct?: number;
  last_seen?: string;
  location_zone?: string;
  status?: string;
}

interface BLEGateway {
  id: string;
  name: string;
  location_zone?: string;
  status?: string;
  tags_visible?: number;
  last_heartbeat?: string;
}

interface Movement {
  id: string;
  asset_name?: string;
  movement_type?: string;
  from_location?: string;
  to_location?: string;
  performed_at?: string;
  location_zone?: string;
}

interface Zone {
  name: string;
  tags: BLETag[];
  gateways: BLEGateway[];
  movements: Movement[];
}

const DOMAINS = ['ALL', 'FLEET', 'AMBULANCE', 'SCHOOL_BUS', 'FIELD_SERVICE'];
const ASSET_TYPES = ['ALL', 'ASSET', 'VEHICLE', 'EQUIPMENT'];

function minutesAgo(dt?: string) {
  if (!dt) return null;
  return Math.round((Date.now() - new Date(dt).getTime()) / 60000);
}

export default function AssetMapPage() {
  const [tags, setTags] = useState<BLETag[]>([]);
  const [gateways, setGateways] = useState<BLEGateway[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [domainFilter, setDomainFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [zoneFilter, setZoneFilter] = useState('ALL');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [mr, tr, gr] = await Promise.all([
        fetch('/api/assets/movements?timeline=false&tenantId=default'),
        fetch('/api/assets/ble-tags?tenantId=default'),
        fetch('/api/assets/ble-gateways?tenantId=default'),
      ]);
      const [md, td, gd] = await Promise.all([mr.json(), tr.json(), gr.json()]);
      setMovements(Array.isArray(md) ? md : md.data ?? []);
      setTags(Array.isArray(td) ? td : td.data ?? []);
      setGateways(Array.isArray(gd) ? gd : gd.data ?? []);
    } catch { setError('Failed to load map data'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(load, 30000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, load]);

  // Build zones from tags and gateways
  const allZones = new Set<string>();
  tags.forEach(t => t.location_zone && allZones.add(t.location_zone));
  gateways.forEach(g => g.location_zone && allZones.add(g.location_zone));
  movements.forEach(m => m.location_zone && allZones.add(m.location_zone));
  allZones.add('UNASSIGNED');

  const zones: Zone[] = Array.from(allZones).map(zoneName => ({
    name: zoneName,
    tags: tags.filter(t => (t.location_zone ?? 'UNASSIGNED') === zoneName),
    gateways: gateways.filter(g => (g.location_zone ?? 'UNASSIGNED') === zoneName),
    movements: movements.filter(m => (m.location_zone ?? 'UNASSIGNED') === zoneName),
  }));

  const filteredZones = zones
    .filter(z => zoneFilter === 'ALL' || z.name === zoneFilter)
    .filter(z => z.tags.length > 0 || z.gateways.length > 0);

  function zoneColor(zone: Zone) {
    const hasOfflineGateway = zone.gateways.some(g => g.status === 'OFFLINE');
    const hasOfflineTag = zone.tags.some(t => t.status === 'OFFLINE' || t.status === 'LOST');
    if (hasOfflineGateway) return 'border-red-500/50 bg-red-500/5';
    if (hasOfflineTag) return 'border-amber-500/50 bg-amber-500/5';
    return 'border-emerald-500/30 bg-emerald-500/5';
  }

  const twoHoursAgo = Date.now() - 2 * 3600 * 1000;
  const recentMovements = movements
    .filter(m => m.performed_at && new Date(m.performed_at).getTime() > twoHoursAgo)
    .sort((a, b) => new Date(b.performed_at!).getTime() - new Date(a.performed_at!).getTime())
    .slice(0, 20);

  if (loading) return (
    <div className="p-8 space-y-4">
      <div className="h-8 bg-slate-800 rounded w-48 animate-pulse" />
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-40 bg-slate-800 rounded-xl animate-pulse" />)}
      </div>
    </div>
  );

  return (
    <div className="p-8 space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-white">Asset Map</h1><p className="text-slate-400 text-sm">Zone-based asset location view</p></div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="w-4 h-4 rounded" />
            Auto-refresh (30s)
          </label>
          <button onClick={load} className="ml-2 bg-slate-800 border border-white/10 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg text-xs">↻ Refresh</button>
        </div>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select value={domainFilter} onChange={e => setDomainFilter(e.target.value)} className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
          {DOMAINS.map(d => <option key={d}>{d}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
          {ASSET_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        <select value={zoneFilter} onChange={e => setZoneFilter(e.target.value)} className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
          <option value="ALL">All Zones</option>
          {Array.from(allZones).map(z => <option key={z}>{z}</option>)}
        </select>
      </div>

      <div className="flex gap-6">
        {/* Zone Grid */}
        <div className="flex-1">
          {filteredZones.length === 0 ? (
            <div className="bg-slate-900 border border-white/8 rounded-xl p-12 text-center text-slate-500">
              <div className="text-5xl mb-3">🗺️</div>
              <p className="font-medium">No zone data available</p>
              <p className="text-sm mt-1">BLE tags and gateways will appear here once they report location zones.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredZones.map(zone => (
                <div key={zone.name} className={`border rounded-xl p-4 ${zoneColor(zone)}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-white font-semibold text-sm">{zone.name}</h3>
                      <p className="text-slate-400 text-xs">{zone.tags.length} asset(s)</p>
                    </div>
                    <div className="flex gap-1">
                      {zone.gateways.map(g => (
                        <span key={g.id} title={g.name} className={`w-2.5 h-2.5 rounded-full ${g.status === 'ONLINE' ? 'bg-emerald-400' : g.status === 'OFFLINE' ? 'bg-red-400' : 'bg-amber-400'}`} />
                      ))}
                    </div>
                  </div>

                  {/* Asset list */}
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {zone.tags.length === 0
                      ? <p className="text-slate-600 text-xs italic">No assets in this zone</p>
                      : zone.tags.map(t => {
                        const ago = minutesAgo(t.last_seen);
                        const batColor = !t.battery_pct ? 'text-slate-500' : t.battery_pct < 20 ? 'text-red-400' : t.battery_pct < 50 ? 'text-amber-400' : 'text-emerald-400';
                        return (
                          <div key={t.id} className="flex items-center justify-between bg-black/20 rounded-lg px-2.5 py-1.5 text-xs">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${t.status === 'ACTIVE' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                              <span className="text-slate-300 truncate max-w-[120px]">{t.assigned_asset_name ?? t.tag_name ?? t.tag_mac}</span>
                            </div>
                            <div className="flex items-center gap-2 text-slate-500">
                              {t.battery_pct !== undefined && <span className={batColor}>{t.battery_pct}%</span>}
                              {ago !== null && <span>{ago}m</span>}
                            </div>
                          </div>
                        );
                      })}
                  </div>

                  {/* Gateway indicators */}
                  {zone.gateways.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-white/8 flex flex-wrap gap-1.5">
                      {zone.gateways.map(g => (
                        <span key={g.id} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border ${g.status === 'ONLINE' ? 'border-emerald-500/30 text-emerald-400' : 'border-red-500/30 text-red-400'}`}>
                          📶 {g.name} {g.tags_visible !== undefined && `(${g.tags_visible})`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Movement Alerts Panel */}
        <div className="w-72 flex-shrink-0">
          <div className="bg-slate-900 border border-white/8 rounded-xl p-4">
            <h2 className="text-white font-semibold mb-3 text-sm">Recent Movements (2h)</h2>
            {recentMovements.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-6">No recent movements</p>
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {recentMovements.map((m, i) => (
                  <div key={m.id ?? i} className="bg-slate-800/50 rounded-lg p-2.5 text-xs">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="text-white font-medium truncate">{m.asset_name ?? '—'}</span>
                      <span className="text-slate-500 flex-shrink-0">{m.performed_at ? minutesAgo(m.performed_at) + 'm' : '—'}</span>
                    </div>
                    <div className="text-slate-400">{m.movement_type}</div>
                    {(m.from_location || m.to_location) && (
                      <div className="text-slate-500 mt-1">
                        {m.from_location && <span>{m.from_location}</span>}
                        {m.from_location && m.to_location && <span className="mx-1">→</span>}
                        {m.to_location && <span className="text-slate-300">{m.to_location}</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="mt-4 bg-slate-900 border border-white/8 rounded-xl p-4 space-y-2 text-sm">
            <h3 className="text-white font-semibold text-sm mb-2">Network Status</h3>
            <div className="flex justify-between"><span className="text-slate-400">Total Tags</span><span className="text-white">{tags.length}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Active Tags</span><span className="text-emerald-400">{tags.filter(t => t.status === 'ACTIVE').length}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Offline Tags</span><span className="text-red-400">{tags.filter(t => t.status === 'OFFLINE').length}</span></div>
            <div className="flex justify-between mt-2 pt-2 border-t border-white/8"><span className="text-slate-400">Gateways Online</span><span className="text-emerald-400">{gateways.filter(g => g.status === 'ONLINE').length}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Gateways Offline</span><span className="text-red-400">{gateways.filter(g => g.status === 'OFFLINE').length}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
