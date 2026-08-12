'use client';
/**
 * RouteOptimizerPanel.tsx
 * Shared route planning component used by Logistics, Staff Transport & School Bus.
 * Props control labels, colors, and placeholder text for each module context.
 */
import React, { useState, useCallback, useRef, useId } from 'react';
import dynamic from 'next/dynamic';
import { MapPin, ListChecks } from 'lucide-react';
import GoogleMapPickerModal, { type PickedLocation } from '@/components/logistics/GoogleMapPickerModal';

// Existing-stop shape returned by /api/bus-ops/route-stops — one deduped row
// per unique (name, coords) across every route in the tenant. Bus-ops stops
// double as geofences (they carry a geofence_radius_m), so this list is
// effectively "Pick from existing Geofences/Stops".
interface ExistingStop { name: string; lat: number; lng: number; landmark: string | null; routeName: string }

// Dynamically import the map so it only renders client-side (Google Maps
// SDK needs `window`). We use the Google-Maps variant everywhere in the app
// now — Mapbox stays only in legacy surfaces that haven't been migrated yet.
const MapView = dynamic(() => import('./GoogleRouteOptimizerMap'), {
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
  /** Pre-populate the waypoint list — used by the Edit-Route flow to load
   *  an existing route's origin/stops/destination into the planner. Only
   *  read once on mount; further changes to this prop are ignored. */
  initialWaypoints?: Waypoint[];
  /** Fired whenever waypoints change (add/remove/reorder/pick). Lets the
   *  parent auto-suggest a route name based on origin/destination without
   *  needing to lift waypoint state. */
  onWaypointsChange?: (waypoints: Waypoint[]) => void;
  /** When true AND initialWaypoints has an origin + destination, auto-fire
   *  the optimize action once the panel has mounted. Powers the "Optimize"
   *  button on the routes page — one click opens the planner and shows
   *  the optimised polyline immediately. */
  autoOptimizeOnMount?: boolean;
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
    stopLabel:   'Pickup Zone/Stop Point',
    originLabel: 'Origin/Start Point',
    destLabel:   'Destination',
    icon:        '🚌',
    title:       'Route Planner',
    desc:        'Optimise pickup routes across multiple staff zones to minimise total travel time.',
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
  clearOnSelect = false,
}: {
  placeholder: string;
  onSelect: (r: GeocodeResult) => void;
  accent: string;
  /** When true, wipe the input after a suggestion is chosen. Used for the
   *  "add stop" search so the operator can immediately search another zone
   *  without having to manually clear the previous label. */
  clearOnSelect?: boolean;
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
              onClick={() => {
                onSelect(r);
                // `clearOnSelect` on the stops search — makes "add another zone"
                // a natural next action instead of having to erase the previous
                // label first. Origin/destination pickers keep the label so
                // the user has confirmation of what they picked.
                setQuery(clearOnSelect ? '' : r.label);
                setOpen(false);
              }}
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

export default function RouteOptimizerPanel({ mode, vehicleType = 'van', onSave, initialWaypoints, onWaypointsChange, autoOptimizeOnMount }: Props) {
  const cfg = MODE_CONFIG[mode];
  const uid = useId();

  // Initialize waypoints from the prop ONCE. Subsequent parent renders won't
  // reset the operator's in-progress edits — we intentionally don't sync
  // this state back to the prop.
  const [waypoints,      setWaypoints]      = useState<Waypoint[]>(initialWaypoints ?? []);

  // Broadcast waypoints changes to the parent so it can auto-suggest a
  // route name from origin/destination. Skip the initial render — parent
  // has its own initial state.
  const mountedRef = useRef(false);
  React.useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    onWaypointsChange?.(waypoints);
  }, [waypoints, onWaypointsChange]);
  const [routeResult,    setRouteResult]    = useState<RouteResult | null>(null);
  const [optimizing,     setOptimizing]     = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [saved,          setSaved]          = useState(false);
  const [showLegs,       setShowLegs]       = useState(false);

  // Map picker — one modal, several possible targets:
  //   'origin' | 'destination' — replace that slot's waypoint via addWaypoint
  //   'stop'                   — append a NEW stop
  //   { editStopId: '…' }      — replace an EXISTING stop's coords + label
  //                              (used by the pencil icon in the stops list)
  //
  // Picked location becomes a GeocodeResult (source: 'google') and flows
  // through the same code path as a search-select, so downstream behaviour
  // (marker rendering, optimize call, save) is identical.
  type PickerTarget = 'origin' | 'stop' | 'destination' | { editStopId: string };
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);

  // Existing-stops list picker (☑ button). Same list the routes-page uses —
  // deduped stops with geofences already defined. Bus-ops only for now; the
  // panel is shared with logistics/school which don't have an equivalent
  // endpoint. Add per-module conditionals if we extend to those later.
  const [listPickerTarget, setListPickerTarget] = useState<PickerTarget | null>(null);
  const [existingStops, setExistingStops] = useState<ExistingStop[]>([]);
  const [existingStopSearch, setExistingStopSearch] = useState('');

  React.useEffect(() => {
    if (mode !== 'staff') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/bus-ops/route-stops');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.stops)) setExistingStops(data.stops);
      } catch { /* silent — picker button just shows empty state */ }
    })();
    return () => { cancelled = true; };
  }, [mode]);

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

  const replaceStop = (id: string, geo: GeocodeResult) => {
    setWaypoints(prev => prev.map(w => w.id === id
      ? { ...w, label: geo.label, lat: geo.lat, lng: geo.lng }
      : w));
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

  // Auto-optimize on mount when the parent explicitly asks for it AND we
  // have enough waypoints to run the solver. Fires exactly once per mount
  // (autoOptimizeFiredRef prevents re-fires on state churn). Powers the
  // "Optimize" button on the routes page — one click → planner opens →
  // solver runs → operator sees the optimised polyline immediately.
  const autoOptimizeFiredRef = useRef(false);
  React.useEffect(() => {
    if (!autoOptimizeOnMount || autoOptimizeFiredRef.current) return;
    // Wait until we actually have origin + destination in the waypoints
    // array (initialWaypoints hydration happens on mount but async data
    // fetches upstream might land after the first render).
    const o = waypoints.some(w => w.type === 'origin');
    const d = waypoints.some(w => w.type === 'destination');
    if (!o || !d) return;
    autoOptimizeFiredRef.current = true;
    void optimize();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOptimizeOnMount, waypoints.length]);

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

      {/* Grid fills the remaining viewport height so the map has room to
          breathe instead of stopping at a fixed 520 px and leaving a blank
          strip below. The min-h calc backs off ~200 px for the page chrome
          (h1 + route-name input + panel header). */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 min-h-[calc(100vh-260px)]">
        {/* ── Left panel: waypoint editor ─── */}
        <div className="xl:col-span-2 space-y-4">

          {/* Origin — search box + Google Map picker button. Either fills
              the origin slot via addWaypoint('origin', …). */}
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-1.5 block">
              🟢 {cfg.originLabel}
            </label>
            <div className="flex gap-1.5">
              <div className="flex-1 min-w-0">
                <AddressSearch
                  placeholder={`Search for ${cfg.originLabel.toLowerCase()}…`}
                  onSelect={geo => addWaypoint('origin', geo)}
                  accent={cfg.accent}
                />
              </div>
              <button
                type="button"
                onClick={() => setPickerTarget('origin')}
                title={`Pick ${cfg.originLabel.toLowerCase()} on Google Maps`}
                className="inline-flex items-center justify-center px-3 rounded-xl border border-white/10 bg-slate-800/60 text-slate-300 hover:bg-slate-700 hover:text-white shrink-0"
              >
                <MapPin className="w-4 h-4" />
              </button>
              {mode === 'staff' && (
                <button
                  type="button"
                  onClick={() => { setExistingStopSearch(''); setListPickerTarget('origin'); }}
                  title="Choose from existing Geofences / Stops"
                  className="inline-flex items-center justify-center px-3 rounded-xl border border-white/10 bg-slate-800/60 text-slate-300 hover:bg-slate-700 hover:text-white shrink-0"
                >
                  <ListChecks className="w-4 h-4" />
                </button>
              )}
            </div>
            {hasOrigin && (
              <p className="text-xs text-emerald-400 mt-1 truncate">
                ✓ {waypoints.find(w => w.type === 'origin')?.label}
              </p>
            )}
          </div>

          {/* Intermediate stops — the operator can add as many as they need.
              The search clears after each pick so "add another" is a natural
              next keystroke. Count in the header + a placeholder that flips
              to "Add another…" once at least one has been added make the
              multi-add flow obvious. */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-slate-400 uppercase tracking-wider font-medium">
                📍 {cfg.stopLabel}s
                {stops.length > 0 && (
                  <span className={`ml-1.5 inline-flex items-center justify-center rounded-full text-[10px] font-bold px-2 py-0.5 ${cfg.bg} ${cfg.accent}`}>
                    {stops.length}
                  </span>
                )}
              </label>
              {stops.length > 0 && (
                <span className="text-[10px] text-slate-500 italic">Add as many zones as needed</span>
              )}
            </div>
            <div className="flex gap-1.5">
              <div className="flex-1 min-w-0">
                <AddressSearch
                  placeholder={stops.length === 0
                    ? `Add a ${cfg.stopLabel.toLowerCase()}…`
                    : `+ Add another ${cfg.stopLabel.toLowerCase()}…`}
                  onSelect={geo => addWaypoint('stop', geo)}
                  accent={cfg.accent}
                  clearOnSelect
                />
              </div>
              <button
                type="button"
                onClick={() => setPickerTarget('stop')}
                title="Pick a stop location on Google Maps"
                className="inline-flex items-center justify-center px-3 rounded-xl border border-white/10 bg-slate-800/60 text-slate-300 hover:bg-slate-700 hover:text-white shrink-0"
              >
                <MapPin className="w-4 h-4" />
              </button>
              {mode === 'staff' && (
                <button
                  type="button"
                  onClick={() => { setExistingStopSearch(''); setListPickerTarget('stop'); }}
                  title="Add from existing Geofences / Stops"
                  className="inline-flex items-center justify-center px-3 rounded-xl border border-white/10 bg-slate-800/60 text-slate-300 hover:bg-slate-700 hover:text-white shrink-0"
                >
                  <ListChecks className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Stop list */}
            {stops.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {stops.map((wp, i) => (
                  <div key={wp.id}
                    className={`flex items-center gap-2 bg-slate-800/60 border ${cfg.border} rounded-xl px-3 py-2`}>
                    <span className={`w-6 h-6 rounded-full ${cfg.bg} ${cfg.accent} flex items-center justify-center text-xs font-bold flex-shrink-0`}>
                      {i + 1}
                    </span>
                    <span className="flex-1 text-xs text-slate-300 truncate" title={wp.label}>{wp.label}</span>
                    <div className="flex gap-1 flex-shrink-0">
                      {/* Edit — opens the Google Map picker in "replace this
                          stop" mode. Coords + label swap in place, sequence
                          preserved. Operator's shortcut to fix a wrong-named
                          stop without deleting + re-adding. */}
                      <button onClick={() => setPickerTarget({ editStopId: wp.id })}
                        title="Edit this stop on Google Maps"
                        className="text-slate-500 hover:text-violet-300 text-xs px-1"
                        aria-label="Edit stop">
                        <MapPin className="w-3 h-3" />
                      </button>
                      {mode === 'staff' && (
                        <button
                          onClick={() => { setExistingStopSearch(''); setListPickerTarget({ editStopId: wp.id }); }}
                          title="Replace with an existing Geofence / Stop"
                          className="text-slate-500 hover:text-violet-300 text-xs px-1"
                          aria-label="Replace stop from list">
                          <ListChecks className="w-3 h-3" />
                        </button>
                      )}
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

          {/* Destination — search box + Google Map picker button. */}
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-1.5 block">
              🔴 {cfg.destLabel}
            </label>
            <div className="flex gap-1.5">
              <div className="flex-1 min-w-0">
                <AddressSearch
                  placeholder={`Search for ${cfg.destLabel.toLowerCase()}…`}
                  onSelect={geo => addWaypoint('destination', geo)}
                  accent={cfg.accent}
                />
              </div>
              <button
                type="button"
                onClick={() => setPickerTarget('destination')}
                title={`Pick ${cfg.destLabel.toLowerCase()} on Google Maps`}
                className="inline-flex items-center justify-center px-3 rounded-xl border border-white/10 bg-slate-800/60 text-slate-300 hover:bg-slate-700 hover:text-white shrink-0"
              >
                <MapPin className="w-4 h-4" />
              </button>
              {mode === 'staff' && (
                <button
                  type="button"
                  onClick={() => { setExistingStopSearch(''); setListPickerTarget('destination'); }}
                  title="Choose from existing Geofences / Stops"
                  className="inline-flex items-center justify-center px-3 rounded-xl border border-white/10 bg-slate-800/60 text-slate-300 hover:bg-slate-700 hover:text-white shrink-0"
                >
                  <ListChecks className="w-4 h-4" />
                </button>
              )}
            </div>
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
                <div className="space-y-2 mt-1">
                  {routeResult.legs.map((leg, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="text-slate-600 flex-shrink-0 mt-0.5">{i + 1}.</span>
                      {/* min-w-0 lets the flex child SHRINK below its content
                          size (default is auto = content-width, which pushes
                          the row wider than the parent and clips at the map
                          edge). Combined with break-words below, long place
                          names wrap onto multiple lines instead of being
                          truncated by the "truncate" utility we removed. */}
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-300 break-words leading-snug">
                          <span>{leg.from}</span>
                          <span className="text-slate-500 mx-1">→</span>
                          <span>{leg.to}</span>
                        </p>
                        <p className="text-slate-500 mt-0.5">{leg.distanceKm} km · {leg.durationMin} min</p>
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
        {/* Column stretches to match the left column's height (grid rows
            stretch by default); map fills the column via h-full inside a
            flex container. That eliminates the empty stripe below the map
            when the left column is longer than the map's fixed height.
            min-h ensures usability on short viewports. */}
        <div className="xl:col-span-3 flex flex-col min-h-[480px]">
          <MapView
            waypoints={waypoints}
            routeGeometry={routeResult?.geometry ?? null}
            mode={mode}
            className="flex-1 min-h-[480px]"
          />
          {waypoints.length === 0 && (
            <p className="text-center text-xs text-slate-600 mt-2">
              Add waypoints on the left to see them on the map
            </p>
          )}
        </div>
      </div>

      {/* Google Map picker — one instance, three targets. onPick synthesises
          a GeocodeResult from the picked location and hands it to the same
          addWaypoint() the search box calls, so downstream behaviour is
          uniform whether the operator searched or pinned. */}
      <GoogleMapPickerModal
        open={pickerTarget !== null}
        title={
          pickerTarget === 'origin'      ? `Pick ${cfg.originLabel}` :
          pickerTarget === 'destination' ? `Pick ${cfg.destLabel}` :
          pickerTarget === 'stop'        ? `Pick ${cfg.stopLabel}` :
          pickerTarget && typeof pickerTarget === 'object' && 'editStopId' in pickerTarget
            ? `Edit ${cfg.stopLabel}` :
          'Pick location'
        }
        initial={
          // Pre-centre on the stop's current coords when editing so the
          // operator has visual context (rather than being dropped in Dubai).
          pickerTarget && typeof pickerTarget === 'object' && 'editStopId' in pickerTarget
            ? (() => {
                const wp = waypoints.find(w => w.id === pickerTarget.editStopId);
                return wp ? { lat: wp.lat, lng: wp.lng, label: wp.label } : null;
              })()
            : null
        }
        initialSearchQuery={
          pickerTarget && typeof pickerTarget === 'object' && 'editStopId' in pickerTarget
            ? waypoints.find(w => w.id === pickerTarget.editStopId)?.label
            : undefined
        }
        onClose={() => setPickerTarget(null)}
        onPick={(loc: PickedLocation) => {
          const geo = {
            label: loc.name || loc.address,
            lat: loc.lat,
            lng: loc.lng,
            source: 'google' as const,
          };
          if (pickerTarget === 'origin' || pickerTarget === 'stop' || pickerTarget === 'destination') {
            addWaypoint(pickerTarget, geo);
          } else if (pickerTarget && typeof pickerTarget === 'object' && 'editStopId' in pickerTarget) {
            replaceStop(pickerTarget.editStopId, geo);
          }
          setPickerTarget(null);
        }}
      />

      {/* Existing-stops list picker — same deduped list the routes page uses
          (bus-ops stops == geofences). Same 4 target modes as the map picker
          above so the operator can pick from either source into any slot. */}
      {listPickerTarget !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[80vh] flex flex-col bg-slate-800/95 border border-white/10 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-white/10">
              <h2 className="text-lg font-bold text-white">
                {listPickerTarget === 'origin'      ? `Pick ${cfg.originLabel} from Geofences/Stops` :
                 listPickerTarget === 'destination' ? `Pick ${cfg.destLabel} from Geofences/Stops` :
                 listPickerTarget === 'stop'        ? `Add ${cfg.stopLabel} from Geofences/Stops` :
                 typeof listPickerTarget === 'object' && 'editStopId' in listPickerTarget
                    ? `Replace ${cfg.stopLabel} from Geofences/Stops` :
                 'Pick from Geofences/Stops'}
              </h2>
              <button
                type="button"
                onClick={() => setListPickerTarget(null)}
                className="text-slate-400 hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="p-5 border-b border-white/10">
              <input
                type="text"
                value={existingStopSearch}
                onChange={e => setExistingStopSearch(e.target.value)}
                placeholder="Search stops by name or route…"
                autoFocus
                className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none text-sm"
              />
              <div className="text-[11px] text-slate-500 mt-1.5">{existingStops.length} unique stops across all routes</div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {existingStops.length === 0 ? (
                <div className="text-center text-sm text-slate-400 py-8">
                  No stops with GPS coords yet. Add some via the Routes page, or use the map picker (📍) instead.
                </div>
              ) : (
                (() => {
                  const q = existingStopSearch.trim().toLowerCase();
                  const filtered = q === ''
                    ? existingStops
                    : existingStops.filter(s =>
                        s.name.toLowerCase().includes(q) ||
                        s.routeName.toLowerCase().includes(q) ||
                        (s.landmark ?? '').toLowerCase().includes(q),
                      );
                  if (filtered.length === 0) {
                    return <div className="text-center text-sm text-slate-500 py-6">No matches for &ldquo;{existingStopSearch}&rdquo;.</div>;
                  }
                  return (
                    <ul className="space-y-1">
                      {filtered.map((s, i) => (
                        <li key={`${s.name}-${s.lat}-${s.lng}-${i}`}>
                          <button
                            type="button"
                            onClick={() => {
                              // Convert the ExistingStop into the same
                              // GeocodeResult the search box produces, then
                              // route through addWaypoint / replaceStop —
                              // exact same downstream path either way.
                              const geo = {
                                label: s.name,
                                lat: s.lat,
                                lng: s.lng,
                                source: 'google' as const,
                              };
                              if (listPickerTarget === 'origin' || listPickerTarget === 'stop' || listPickerTarget === 'destination') {
                                addWaypoint(listPickerTarget, geo);
                              } else if (typeof listPickerTarget === 'object' && 'editStopId' in listPickerTarget) {
                                replaceStop(listPickerTarget.editStopId, geo);
                              }
                              setListPickerTarget(null);
                            }}
                            className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white/5 transition-colors"
                          >
                            <div className="text-sm font-medium text-white">{s.name}</div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              <span className="text-slate-500">Route:</span> {s.routeName}
                              {s.landmark && <span className="ml-2 text-slate-500">·</span>}
                              {s.landmark && <span className="ml-2">{s.landmark}</span>}
                              <span className="ml-2 text-slate-500 font-mono text-[10px]">{s.lat.toFixed(4)}, {s.lng.toFixed(4)}</span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  );
                })()
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
