'use client';
/**
 * RouteOptimizerPanel.tsx
 * Shared route planning component used by Logistics, Staff Transport & School Bus.
 * Props control labels, colors, and placeholder text for each module context.
 */
import React, { useState, useCallback, useRef, useId } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import MapView so it only renders client-side (Mapbox GL needs window)
const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => (
    <div className="h-96 rounded-2xl bg-slate-900/60 border border-white/10 flex items-center justify-center">
      <div className="text-slate-500 text-sm animate-pulse">Loading map…</div>
    </div>
  ),
});

// ── Types ────────────────────────────────────────────────────────────────────

interface Waypoint {
  id: string;
  label: string;
  lng: number;
  lat: number;
  type: 'origin' | 'stop' | 'destination';
  metadata?: Record<string, string>;
}

interface RouteResult {
  orderedWaypoints: Waypoint[];
  totalDistanceKm: number;
  totalDurationMin: number;
  geometry: GeoJSON.LineString;
  legs: Array<{ from: string; to: string; distanceKm: number; durationMin: number }>;
  fuel: { litres: number; costAED: number };
  summary: {
    stops: number;
    distanceKm: number;
    durationMin: number;
    durationHuman: string;
    fuelLitres: number;
    fuelCostAED: number;
  };
  _warning?: string;
}

interface GeocodeResult {
  label: string;
  lng: number;
  lat: number;
  source: 'google' | 'mapbox';
}

export type PlannerMode = 'logistics' | 'staff' | 'school';

interface Props {
  mode: PlannerMode;
  vehicleType?: 'van' | 'truck' | 'bus';
  /** Called when dispatcher saves/dispatches a planned route */
  onSave?: (route: RouteResult, waypoints: Waypoint[]) => void;
}

// ── Mode config ───────────────────────────────────────────────────────────────

const MODE_CONFIG = {
  logistics: {
    color:       'amber',
    accent:      'text-amber-400',
    border:      'border-amber-500/30',
    bg:          'bg-amber-500/10',
    btnBg:       'bg-amber-500 hover:bg-amber-400 text-white',
    stopLabel:   'Delivery Stop',
    originLabel: 'Pickup / Origin Warehouse',
    destLabel:   'Final Destination',
    icon:        '🚛',
    title:       'Logistics Route Planner',
    desc:        'Plan multi-drop delivery routes with automated stop sequencing.',
  },
  staff: {
    color:       'purple',
    accent:      'text-purple-400',
    border:      'border-purple-500/30',
    bg:          'bg-purple-500/10',
    btnBg:       'bg-purple-600 hover:bg-purple-500 text-white',
    stopLabel:   'Staff Pickup Zone',
    originLabel: 'First Pickup Location',
    destLabel:   'Office / Destination',
    icon:        '🚌',
    title:       'Staff Route Planner',
    desc:        'Optimise staff pickup routes to minimise total travel time.',
  },
  school: {
    color:       'yellow',
    accent:      'text-yellow-400',
    border:      'border-yellow-500/30',
    bg:          'bg-yellow-500/10',
    btnBg:       'bg-yellow-500 hover:bg-yellow-400 text-slate-900',
    stopLabel:   'Student Stop',
    originLabel: 'First Student Pickup',
    destLabel:   'School / Campus',
    icon:        '🏫',
    title:       'School Bus Route Planner',
    desc:        'Build safe student pickup routes with optimised stop sequencing.',
  },
};

// ── Address Search ────────────────────────────────────────────────────────────

