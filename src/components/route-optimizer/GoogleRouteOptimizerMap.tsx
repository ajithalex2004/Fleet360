'use client';
/**
 * GoogleRouteOptimizerMap.tsx — Google Maps version of MapView.tsx.
 *
 * Same public interface (waypoints array + optional GeoJSON route geometry),
 * different SDK. Uses the shared google-maps-loader so the SDK downloads
 * once per session and is cached across every Google-based map in the app
 * (pickers, route previews, driver navigation).
 *
 * Rendering rules:
 *   - Numbered markers per waypoint, coloured by mode (matches the panel)
 *   - Polyline drawn from routeGeometry (an array of [lng, lat] pairs
 *     returned by /api/route-optimizer/optimize)
 *   - Map auto-fits to include every waypoint + polyline point
 *
 * Must be imported with next/dynamic + ssr:false — the SDK loader requires
 * `window` and would throw during server render otherwise.
 */
import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, type GMapsMap, type GMapsMarker, type GMapsPolyline } from '@/lib/google-maps-loader';

interface Waypoint {
  id: string;
  label: string;
  lng: number;
  lat: number;
  type: 'origin' | 'stop' | 'destination';
}

interface Props {
  waypoints: Waypoint[];
  routeGeometry?: GeoJSON.LineString | null;
  mode?: 'logistics' | 'staff' | 'school';
  className?: string;
}

// Match the palette used by RouteOptimizerPanel.MODE_CONFIG so the map
// visually agrees with the panel chrome.
const MODE_COLORS = {
  logistics: '#f59e0b', // amber
  staff:     '#8b5cf6', // purple (bus-ops accent)
  school:    '#eab308', // yellow
};

const DEFAULT_CENTER = { lat: 24.4539, lng: 54.3773 }; // Abu Dhabi

export default function GoogleRouteOptimizerMap({
  waypoints,
  routeGeometry,
  mode = 'staff',
  className = '',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GMapsMap | null>(null);
  const markersRef = useRef<GMapsMarker[]>([]);
  const polylineRef = useRef<GMapsPolyline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps().then((ctors) => {
      if (cancelled) return;
      const container = containerRef.current;
      if (!container) return;

      // Create the map once; subsequent renders reuse it.
      if (!mapRef.current) {
        mapRef.current = new ctors.Map(container, {
          center: DEFAULT_CENTER,
          zoom: 11,
          // Zoom in/out corner + gesture zoom (scroll wheel, pinch) explicitly
          // enabled. Google defaults zoomControl to true but has been known
          // to hide it below certain viewport widths — force it on so the
          // operator always has the ± buttons.
          zoomControl: true,
          gestureHandling: 'greedy',
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });
      }
      const map = mapRef.current;

      // Wipe prior markers + polyline before redrawing. Cheaper than a
      // full remount and avoids marker leaks across re-renders.
      markersRef.current.forEach(m => m.setMap(null));
      markersRef.current = [];
      polylineRef.current?.setMap(null);
      polylineRef.current = null;

      const modeColor = MODE_COLORS[mode];

      // Numbered markers. Origin = "A", stops = "1"…"N", destination = "B" —
      // same convention as GoogleRoutePreviewMap so the operator sees one
      // consistent language across the app.
      const stopIdx = waypoints.filter(w => w.type === 'stop');
      waypoints.forEach(wp => {
        let label = '';
        if (wp.type === 'origin') label = 'A';
        else if (wp.type === 'destination') label = 'B';
        else label = String(stopIdx.indexOf(wp) + 1);

        markersRef.current.push(new ctors.Marker({
          map,
          position: { lat: wp.lat, lng: wp.lng },
          label: { text: label, color: 'white', fontWeight: 'bold' },
          title: wp.label,
        }));
      });

      // Polyline. Route geometry from the optimizer API is [lng, lat] pairs
      // (GeoJSON convention); Google wants { lat, lng } objects.
      if (routeGeometry?.coordinates?.length) {
        const path = routeGeometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
        polylineRef.current = new ctors.Polyline({
          map,
          path,
          strokeColor: modeColor,
          strokeOpacity: 0.9,
          strokeWeight: 4,
        });
      }

      // Fit to everything: every waypoint + every polyline vertex.
      const bounds = new ctors.LatLngBounds();
      waypoints.forEach(wp => bounds.extend({ lat: wp.lat, lng: wp.lng }));
      routeGeometry?.coordinates?.forEach(([lng, lat]) => bounds.extend({ lat, lng }));
      if (waypoints.length > 0 || routeGeometry?.coordinates?.length) {
        map.fitBounds(bounds, 40);
      }

      setLoading(false);
    }).catch((err) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : 'Failed to load Google Maps');
      setLoading(false);
    });

    return () => { cancelled = true; };
  // JSON.stringify used as a stable dep for the arrays — object identity
  // changes on every render even when values equal, which would cause the
  // map to flicker/redraw for no reason.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(waypoints),
    JSON.stringify(routeGeometry ?? null),
    mode,
  ]);

  return (
    <div className={`relative rounded-2xl border border-white/10 overflow-hidden bg-slate-900 ${className}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {loading && !error && waypoints.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500 bg-slate-800/40">
          Loading map…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-rose-300 bg-rose-500/10 p-4 text-center">
          {error}
        </div>
      )}
    </div>
  );
}
