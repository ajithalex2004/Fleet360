'use client';
/**
 * /bus-ops/live-map — Live Fleet Map for Staff Transportation.
 *
 * Mirrors the school-bus live-map layout (KPI strip → breakdown alert →
 * map + sidebar) but built on real Google Maps tiles and staff-transport
 * data (passengers instead of students, no attendant column). Auto-refreshes
 * every 15s. If the tenant has zero positions on first load, we seed 5 demo
 * vehicles around Abu Dhabi so the map isn't empty during a demo.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Satellite, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';
import type { VehiclePosition as MapVehiclePosition } from '@/components/shared/FleetLiveMap';

const FleetLiveMap = dynamic(() => import('@/components/shared/FleetLiveMap'), { ssr: false });

interface FleetSummary {
  total: number; online: number; enRoute: number; atStop: number;
  idle: number; offline: number; breakdown: number;
}

interface VehiclePositionFull extends MapVehiclePosition {
  route_id: string | null;
  route_name: string | null;
  trip_id: string | null;
  trip_number: string | null;
  trip_status: string | null;    // SCHEDULED | DEPARTED | IN_TRANSIT | COMPLETED | CANCELLED — from the joined trip_schedules row
  driver_name: string | null;
  heading_deg: number;
  next_stop_name: string | null;
  next_stop_eta: string | null;
  passengers_onboard: number;
  last_ping_at: string;
}

const REFRESH_MS = 15_000;

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; dot: string; label: string }> = {
  EN_ROUTE:  { color: 'text-green-400',  bg: 'bg-green-500/15',  border: 'border-green-500/30',  dot: 'bg-green-400',  label: 'En Route'  },
  AT_STOP:   { color: 'text-blue-400',   bg: 'bg-blue-500/15',   border: 'border-blue-500/30',   dot: 'bg-blue-400',   label: 'At Stop'   },
  IDLE:      { color: 'text-slate-400',  bg: 'bg-slate-500/15',  border: 'border-slate-500/30',  dot: 'bg-slate-400',  label: 'Idle'      },
  OFFLINE:   { color: 'text-slate-500',  bg: 'bg-slate-800/50',  border: 'border-slate-700',     dot: 'bg-slate-600',  label: 'Offline'   },
  BREAKDOWN: { color: 'text-red-400',    bg: 'bg-red-500/15',    border: 'border-red-500/30',    dot: 'bg-red-400',    label: 'Breakdown' },
};

// Trip-status pill palette imported from the shared source so this
// page never drifts from Trip Monitor / Trip Detail.
import { TRIP_STATUS_META, pillClass } from '@/lib/bus-ops/status-meta';

function TripStatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  const meta = TRIP_STATUS_META[status as keyof typeof TRIP_STATUS_META]
    ?? { text: 'text-slate-300', bg: 'bg-slate-700/40', border: 'border-slate-600', dot: 'bg-slate-500', label: status };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${pillClass(meta)}`}
      title="Trip status (workflow) — the trip's lifecycle stage from Trip Monitor">
      Trip · {meta.label}
    </span>
  );
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });
}
function sinceStr(sec: number): string {
  if (sec < 60)   return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

// ── Demo seeder ─────────────────────────────────────────────────────────────
// Only runs when the tenant has zero positions on first load. Anchored around
// Abu Dhabi / Musaffah / Yas Island so it's realistic for staff-transport.
async function seedDemoPositions() {
  const buses = [
    { vehicleId: 'BOX-DEMO-1', vehiclePlate: 'AUH 12-345', routeName: 'Musaffah → HQ Morning',   lat: 24.3623, lng: 54.5210, speed: 52, status: 'EN_ROUTE',  passengers: 34, driver: 'Rashid Al Mansouri',  nextStop: 'ICAD 3 · Gate B',            heading: 45 },
    { vehicleId: 'BOX-DEMO-2', vehiclePlate: 'AUH 67-890', routeName: 'ICAD Loop Evening',       lat: 24.3720, lng: 54.5080, speed: 0,  status: 'AT_STOP',   passengers: 28, driver: 'Salem Al Otaiba',      nextStop: 'ICAD 2 · Bay 4',              heading: 180 },
    { vehicleId: 'BOX-DEMO-3', vehiclePlate: 'AUH 24-680', routeName: 'Yas Island → HQ',         lat: 24.4890, lng: 54.6100, speed: 68, status: 'EN_ROUTE',  passengers: 45, driver: 'Khalid Al Hamdan',    nextStop: 'Al Reem Bridge',              heading: 270 },
    { vehicleId: 'BOX-DEMO-4', vehiclePlate: 'AUH 13-579', routeName: 'Khalifa City → HQ',       lat: 24.4180, lng: 54.5730, speed: 42, status: 'EN_ROUTE',  passengers: 22, driver: 'Omar Al Shamsi',       nextStop: 'Airport Road Interchange',    heading: 315 },
    { vehicleId: 'BOX-DEMO-5', vehiclePlate: 'AUH 99-001', routeName: null,                      lat: 24.4200, lng: 54.4700, speed: 0,  status: 'IDLE',      passengers: 0,  driver: 'Saeed Al Falasi',      nextStop: null,                          heading: 0   },
  ];
  await Promise.all(buses.map(b => fetch('/api/bus-ops/fleet-positions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehicleId: b.vehicleId, vehiclePlate: b.vehiclePlate, routeName: b.routeName,
      driverName: b.driver, lat: b.lat, lng: b.lng,
      speedKmh: b.speed, headingDeg: b.heading, status: b.status,
      nextStopName: b.nextStop, passengersOnboard: b.passengers,
    }),
  }).catch(() => {})));
}

// ── VehicleCard ─────────────────────────────────────────────────────────────
function VehicleCard({ v, selected, onSelect }: { v: VehiclePositionFull; selected: boolean; onSelect: () => void }) {
  const cfg = STATUS_CONFIG[v.status] ?? STATUS_CONFIG.IDLE;
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-3 rounded-lg border transition-all ${
        selected ? `${cfg.bg} ${cfg.border}` : 'bg-slate-900/70 border-white/10 hover:bg-slate-800/70'
      }`}
    >
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <span className="text-sm font-semibold text-white truncate">{v.vehicle_plate ?? v.vehicle_id}</span>
        <span className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${cfg.bg} ${cfg.color} ${cfg.border}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </span>
      </div>
      {v.trip_status && (
        <div className="mb-1"><TripStatusPill status={v.trip_status} /></div>
      )}
      {v.route_name && <p className="text-xs text-slate-300 mb-1 truncate">🗺️ {v.route_name}</p>}
      <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
        <span>👨‍✈️ {v.driver_name ?? 'No driver'}</span>
        <span>👥 {v.passengers_onboard} aboard</span>
        <span>⚡ {Math.round(v.speed_kmh)} km/h</span>
      </div>
      {v.next_stop_name && (
        <p className="mt-1 text-[11px] text-slate-400">→ {v.next_stop_name} · ETA {fmtTime(v.next_stop_eta)}</p>
      )}
      <p className="mt-0.5 text-[10px] text-slate-500">{sinceStr(v.seconds_since_ping)}</p>
    </button>
  );
}

// ── DetailPanel ─────────────────────────────────────────────────────────────
function DetailPanel({ v, onClose }: { v: VehiclePositionFull; onClose: () => void }) {
  const cfg = STATUS_CONFIG[v.status] ?? STATUS_CONFIG.IDLE;
  return (
    <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-bold text-white">{v.vehicle_plate ?? v.vehicle_id}</h3>
          {v.trip_number && <p className="text-[11px] text-slate-500 font-mono">{v.trip_number}</p>}
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color} border ${cfg.border}`}
              title="Vehicle status (motion) — derived from GPS + trip context">
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} /> Vehicle · {cfg.label}
            </span>
            <TripStatusPill status={v.trip_status} />
          </div>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">×</button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="bg-slate-800/60 rounded-lg p-2">
          <p className="text-slate-500 text-xs mb-0.5">Route</p>
          <p className="text-white font-medium truncate">{v.route_name ?? '—'}</p>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-2">
          <p className="text-slate-500 text-xs mb-0.5">Speed</p>
          <p className="text-white font-medium">{Math.round(v.speed_kmh)} km/h</p>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-2">
          <p className="text-slate-500 text-xs mb-0.5">Passengers</p>
          <p className="text-white font-medium">{v.passengers_onboard}</p>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-2">
          <p className="text-slate-500 text-xs mb-0.5">Heading</p>
          <p className="text-white font-medium">{v.heading_deg}°</p>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-2 col-span-2">
          <p className="text-slate-500 text-xs mb-0.5">GPS · Last Ping</p>
          <p className="text-white font-mono text-xs">{v.lat.toFixed(5)}, {v.lng.toFixed(5)}</p>
          <p className="text-slate-400 text-xs">{sinceStr(v.seconds_since_ping)}</p>
        </div>
      </div>

      {v.next_stop_name && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2">
          <p className="text-xs text-blue-400 mb-0.5">Next Stop</p>
          <p className="text-sm text-white font-medium">{v.next_stop_name}</p>
          <p className="text-xs text-blue-300">ETA {fmtTime(v.next_stop_eta)}</p>
        </div>
      )}

      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between text-slate-400">
          <span>👨‍✈️ Driver</span><span className="text-white">{v.driver_name ?? 'Unassigned'}</span>
        </div>
      </div>

      {v.status === 'BREAKDOWN' && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          <p className="text-red-400 font-semibold text-sm">🚨 Breakdown Alert</p>
          <p className="text-red-300 text-xs mt-1">Vehicle reporting breakdown. Dispatch recovery immediately.</p>
        </div>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function LiveFleetMapPage() {
  const [positions, setPositions]     = useState<VehiclePositionFull[]>([]);
  const [summary, setSummary]         = useState<FleetSummary | null>(null);
  const [selected, setSelected]       = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading]         = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const seededRef = useRef(false);

  const fetchPositions = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      const r = await fetch(`/api/bus-ops/fleet-positions?${params}`, { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      setPositions(d.positions ?? []);
      setSummary(d.summary ?? null);
      setLastRefresh(new Date());
    } catch { /* silent — next tick will retry */ }
    finally { setLoading(false); }
  }, [filterStatus]);

  useEffect(() => {
    const init = async () => {
      // Only seed on the very first call if the tenant has no positions.
      // Guard is a module-scope ref so React StrictMode's double-mount doesn't
      // double-seed on the same page load.
      if (!seededRef.current) {
        seededRef.current = true;
        try {
          const r = await fetch('/api/bus-ops/fleet-positions', { cache: 'no-store' });
          const d = r.ok ? await r.json() : { positions: [] };
          if ((d.positions ?? []).length === 0) {
            await seedDemoPositions();
          }
        } catch { /* seed is best-effort */ }
      }
      await fetchPositions();
    };
    init();
    const id = setInterval(fetchPositions, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchPositions]);

  const selectedVehicle = positions.find(p => p.id === selected) ?? null;
  const visiblePositions = filterStatus ? positions.filter(p => p.status === filterStatus) : positions;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Live Fleet Map"
        subtitle={
          lastRefresh
            ? `Real-time GPS positions · updated ${lastRefresh.toLocaleTimeString('en-AE')} · auto-refresh 15s`
            : 'Real-time GPS positions · auto-refresh 15s'
        }
        icon={Satellite}
        accent="violet"
        actions={
          <>
            <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              LIVE
            </span>
            <button onClick={fetchPositions}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 border border-white/10 px-3 py-2 text-sm text-slate-200 hover:border-violet-500/40 hover:text-white">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </>
        }
      />

      {/* KPI strip */}
      {summary && (
        <div className="grid grid-cols-3 md:grid-cols-7 gap-2">
          {[
            { label: 'Total',     val: summary.total,     color: 'text-white',       bg: 'bg-slate-800/60' },
            { label: 'Online',    val: summary.online,    color: 'text-green-400',   bg: 'bg-green-500/10' },
            { label: 'En Route',  val: summary.enRoute,   color: 'text-green-400',   bg: 'bg-green-500/10' },
            { label: 'At Stop',   val: summary.atStop,    color: 'text-blue-400',    bg: 'bg-blue-500/10' },
            { label: 'Idle',      val: summary.idle,      color: 'text-slate-400',   bg: 'bg-slate-700/50' },
            { label: 'Offline',   val: summary.offline,   color: 'text-slate-500',   bg: 'bg-slate-800/50' },
            { label: 'Breakdown', val: summary.breakdown, color: 'text-red-400',     bg: 'bg-red-500/10' },
          ].map(k => (
            <div key={k.label} className={`${k.bg} border border-white/5 rounded-xl p-3 text-center`}>
              <p className={`text-2xl font-bold ${k.color}`}>{k.val}</p>
              <p className="text-xs text-slate-500 mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Breakdown alert */}
      {summary && summary.breakdown > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-center gap-3">
          <span className="text-2xl">🚨</span>
          <div>
            <p className="text-red-400 font-semibold">{summary.breakdown} vehicle{summary.breakdown > 1 ? 's' : ''} reporting breakdown</p>
            <p className="text-red-300 text-sm">Select the vehicle for detail and dispatch recovery.</p>
          </div>
        </div>
      )}

      {/* Main layout: map + sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          {loading ? (
            <div className="h-[65vh] min-h-[420px] bg-slate-900 rounded-2xl border border-white/10 flex items-center justify-center">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-slate-400 text-sm">Loading fleet positions…</p>
              </div>
            </div>
          ) : (
            <FleetLiveMap
              positions={visiblePositions}
              selectedId={selected}
              onSelect={id => setSelected(prev => prev === id ? null : id)}
              className="h-[65vh] min-h-[420px]"
            />
          )}
        </div>

        <div className="lg:col-span-1 flex flex-col gap-3 max-h-[70vh] overflow-y-auto pr-1">
          {/* Filter chips */}
          <div className="flex flex-wrap gap-1">
            {['', 'EN_ROUTE', 'AT_STOP', 'IDLE', 'OFFLINE', 'BREAKDOWN'].map(s => (
              <button key={s || 'ALL'} onClick={() => setFilterStatus(s)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  filterStatus === s
                    ? 'bg-violet-500/20 text-violet-200 border-violet-500/40'
                    : 'bg-slate-800/50 text-slate-400 border-white/10 hover:border-white/20'
                }`}>
                {s === '' ? 'All' : STATUS_CONFIG[s]?.label ?? s}
              </button>
            ))}
          </div>

          {selectedVehicle && (
            <DetailPanel v={selectedVehicle} onClose={() => setSelected(null)} />
          )}

          <div className="space-y-2">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-20 bg-slate-800/60 rounded-lg animate-pulse" />
              ))
            ) : visiblePositions.length === 0 ? (
              <div className="bg-slate-900/70 border border-white/10 rounded-xl p-6 text-center">
                <p className="text-slate-500 text-sm">No vehicles match the current filter.</p>
              </div>
            ) : (
              visiblePositions.map(v => (
                <VehicleCard
                  key={v.id}
                  v={v}
                  selected={selected === v.id}
                  onSelect={() => setSelected(prev => prev === v.id ? null : v.id)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <div className="bg-slate-800/40 border border-white/5 rounded-xl p-3 text-xs text-slate-500">
        <span className="font-semibold text-slate-400">Ingest:</span> real driver-app GPS pings flow through
        <code className="mx-1 bg-slate-700 px-1 rounded">POST /api/bus-ops/vehicles/[id]/location</code>
        and land on this map within one refresh cycle. Positions are treated as offline after 5 minutes without a ping.
      </div>
    </div>
  );
}