function AddressSearch({
  placeholder,
  onSelect,
  accent,
}: {
  placeholder: string;
  onSelect: (r: GeocodeResult) => void;
  accent: string;
}) {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((q: string) => {
    if (q.length < 3) { setResults([]); setOpen(false); return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res  = await fetch(`/api/route-optimizer/geocode?q=${encodeURIComponent(q)}`);
        const data = await res.json() as { results?: GeocodeResult[] };
        setResults(data.results ?? []);
        setOpen(true);
      } catch { /* silent */ }
      finally { setLoading(false); }
    }, 400);
  }, []);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 focus-within:border-white/30 transition-colors">
        <span className="text-slate-500 text-sm">📍</span>
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); search(e.target.value); }}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
        />
        {loading && <span className="w-3 h-3 border border-slate-500 border-t-white rounded-full animate-spin" />}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-slate-800 border border-white/10 rounded-xl shadow-xl overflow-hidden">
          {results.map((r, i) => (
            <button key={i}
              onClick={() => { onSelect(r); setQuery(r.label); setOpen(false); }}
              className="w-full text-left px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-700 transition-colors border-b border-white/5 last:border-0">
              <span className="block truncate">{r.label}</span>
              <span className={`text-xs ${r.source === 'google' ? 'text-blue-400' : 'text-amber-400'}`}>
                via {r.source === 'google' ? 'Google' : 'Mapbox'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function RouteOptimizerPanel({ mode, vehicleType = 'van', onSave }: Props) {
  const cfg = MODE_CONFIG[mode];
  const uid = useId();

  const [waypoints,      setWaypoints]      = useState<Waypoint[]>([]);
  const [routeResult,    setRouteResult]    = useState<RouteResult | null>(null);
  const [optimizing,     setOptimizing]     = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [saved,          setSaved]          = useState(false);
  const [showLegs,       setShowLegs]       = useState(false);

  const addWaypoint = (type: 'origin' | 'stop' | 'destination', geo: GeocodeResult) => {
    const wp: Waypoint = { id: `${uid}-${Date.now()}`, label: geo.label, lng: geo.lng, lat: geo.lat, type };
    setWaypoints(prev => {
      // replace existing origin/destination; append stops
      if (type === 'origin')      return [wp, ...prev.filter(w => w.type !== 'origin')];
      if (type === 'destination') return [...prev.filter(w => w.type !== 'destination'), wp];
      return [...prev, wp];
    });
    setRouteResult(null);
    setSaved(false);
  };

  const removeStop = (id: string) => {
    setWaypoints(prev => prev.filter(w => w.id !== id));
    setRouteResult(null);
    setSaved(false);
  };

  const moveStop = (id: string, dir: 'up' | 'down') => {
    setWaypoints(prev => {
      const stops = prev.filter(w => w.type === 'stop');
      const idx   = stops.findIndex(w => w.id === id);
      if (idx < 0) return prev;
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= stops.length) return prev;
      [stops[idx], stops[swapIdx]] = [stops[swapIdx], stops[idx]];
      return [
        ...prev.filter(w => w.type === 'origin'),
        ...stops,
        ...prev.filter(w => w.type === 'destination'),
      ];
    });
    setRouteResult(null);
  };

  const optimize = async () => {
    if (waypoints.length < 2) {
      setError('Add at least an origin and a destination first.');
      return;
    }
    setOptimizing(true);
    setError(null);
    try {
      const res  = await fetch('/api/route-optimizer/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waypoints, vehicleType }),
      });
      const data = await res.json() as RouteResult & { error?: string };
      if (data.error) throw new Error(data.error);
      setRouteResult(data);
      // Reorder displayed waypoints to match optimized order
      if (data.orderedWaypoints?.length) setWaypoints(data.orderedWaypoints);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Optimization failed');
    } finally {
      setOptimizing(false);
    }
  };

  const handleSave = () => {
    if (!routeResult || !onSave) return;
    onSave(routeResult, waypoints);
    setSaved(true);
  };

  const hasOrigin      = waypoints.some(w => w.type === 'origin');
  const hasDestination = waypoints.some(w => w.type === 'destination');
  const stops          = waypoints.filter(w => w.type === 'stop');
  const canOptimize    = hasOrigin && hasDestination;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-3xl">{cfg.icon}</span>
        <div>
          <h2 className="text-lg font-bold text-white">{cfg.title}</h2>
          <p className="text-slate-400 text-xs">{cfg.desc}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        {/* ── Left panel: waypoint editor ─── */}
        <div className="xl:col-span-2 space-y-4">

          {/* Origin */}
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-1.5 block">
              🟢 {cfg.originLabel}
            </label>
            <AddressSearch
              placeholder={`Search for ${cfg.originLabel.toLowerCase()}…`}
              onSelect={geo => addWaypoint('origin', geo)}
              accent={cfg.accent}
            />
            {hasOrigin && (
              <p className="text-xs text-emerald-400 mt-1 truncate">
                ✓ {waypoints.find(w => w.type === 'origin')?.label}
              </p>
            )}
          </div>

          {/* Intermediate stops */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-slate-400 uppercase tracking-wider font-medium">
                📍 {cfg.stopLabel}s ({stops.length})
              </label>
            </div>
            <AddressSearch
              placeholder={`Add a ${cfg.stopLabel.toLowerCase()}…`}
              onSelect={geo => addWaypoint('stop', geo)}
              accent={cfg.accent}
            />

            {/* Stop list */}
            {stops.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {stops.map((wp, i) => (
                  <div key={wp.id}
                    className={`flex items-center gap-2 bg-slate-800/60 border ${cfg.border} rounded-xl px-3 py-2`}>
                    <span className={`w-6 h-6 rounded-full ${cfg.bg} ${cfg.accent} flex items-center justify-center text-xs font-bold flex-shrink-0`}>
                      {i + 1}
                    </span>
                    <span className="flex-1 text-xs text-slate-300 truncate">{wp.label}</span>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => moveStop(wp.id, 'up')}
                        disabled={i === 0}
                        className="text-slate-600 hover:text-white disabled:opacity-20 text-xs px-1">▲</button>
                      <button onClick={() => moveStop(wp.id, 'down')}
                        disabled={i === stops.length - 1}
                        className="text-slate-600 hover:text-white disabled:opacity-20 text-xs px-1">▼</button>
                      <button onClick={() => removeStop(wp.id)}
                        className="text-red-500 hover:text-red-400 text-xs px-1">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Destination */}
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-1.5 block">
              🔴 {cfg.destLabel}
            </label>
            <AddressSearch
              placeholder={`Search for ${cfg.destLabel.toLowerCase()}…`}
              onSelect={geo => addWaypoint('destination', geo)}
              accent={cfg.accent}
            />
            {hasDestination && (
              <p className="text-xs text-red-400 mt-1 truncate">
                ✓ {waypoints.find(w => w.type === 'destination')?.label}
              </p>
            )}
          </div>

          {/* Optimize button */}
          <button
            onClick={optimize}
            disabled={!canOptimize || optimizing}
            className={`w-full py-3 rounded-xl font-semibold text-sm transition-all ${cfg.btnBg} disabled:opacity-30 disabled:cursor-not-allowed`}>
            {optimizing
              ? '⏳ Optimizing route…'
              : `✨ Optimize ${stops.length > 0 ? stops.length + ' Stop' + (stops.length > 1 ? 's' : '') + ' — ' : ''}Route`}
          </button>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-xs">
              ⚠️ {error}
            </div>
          )}

          {/* ── Route stats ── */}
          {routeResult && (
            <div className={`${cfg.bg} border ${cfg.border} rounded-2xl p-4 space-y-3`}>
              <p className="text-xs font-semibold text-white uppercase tracking-wider">📊 Route Summary</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { icon: '📍', label: 'Stops',    value: routeResult.summary.stops },
                  { icon: '📏', label: 'Distance', value: `${routeResult.summary.distanceKm} km` },
                  { icon: '⏱️', label: 'Duration', value: routeResult.summary.durationHuman },
                  { icon: '⛽', label: 'Fuel Est.', value: `${routeResult.summary.fuelLitres}L · AED ${routeResult.summary.fuelCostAED}` },
                ].map(s => (
                  <div key={s.label} className="bg-slate-900/40 rounded-xl p-3">
                    <p className="text-lg">{s.icon}</p>
                    <p className={`text-base font-bold ${cfg.accent}`}>{s.value}</p>
                    <p className="text-xs text-slate-500">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Leg details toggle */}
              <button onClick={() => setShowLegs(p => !p)}
                className="text-xs text-slate-400 hover:text-white transition-colors">
                {showLegs ? '▲ Hide' : '▼ Show'} leg breakdown
              </button>
              {showLegs && (
                <div className="space-y-1.5 mt-1">
                  {routeResult.legs.map((leg, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="text-slate-600 flex-shrink-0 mt-0.5">{i + 1}.</span>
                      <div className="flex-1">
                        <p className="text-slate-300 truncate">{leg.from} → {leg.to}</p>
                        <p className="text-slate-500">{leg.distanceKm} km · {leg.durationMin} min</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Warning if token missing */}
              {routeResult._warning && (
                <p className="text-amber-400 text-xs">⚠️ {routeResult._warning}</p>
              )}

              {/* Save / Dispatch */}
              {onSave && (
                <button onClick={handleSave} disabled={saved}
                  className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-all ${
                    saved
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 cursor-default'
                      : `${cfg.btnBg} shadow`
                  }`}>
                  {saved ? '✓ Route Saved' : '💾 Save Route & Dispatch'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Right panel: map ─────────────── */}
        <div className="xl:col-span-3">
          <MapView
            waypoints={waypoints}
            routeGeometry={routeResult?.geometry ?? null}
            mode={mode}
            className="h-[520px]"
          />
          {waypoints.length === 0 && (
            <p className="text-center text-xs text-slate-600 mt-2">
              Add waypoints on the left to see them on the map
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
