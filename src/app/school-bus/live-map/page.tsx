'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

/* ─────────────────────────── types ─────────────────────────── */
interface VehiclePosition {
  id: string;
  vehicle_id: string;
  vehicle_plate: string | null;
  route_id: string | null;
  route_name: string | null;
  trip_id: string | null;
  driver_name: string | null;
  attendant_name: string | null;
  lat: number;
  lng: number;
  speed_kmh: number;
  heading_deg: number;
  status: string;
  next_stop_name: string | null;
  next_stop_eta: string | null;
  students_onboard: number;
  is_online: boolean;
  seconds_since_ping: number;
  last_ping_at: string;
  trip_status: string | null;
  students_boarded: number | null;
  stops_completed: number | null;
  stops_total: number | null;
}

interface FleetSummary {
  total: number;
  online: number;
  enRoute: number;
  atStop: number;
  idle: number;
  offline: number;
  breakdown: number;
}

/* ─────────────────────────── constants ──────────────────────── */
const TENANTID = 'default';
const REFRESH_MS = 15_000;

// Dubai bounding box for demo marker positions
const DUBAI_CENTER = { lat: 25.2048, lng: 55.2708 };

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; label: string; dot: string }> = {
  EN_ROUTE:  { color: 'text-green-400',  bg: 'bg-green-500/15',  border: 'border-green-500/30',  dot: 'bg-green-400',  label: 'En Route'  },
  AT_STOP:   { color: 'text-blue-400',   bg: 'bg-blue-500/15',   border: 'border-blue-500/30',   dot: 'bg-blue-400',   label: 'At Stop'   },
  IDLE:      { color: 'text-slate-400',  bg: 'bg-slate-500/15',  border: 'border-slate-500/30',  dot: 'bg-slate-400',  label: 'Idle'      },
  OFFLINE:   { color: 'text-slate-600',  bg: 'bg-slate-800/50',  border: 'border-slate-700',     dot: 'bg-slate-600',  label: 'Offline'   },
  BREAKDOWN: { color: 'text-red-400',    bg: 'bg-red-500/15',    border: 'border-red-500/30',    dot: 'bg-red-400',    label: 'Breakdown' },
};

