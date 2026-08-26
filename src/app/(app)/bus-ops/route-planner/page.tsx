'use client';
/**
 * Route Planner page — supports both New Route and Edit Route flows:
 *
 *   /bus-ops/route-planner            → new route, POST on save
 *   /bus-ops/route-planner?edit=<id>  → load the existing route, pre-fill
 *                                       waypoints, PATCH the same id on save
 *
 * The Routes page's Edit button navigates here with ?edit=<id> so the operator
 * uses the full-featured planner (map picker on every field, live estimate,
 * polyline preview) for edits instead of the smaller in-page modal.
 */
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Route as RouteIcon, Users } from 'lucide-react';
import RouteOptimizerPanel from '@/components/route-optimizer/RouteOptimizerPanel';
import FleetPlanner from '@/components/bus-ops/FleetPlanner';

interface RouteResult {
  summary: { stops: number; distanceKm: number; durationMin: number; durationHuman: string; fuelCostAED: number };
}
interface Waypoint {
  id: string; label: string; lng: number; lat: number;
  type: 'origin' | 'stop' | 'destination';
}

// Shape returned by /api/bus-ops/routes/[id]. Only the fields we consume.
interface LoadedRoute {
  id: string;
  name: string;
  origin: string;
  destination: string;
  routeType?: string | null;
  stops?: Array<{
    id: string;
    stopName: string;
    sequence: number;
    gpsLat: number | null;
    gpsLng: number | null;
  }>;
}

/** Lightweight shape for the route picker dropdown. */
interface RouteOption {
  id: string;
  name: string;
  code?: string | null;
  isActive?: boolean | null;
  stopCount: number;
}

type Mode = 'single' | 'fleet';

function RoutePlannerInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams?.get('edit') ?? null;
  const autoOptimize = searchParams?.get('optimize') === '1';
  const mode: Mode = searchParams?.get('mode') === 'fleet' ? 'fleet' : 'single';

  const switchMode = (next: Mode) => {
    // Preserve editId only in single mode — fleet planner is fleet-wide.
    const params = new URLSearchParams();
    if (next === 'fleet') {
      params.set('mode', 'fleet');
    } else if (editId) {
      params.set('edit', editId);
    }
    const qs = params.toString();
    router.replace(`/bus-ops/route-planner${qs ? '?' + qs : ''}`);
  };

  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(!!editId);
  const [initialWaypoints, setInitialWaypoints] = useState<Waypoint[] | null>(editId ? null : []);
  const [editingRouteName, setEditingRouteName] = useState<string | null>(null);
  /**
   * Stops loaded from the route that the geocoder could not place.
   *
   * They are held here and written back on save. Saving replaces the route's
   * entire stop set, so a stop absent from the waypoint list is deleted — and
   * these never reach the waypoint list, because a Waypoint requires numeric
   * coordinates and the map has nowhere to draw them. Without this they would
   * disappear the first time an operator opened the planner and pressed save,
   * with the only warning being a message they may have dismissed.
   */
  const [unresolvedStops, setUnresolvedStops] = useState<{ label: string; stopName: string; sequence: number }[]>([]);

  // Route name field. Operator can edit any time. Prefilled on edit-open,
  // suggested-from-endpoints on new-route flow (auto-generated when
  // origin/destination are set — but the operator can override).
  const [routeName, setRouteName] = useState('');
  const [routeNameManuallyEdited, setRouteNameManuallyEdited] = useState(false);

  // Route picker — populated from /api/bus-ops/routes. Picking a route
  // navigates to /bus-ops/route-planner?edit=<id> so all the existing
  // edit-flow logic (fetch + stop conversion + PATCH-on-save) kicks in.
  const [routeOptions, setRouteOptions] = useState<RouteOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/bus-ops/routes', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data)) return;
        setRouteOptions(
          data.map((r: {
            id: string; name: string; code?: string | null;
            isActive?: boolean | null; stops?: unknown[]
          }) => ({
            id: r.id,
            name: r.name,
            code: r.code,
            isActive: r.isActive,
            stopCount: Array.isArray(r.stops) ? r.stops.length : 0,
          })),
        );
      } catch { /* silent — picker just stays empty */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load the route + convert its stops into planner waypoints. First stop
  // becomes origin (sequence 1), last stop becomes destination, everything
  // between is a stop. Stops without gpsLat/gpsLng are skipped — the planner
  // needs coords to place a marker; the operator can re-pick those.
  useEffect(() => {
    // Reset panel state on every editId change — including editId → null
    // (user picked "— Pick existing route —"). Clearing initialWaypoints
    // stops the panel from remounting with the previous route's data during
    // the async fetch window.
    if (!editId) {
      setLoadingRoute(false);
      setInitialWaypoints([]);
      setEditingRouteName(null);
      setRouteName('');
      setRouteNameManuallyEdited(false);
      return;
    }
    setLoadingRoute(true);
    setInitialWaypoints(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/bus-ops/routes/${editId}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const route = await res.json() as LoadedRoute;
        if (cancelled) return;

        // Include ALL stops in sequence — the previous filter (coords-only)
        // silently dropped any stop that was typed by name without a pin,
        // making routes like "AGT HQ - SKMC - Morning" appear empty in the
        // planner even though they have stops in the DB. For stops WITHOUT
        // coords, we geocode by name in parallel via /api/route-optimizer/
        // geocode (Google-primary, UAE-restricted). Any stop we can't
        // resolve is skipped (rare — happens only when a name is completely
        // ambiguous) and reported via the surfaced errors below.
        const allStops = (route.stops ?? []).sort((a, b) => a.sequence - b.sequence);

        // Stops the geocoder couldn't place. They are kept, not discarded:
        // saving replaces the route's whole stop set, so anything missing
        // from the waypoint list is deleted. Dropping a stop because a
        // third-party geocoder didn't recognise its name would be silent
        // data loss — the operator typed that name for a reason.
        const unresolved: { label: string; stopName: string; sequence: number }[] = [];
        const resolved = await Promise.all(allStops.map(async s => {
          if (s.gpsLat != null && s.gpsLng != null) {
            return { id: s.id, stopName: s.stopName, gpsLat: s.gpsLat, gpsLng: s.gpsLng };
          }
          // Fall back to route origin/destination names if the stop name
          // itself is empty — happens on legacy stops that had only coords.
          const query = s.stopName?.trim();
          if (!query) {
            unresolved.push({ label: `(unnamed stop #${s.sequence})`, stopName: s.stopName ?? '', sequence: s.sequence });
            return null;
          }
          try {
            const gcRes = await fetch(`/api/route-optimizer/geocode?q=${encodeURIComponent(query)}`);
            const gcData = await gcRes.json();
            const first = gcData.results?.[0];
            if (first && typeof first.lat === 'number' && typeof first.lng === 'number') {
              return { id: s.id, stopName: s.stopName, gpsLat: first.lat, gpsLng: first.lng };
            }
          } catch { /* fall through */ }
          unresolved.push({ label: query, stopName: s.stopName, sequence: s.sequence });
          return null;
        }));
        if (cancelled) return;

        const stops = resolved.filter((s): s is { id: string; stopName: string; gpsLat: number; gpsLng: number } => s !== null);

        const wps: Waypoint[] = [];
        if (stops.length > 0) {
          const first = stops[0];
          wps.push({
            id: `origin-${first.id}`, label: first.stopName,
            lat: first.gpsLat, lng: first.gpsLng, type: 'origin',
          });
          for (let i = 1; i < stops.length - 1; i++) {
            const s = stops[i];
            wps.push({
              id: `stop-${s.id}`, label: s.stopName,
              lat: s.gpsLat, lng: s.gpsLng, type: 'stop',
            });
          }
          if (stops.length > 1) {
            const last = stops[stops.length - 1];
            wps.push({
              id: `dest-${last.id}`, label: last.stopName,
              lat: last.gpsLat, lng: last.gpsLng, type: 'destination',
            });
          }
        }

        setInitialWaypoints(wps);
        setEditingRouteName(route.name);
        setRouteName(route.name);
        // Mark as manually-edited so the auto-suggest logic doesn't
        // clobber the loaded name when waypoints come in.
        setRouteNameManuallyEdited(true);

        setUnresolvedStops(unresolved);
        if (unresolved.length > 0) {
          setError(
            `Loaded ${stops.length} of ${allStops.length} stops on the map. Couldn't locate ${unresolved.length} `
            + `(${unresolved.slice(0, 3).map(u => u.label).join(', ')}${unresolved.length > 3 ? '…' : ''}). `
            + `These are kept on the route and will be saved with their names, but they have no coordinates, `
            + `so they are not optimised and the route still counts as under-geocoded. `
            + `Add them again with the map picker (📍) to include them in the solve.`,
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load route');
      } finally {
        if (!cancelled) setLoadingRoute(false);
      }
    })();
    return () => { cancelled = true; };
  }, [editId]);

  const handleSave = async (route: RouteResult, waypoints: Waypoint[]) => {
    setError(null);
    try {
      const origin      = waypoints.find(w => w.type === 'origin');
      const destination = waypoints.find(w => w.type === 'destination');
      const stops       = waypoints.filter(w => w.type === 'stop');

      // Route name — operator's value from the input takes precedence. Only
      // auto-generate if the field is empty (shouldn't happen — save button
      // is disabled below when name is blank — but keep the fallback so we
      // never save a nameless route to the DB).
      const finalName = routeName.trim()
        || (origin && destination
              ? `${origin.label.slice(0, 30)} → ${destination.label.slice(0, 30)}`
              : `Staff Route ${new Date().toLocaleDateString('en-AE')}`);

      const body = {
        name:                 finalName,
        origin:               origin?.label ?? '',
        destination:          destination?.label ?? '',
        routeType:            'STAFF',
        totalDistanceKm:      route.summary.distanceKm,
        estimatedDurationMins: Math.round(route.summary.durationMin),
        // Only new routes start inactive; keeping the existing isActive on
        // edit avoids surprising the operator by deactivating a live route.
        ...(editId ? {} : { isActive: false }),
        notes: `Optimised route — ${route.summary.distanceKm} km · ${route.summary.durationHuman} · AED ${route.summary.fuelCostAED} fuel est.`,
        stops: [
          // First stop = origin
          ...(origin ? [{
            stopName: origin.label, sequence: 1,
            gpsLng: origin.lng, gpsLat: origin.lat,
          }] : []),
          // Intermediate stops
          ...stops.map((s, i) => ({
            stopName: s.label, sequence: i + 2,
            gpsLng: s.lng, gpsLat: s.lat,
          })),
          // Last stop = destination
          ...(destination ? [{
            stopName: destination.label, sequence: stops.length + 2,
            gpsLng: destination.lng, gpsLat: destination.lat,
          }] : []),
          // Stops the geocoder couldn't place, carried through unchanged so
          // the save doesn't delete them. They keep their names and stay
          // without coordinates; they sit after the destination because the
          // solver never saw them and we have no basis for placing them in
          // the optimised order. Re-picking one on the map replaces it with
          // a real waypoint on the next load.
          ...unresolvedStops.map((u, i) => ({
            stopName: u.stopName,
            sequence: stops.length + 3 + i,
            gpsLng: null as number | null,
            gpsLat: null as number | null,
          })),
        ],
      };

      // Edit → PATCH the same id. New → POST.
      const res = editId
        ? await fetch(`/api/bus-ops/routes/${editId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch('/api/bus-ops/routes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSaved(data.id ?? 'saved');
      setTimeout(() => router.push('/bus-ops/routes'), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save route');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Route Optimization</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {mode === 'fleet'
              ? 'Whole-fleet VRPTW solve — reassign passengers across vehicles to minimise total distance.'
              : editId && editingRouteName
                ? `Optimising "${editingRouteName}" — changes save back to the same route.`
                : 'Plan and optimise the stop order of a single route.'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-purple-400 bg-purple-500/10 border border-purple-500/20 px-3 py-1.5 rounded-full">
          🗺️ Hybrid Routing
        </div>
      </div>

      {/* Mode toggle — Single Route (TSP + Mapbox) vs Fleet Planner (VRPTW + Google) */}
      <div className="inline-flex rounded-xl bg-slate-800/60 border border-white/10 p-1">
        <button
          type="button"
          onClick={() => switchMode('single')}
          className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            mode === 'single'
              ? 'bg-violet-500/20 text-violet-100 border border-violet-500/40'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <RouteIcon className="w-4 h-4" /> Single Route
        </button>
        <button
          type="button"
          onClick={() => switchMode('fleet')}
          className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            mode === 'fleet'
              ? 'bg-violet-500/20 text-violet-100 border border-violet-500/40'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Users className="w-4 h-4" /> Fleet Planner
        </button>
      </div>

      {mode === 'fleet' ? (
        <FleetPlanner />
      ) : (
        <>

      {saved && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-emerald-400 text-lg">✅</span>
          <div>
            <p className="text-emerald-300 text-sm font-semibold">
              {editId ? 'Route updated successfully' : 'Route saved successfully'}
            </p>
            <p className="text-emerald-400/70 text-xs">Redirecting to Routes…</p>
          </div>
        </div>
      )}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
          ⚠️ {error}
        </div>
      )}

      {loadingRoute ? (
        <div className="rounded-2xl bg-slate-800/60 border border-white/10 p-12 text-center text-slate-500 text-sm animate-pulse">
          Loading route…
        </div>
      ) : (
        <>
          {/* Route Name — required, editable at any time. Also serves as the
              existing-route picker via a native datalist + a dedicated
              "Pick existing" select on the right. Choosing an existing route
              switches the URL to ?edit=<id> so the load effect (fetch +
              stops→waypoints + PATCH on save) kicks in. */}
          <div className="rounded-2xl bg-slate-800/60 border border-white/10 p-4 space-y-2">
            <label className="block text-xs text-slate-400 uppercase tracking-wider font-medium">
              Route name <span className="text-rose-400">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                list="rp-existing-routes"
                value={routeName}
                onChange={e => { setRouteName(e.target.value); setRouteNameManuallyEdited(true); }}
                placeholder="Type a new name or pick from existing…"
                className="flex-1 px-4 py-2.5 rounded-xl bg-slate-900/60 border border-white/10 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500"
              />
              <datalist id="rp-existing-routes">
                {routeOptions.map(r => <option key={r.id} value={r.name} />)}
              </datalist>
              <select
                value={editId ?? ''}
                onChange={e => {
                  const id = e.target.value;
                  router.push(id ? `/bus-ops/route-planner?edit=${id}` : '/bus-ops/route-planner');
                }}
                title="Load an existing route to optimize"
                className="w-56 px-3 py-2.5 rounded-xl bg-slate-900/60 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-500"
              >
                <option value="">— Pick existing route —</option>
                {routeOptions.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.code ? `[${r.code}] ` : ''}{r.name} · {r.stopCount} stops{r.isActive === false ? ' (inactive)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-slate-500">
              Auto-suggested from origin and destination. Pick from the dropdown to load an existing route's stops.
            </p>
          </div>

          <RouteOptimizerPanel
            // Force a fresh mount every time the loaded route changes.
            // RouteOptimizerPanel reads initialWaypoints only in its
            // useState initializer — later prop updates were being
            // silently ignored, so picking a different route from the
            // dropdown loaded the data but the map / stops list stayed on
            // the previous route. Re-keying on editId cleanly rebuilds
            // internal waypoint state from the fresh initialWaypoints.
            key={editId ?? 'new'}
            mode="staff"
            vehicleType="bus"
            onSave={handleSave}
            initialWaypoints={initialWaypoints ?? []}
            autoOptimizeOnMount={autoOptimize}
            onWaypointsChange={wps => {
              // Auto-suggest a name only when the operator hasn't typed
              // anything of their own yet — don't overwrite manual input.
              if (routeNameManuallyEdited) return;
              const o = wps.find(w => w.type === 'origin');
              const d = wps.find(w => w.type === 'destination');
              if (o && d) setRouteName(`${o.label.slice(0, 25)} → ${d.label.slice(0, 25)}`);
            }}
          />
        </>
      )}
        </>
      )}
    </div>
  );
}

export default function StaffRoutePlannerPage() {
  // Suspense boundary — useSearchParams needs one at the tree boundary in
  // Next.js 15 or hydration warnings fire.
  return (
    <Suspense fallback={<div className="text-slate-500 text-sm">Loading…</div>}>
      <RoutePlannerInner />
    </Suspense>
  );
}