/* ─────────────────────────── helpers ────────────────────────── */
function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });
}
function sinceStr(sec: number): string {
  if (sec < 60)  return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

/* ─────────────────────────── Map Canvas (SVG stub) ─────────────────────────── */
// Renders a simplified SVG map of the UAE / Dubai with vehicle pins.
// In production, replace with Mapbox GL JS or Google Maps.
interface MapProps {
  positions: VehiclePosition[];
  selected: string | null;
  onSelect: (id: string) => void;
}

function MapCanvas({ positions, selected, onSelect }: MapProps) {
  // Simple Mercator projection for Dubai bounding box
  const W = 900, H = 500;
  const MIN_LAT = 24.8, MAX_LAT = 25.5;
  const MIN_LNG = 54.9, MAX_LNG = 55.7;

  const project = (lat: number, lng: number) => ({
    x: ((lng - MIN_LNG) / (MAX_LNG - MIN_LNG)) * W,
    y: ((MAX_LAT - lat) / (MAX_LAT - MIN_LAT)) * H,
  });

  return (
    <div className="relative w-full h-full bg-slate-900 rounded-xl border border-white/10 overflow-hidden">
      {/* Map background grid */}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" style={{ minHeight: 400 }}>
        {/* Water background */}
        <rect width={W} height={H} fill="#0f172a" />

        {/* Grid lines */}
        {Array.from({ length: 10 }, (_, i) => (
          <line key={`v${i}`} x1={(i / 9) * W} y1={0} x2={(i / 9) * W} y2={H} stroke="#1e293b" strokeWidth={1} />
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={(i / 5) * H} x2={W} y2={(i / 5) * H} stroke="#1e293b" strokeWidth={1} />
        ))}

        {/* Simplified Dubai coastline (decorative) */}
        <path d="M0,380 Q100,360 200,350 Q320,340 400,330 Q500,310 600,300 Q700,280 800,260 Q850,250 900,240 L900,500 L0,500 Z"
              fill="#1e3a5f" opacity={0.5} />

        {/* Main road corridors */}
        <line x1={0} y1={H * 0.4} x2={W} y2={H * 0.4} stroke="#334155" strokeWidth={3} />
        <line x1={W * 0.3} y1={0} x2={W * 0.5} y2={H} stroke="#334155" strokeWidth={2} />
        <line x1={W * 0.6} y1={0} x2={W * 0.7} y2={H} stroke="#334155" strokeWidth={2} />

        {/* Landmark labels */}
        <text x={W * 0.45} y={H * 0.35} fill="#475569" fontSize={10} textAnchor="middle">Downtown Dubai</text>
        <text x={W * 0.25} y={H * 0.55} fill="#475569" fontSize={10} textAnchor="middle">Jebel Ali</text>
        <text x={W * 0.72} y={H * 0.3} fill="#475569" fontSize={10} textAnchor="middle">Deira</text>

        {/* Vehicle pins */}
        {positions.map(p => {
          const { x, y } = project(p.lat, p.lng);
          const cfg = STATUS_CONFIG[p.status] ?? STATUS_CONFIG['IDLE'];
          const isSelected = p.id === selected;
          const pinColor =
            p.status === 'EN_ROUTE'  ? '#22c55e' :
            p.status === 'AT_STOP'   ? '#60a5fa' :
            p.status === 'BREAKDOWN' ? '#f87171' :
            p.status === 'OFFLINE'   ? '#475569' : '#94a3b8';

          return (
            <g key={p.id} style={{ cursor: 'pointer' }} onClick={() => onSelect(p.id)}>
              {/* Selection ring */}
              {isSelected && (
                <circle cx={x} cy={y} r={20} fill="none" stroke={pinColor} strokeWidth={2} opacity={0.6}>
                  <animate attributeName="r" from={15} to={25} dur="1.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" from={0.8} to={0} dur="1.5s" repeatCount="indefinite" />
                </circle>
              )}
              {/* Bus icon circle */}
              <circle cx={x} cy={y} r={isSelected ? 12 : 9} fill={pinColor} opacity={p.is_online ? 1 : 0.4} />
              {/* Bus emoji */}
              <text x={x} y={y + 4} textAnchor="middle" fontSize={isSelected ? 12 : 9} fill="white">🚌</text>
              {/* Speed badge */}
              {p.is_online && p.speed_kmh > 0 && (
                <text x={x + 13} y={y - 8} fontSize={7} fill="#94a3b8">{Math.round(p.speed_kmh)}km/h</text>
              )}
              {/* Plate label */}
              <text x={x} y={y + (isSelected ? 22 : 19)} textAnchor="middle" fontSize={8} fill="#cbd5e1">
                {p.vehicle_plate ?? p.vehicle_id}
              </text>
            </g>
          );
        })}

        {/* Empty state */}
        {positions.length === 0 && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fill="#475569" fontSize={14}>
            No vehicles online — telematics pings will appear here
          </text>
        )}
      </svg>

      {/* Map attribution */}
      <div className="absolute bottom-2 right-3 text-[10px] text-slate-600">
        Live positions · refreshes every 15s · UAE (Dubai region)
      </div>

      {/* Legend */}
      <div className="absolute top-3 left-3 flex flex-col gap-1">
        {Object.entries(STATUS_CONFIG).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${v.dot}`} />
            <span className="text-[10px] text-slate-400">{v.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── VehicleCard ────────────────────── */
function VehicleCard({ v, selected, onSelect }: { v: VehiclePosition; selected: boolean; onSelect: () => void }) {
  const cfg = STATUS_CONFIG[v.status] ?? STATUS_CONFIG['IDLE'];
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-3 rounded-lg border transition-all ${
        selected ? `${cfg.bg} ${cfg.border} border` : 'bg-slate-900 border-white/5 hover:bg-slate-800'
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-semibold text-white">{v.vehicle_plate ?? v.vehicle_id}</span>
        <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </span>
      </div>
      {v.route_name && <p className="text-xs text-slate-400 mb-1">🗺️ {v.route_name}</p>}
      <div className="flex gap-3 text-xs text-slate-500">
        <span>🤵 {v.driver_name ?? 'No driver'}</span>
        <span>👧 {v.students_onboard} aboard</span>
        <span>⚡ {Math.round(v.speed_kmh)} km/h</span>
      </div>
      {v.next_stop_name && (
        <p className="mt-1 text-xs text-slate-500">→ {v.next_stop_name} · ETA {fmtTime(v.next_stop_eta)}</p>
      )}
      <p className="mt-0.5 text-[10px] text-slate-600">{sinceStr(v.seconds_since_ping)}</p>
    </button>
  );
}

/* ─────────────────────────── Detail Panel ───────────────────── */
function DetailPanel({ v, onClose }: { v: VehiclePosition; onClose: () => void }) {
  const cfg = STATUS_CONFIG[v.status] ?? STATUS_CONFIG['IDLE'];
  return (
    <div className="bg-slate-900 border border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-bold text-white">{v.vehicle_plate ?? v.vehicle_id}</h3>
          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} /> {cfg.label}
          </span>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">×</button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="bg-slate-800 rounded-lg p-2">
          <p className="text-slate-500 text-xs mb-0.5">Route</p>
          <p className="text-white font-medium">{v.route_name ?? '—'}</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-2">
          <p className="text-slate-500 text-xs mb-0.5">Speed</p>
          <p className="text-white font-medium">{Math.round(v.speed_kmh)} km/h</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-2">
          <p className="text-slate-500 text-xs mb-0.5">Students Aboard</p>
          <p className="text-white font-medium">{v.students_onboard}</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-2">
          <p className="text-slate-500 text-xs mb-0.5">Heading</p>
          <p className="text-white font-medium">{v.heading_deg}°</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-2">
          <p className="text-slate-500 text-xs mb-0.5">GPS</p>
          <p className="text-white font-mono text-xs">{v.lat.toFixed(5)}, {v.lng.toFixed(5)}</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-2">
          <p className="text-slate-500 text-xs mb-0.5">Last Ping</p>
          <p className="text-white font-medium">{sinceStr(v.seconds_since_ping)}</p>
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
          <span>🤵 Driver</span><span className="text-white">{v.driver_name ?? 'Unassigned'}</span>
        </div>
        <div className="flex justify-between text-slate-400">
          <span>👩 Attendant</span><span className="text-white">{v.attendant_name ?? 'Unassigned'}</span>
        </div>
        {v.trip_status && (
          <>
            <div className="flex justify-between text-slate-400">
              <span>🛤️ Trip Status</span><span className="text-white">{v.trip_status}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>📍 Stops</span>
              <span className="text-white">{v.stops_completed ?? 0}/{v.stops_total ?? 0}</span>
            </div>
          </>
        )}
      </div>

      {v.status === 'BREAKDOWN' && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          <p className="text-red-400 font-semibold text-sm">🚨 Breakdown Alert</p>
          <p className="text-red-300 text-xs mt-1">This vehicle has reported a breakdown. Dispatch recovery immediately.</p>
          <button className="mt-2 w-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-1.5 rounded-lg transition-colors">
            Dispatch Recovery Unit
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Demo seeder ────────────────────── */
// Seeds demo positions so the live map isn't empty on first load
async function seedDemoPositions() {
  const buses = [
    { vehicleId: 'BUS-001', vehiclePlate: 'Dubai A 12345', routeName: 'Marina Morning Route', lat: 25.080, lng: 55.140, speed: 45, status: 'EN_ROUTE', students: 28, driver: 'Ahmed Al Mansouri', attendant: 'Fatima Hassan', nextStop: 'Marina Mall Gate 3', heading: 45 },
    { vehicleId: 'BUS-002', vehiclePlate: 'Dubai B 67890', routeName: 'JBR Afternoon Route',  lat: 25.085, lng: 55.133, speed: 0,  status: 'AT_STOP',   students: 22, driver: 'Mohammed Al Rashid', attendant: 'Aisha Al Zaabi', nextStop: 'JBR The Walk', heading: 180 },
    { vehicleId: 'BUS-003', vehiclePlate: 'Dubai C 24680', routeName: 'Downtown Express',     lat: 25.197, lng: 55.274, speed: 60, status: 'EN_ROUTE',  students: 35, driver: 'Khalid Al Hamdan', attendant: 'Sara Al Khoury', nextStop: 'Burj Khalifa Metro', heading: 90 },
    { vehicleId: 'BUS-004', vehiclePlate: 'Dubai D 13579', routeName: 'Deira North Route',    lat: 25.265, lng: 55.312, speed: 30, status: 'EN_ROUTE',  students: 18, driver: 'Omar Al Shamsi', attendant: 'Maryam Al Nuaimi', nextStop: 'Gold Souk Stop', heading: 270 },
    { vehicleId: 'BUS-005', vehiclePlate: 'Dubai E 99001', routeName: null,                   lat: 25.150, lng: 55.220, speed: 0,  status: 'IDLE',      students: 0,  driver: 'Saeed Al Falasi', attendant: null, nextStop: null, heading: 0 },
  ];

  for (const b of buses) {
    await fetch('/api/school-bus/fleet-positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: TENANTID,
        vehicleId: b.vehicleId, vehiclePlate: b.vehiclePlate,
        routeName: b.routeName,
        driverName: b.driver, attendantName: b.attendant,
        lat: b.lat, lng: b.lng,
        speedKmh: b.speed, headingDeg: b.heading,
        status: b.status,
        nextStopName: b.nextStop,
        studentsOnboard: b.students,
      }),
    }).catch(() => {});
  }
}

/* ─────────────────────────── Page ──────────────────────────── */
export default function LiveMapPage() {
  const [positions, setPositions]     = useState<VehiclePosition[]>([]);
  const [summary, setSummary]         = useState<FleetSummary | null>(null);
  const [selected, setSelected]       = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading]         = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const seededRef = useRef(false);

  const fetchPositions = useCallback(async () => {
    try {
      const params = new URLSearchParams({ tenantId: TENANTID });
      if (filterStatus) params.set('status', filterStatus);
      const r = await fetch(`/api/school-bus/fleet-positions?${params}`);
      if (!r.ok) return;
      const d = await r.json();
      setPositions(d.positions ?? []);
      setSummary(d.summary ?? null);
      setLastRefresh(new Date());
    } catch {}
    finally { setLoading(false); }
  }, [filterStatus]);

  useEffect(() => {
    const init = async () => {
      if (!seededRef.current) {
        seededRef.current = true;
        await seedDemoPositions();
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">🛰️ Live Fleet Map</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Real-time GPS positions · UAE School Bus Fleet
            {lastRefresh && <span className="ml-2 text-slate-600">· updated {lastRefresh.toLocaleTimeString('en-AE')}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            LIVE · 15s refresh
          </span>
          <button onClick={fetchPositions} className="bg-slate-800 hover:bg-slate-700 text-white text-sm px-4 py-2 rounded-lg transition-colors border border-white/10">
            ⟳ Refresh
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      {summary && (
        <div className="grid grid-cols-7 gap-2">
          {[
            { label: 'Total', val: summary.total,    color: 'text-white',         bg: 'bg-slate-800'       },
            { label: 'Online', val: summary.online,  color: 'text-green-400',     bg: 'bg-green-500/10'    },
            { label: 'En Route', val: summary.enRoute, color: 'text-green-400',   bg: 'bg-green-500/10'    },
            { label: 'At Stop', val: summary.atStop, color: 'text-blue-400',      bg: 'bg-blue-500/10'     },
            { label: 'Idle',    val: summary.idle,   color: 'text-slate-400',     bg: 'bg-slate-700/50'    },
            { label: 'Offline', val: summary.offline,color: 'text-slate-500',     bg: 'bg-slate-800/50'    },
            { label: 'Breakdown', val: summary.breakdown, color: 'text-red-400',  bg: 'bg-red-500/10'      },
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
            <p className="text-red-300 text-sm">Immediate attention required — select vehicle for details</p>
          </div>
        </div>
      )}

      {/* Main layout: map + sidebar */}
      <div className="flex gap-4" style={{ minHeight: 520 }}>
        {/* Map */}
        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="h-full bg-slate-900 rounded-xl border border-white/10 flex items-center justify-center">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-slate-400 text-sm">Loading fleet positions…</p>
              </div>
            </div>
          ) : (
            <MapCanvas
              positions={visiblePositions}
              selected={selected}
              onSelect={id => setSelected(prev => prev === id ? null : id)}
            />
          )}
        </div>

        {/* Sidebar */}
        <div className="w-80 flex flex-col gap-3 overflow-y-auto">
          {/* Filter */}
          <div className="flex gap-1 flex-wrap">
            {['', 'EN_ROUTE', 'AT_STOP', 'IDLE', 'OFFLINE', 'BREAKDOWN'].map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`text-xs px-2.5 py-1 rounded-full transition-colors border ${
                  filterStatus === s
                    ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'
                    : 'bg-slate-800 text-slate-400 border-white/5 hover:border-white/20'
                }`}
              >
                {s === '' ? 'All' : STATUS_CONFIG[s]?.label ?? s}
              </button>
            ))}
          </div>

          {/* Selected vehicle detail */}
          {selectedVehicle && (
            <DetailPanel v={selectedVehicle} onClose={() => setSelected(null)} />
          )}

          {/* Vehicle list */}
          <div className="space-y-2">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-20 bg-slate-800 rounded-lg animate-pulse" />
              ))
            ) : visiblePositions.length === 0 ? (
              <div className="bg-slate-900 border border-white/5 rounded-xl p-6 text-center">
                <p className="text-slate-500 text-sm">No vehicles match the current filter</p>
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

      {/* Info banner */}
      <div className="bg-slate-800/40 border border-white/5 rounded-xl p-3 text-xs text-slate-500">
        <span className="font-semibold text-slate-400">💡 Integration note:</span> In production, replace the SVG map with Mapbox GL JS or Google Maps API for interactive tiles. Telematics units POST to <code className="bg-slate-700 px-1 rounded">/api/school-bus/fleet-positions</code> every 10–30 seconds. Positions expire from the live view after 5 minutes of no ping.
      </div>
    </div>
  );
}
