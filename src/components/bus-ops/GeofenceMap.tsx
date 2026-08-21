'use client';
/**
 * GeofenceMap — Google Map with custom drawing tools for the Geofence Management page.
 *
 * Renders every existing geofence as either a Circle (metres-accurate — the
 * radius scales with the map, unlike Google's icon circles) or a Polygon
 * coloured by type. When the operator picks a drawing tool, we use custom
 * click handlers to capture shapes. On completion we lift the geometry and hand it
 * up via onDraw so the parent can pop the metadata modal.
 *
 * NOTE: Google Maps DrawingManager was deprecated in v3.65, so we implement
 * custom drawing with map click listeners.
 *
 * ssr:false is REQUIRED — loadGoogleMaps touches window.
 */
import { useEffect, useRef, useState } from 'react';
import {
  loadGoogleMaps,
  type GMapsMap,
  type GMapsCircle,
  type GMapsPolygon,
  type GMapsEventListener,
} from '@/lib/google-maps-loader';

export type GeofenceType = 'STOP' | 'GARAGE' | 'ORIGIN_DESTINATION' | 'BASE_CAMP' | 'ACCOMMODATION';

export interface GeofenceRecord {
  id: string;
  name: string;
  type: GeofenceType;
  shape: 'CIRCLE' | 'POLYGON';
  centerLat: number | null;
  centerLng: number | null;
  radiusM: number | null;
  polygon: Array<{ lat: number; lng: number }> | null;
  active: boolean;
}

export type DrawResult =
  | { shape: 'CIRCLE';  centerLat: number; centerLng: number; radiusM: number }
  | { shape: 'POLYGON'; polygon: Array<{ lat: number; lng: number }> };

interface Props {
  geofences: GeofenceRecord[];
  selectedId?: string | null;
  drawMode: 'CIRCLE' | 'POLYGON' | null;
  onDraw: (result: DrawResult) => void;
  onSelect: (id: string) => void;
  className?: string;
}

const TYPE_COLORS: Record<GeofenceType, string> = {
  STOP:               '#8b5cf6', // violet
  GARAGE:             '#64748b', // slate
  ORIGIN_DESTINATION: '#10b981', // emerald
  BASE_CAMP:          '#f59e0b', // amber
  ACCOMMODATION:      '#0ea5e9', // sky
};

const DEFAULT_CENTER = { lat: 24.4539, lng: 54.3773 }; // Abu Dhabi

export default function GeofenceMap({
  geofences, selectedId, drawMode, onDraw, onSelect, className = '',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<GMapsMap | null>(null);
  // Overlays keyed by geofence id so we can dispose/replace individually.
  const overlaysRef  = useRef<Map<string, GMapsCircle | GMapsPolygon>>(new Map());
  const ctorsRef     = useRef<Awaited<ReturnType<typeof loadGoogleMaps>> | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Drawing state
  const drawingCircleRef = useRef<GMapsCircle | null>(null);
  const drawingPolygonRef = useRef<GMapsPolygon | null>(null);
  const polygonPointsRef = useRef<Array<{ lat: number; lng: number }>>([]);
  const clickListenerRef = useRef<GMapsEventListener | null>(null);

  // One-time map + drawing-manager bootstrap.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then(ctors => {
      if (cancelled) return;
      ctorsRef.current = ctors;
      const container = containerRef.current;
      if (!container) return;
      if (!mapRef.current) {
        mapRef.current = new ctors.Map(container, {
          center: DEFAULT_CENTER,
          zoom: 11,
          zoomControl: true,
          gestureHandling: 'greedy',
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
        });
      }
      setLoading(false);
    }).catch(err => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : 'Failed to load Google Maps');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Sync existing geofence overlays whenever the list changes.
  useEffect(() => {
    const ctors = ctorsRef.current;
    const map = mapRef.current;
    if (!ctors || !map) return;

    // Wipe & rebuild — simpler than a diff and there won't be thousands of
    // these per tenant. If perf becomes an issue we key-diff on id.
    overlaysRef.current.forEach(o => o.setMap(null));
    overlaysRef.current.clear();

    const bounds = new ctors.LatLngBounds();
    let hasAny = false;

    for (const gf of geofences) {
      const color = TYPE_COLORS[gf.type] ?? '#8b5cf6';
      const isSelected = gf.id === selectedId;
      const strokeWeight = isSelected ? 4 : 2;
      const fillOpacity  = gf.active ? (isSelected ? 0.35 : 0.15) : 0.05;

      if (gf.shape === 'CIRCLE' && gf.centerLat != null && gf.centerLng != null && gf.radiusM != null) {
        const c = new ctors.Circle({
          map,
          center: { lat: gf.centerLat, lng: gf.centerLng },
          radius: gf.radiusM,
          strokeColor: color, strokeWeight, strokeOpacity: 0.9,
          fillColor: color, fillOpacity,
          clickable: true,
        });
        c.addListener('click', () => onSelect(gf.id));
        overlaysRef.current.set(gf.id, c);
        bounds.extend({ lat: gf.centerLat, lng: gf.centerLng });
        hasAny = true;
      } else if (gf.shape === 'POLYGON' && Array.isArray(gf.polygon) && gf.polygon.length >= 3) {
        const p = new ctors.Polygon({
          map,
          paths: gf.polygon,
          strokeColor: color, strokeWeight, strokeOpacity: 0.9,
          fillColor: color, fillOpacity,
          clickable: true,
        });
        p.addListener('click', () => onSelect(gf.id));
        overlaysRef.current.set(gf.id, p);
        gf.polygon.forEach(pt => bounds.extend(pt));
        hasAny = true;
      }
    }

    if (hasAny) map.fitBounds(bounds, 60);
  }, [geofences, selectedId, onSelect]);

  // Drawing-mode toggle with custom drawing implementation
  useEffect(() => {
    const ctors = ctorsRef.current;
    const map = mapRef.current;
    if (!ctors || !map) return;

    // Clean up previous drawing state
    if (clickListenerRef.current) {
      clickListenerRef.current.remove();
      clickListenerRef.current = null;
    }
    if (drawingCircleRef.current) {
      drawingCircleRef.current.setMap(null);
      drawingCircleRef.current = null;
    }
    if (drawingPolygonRef.current) {
      drawingPolygonRef.current.setMap(null);
      drawingPolygonRef.current = null;
    }
    polygonPointsRef.current = [];

    if (!drawMode) return;

    // Set cursor style
    if (map.setOptions) {
      map.setOptions({ draggableCursor: 'crosshair' });
    }

    if (drawMode === 'CIRCLE') {
      let centerPoint: { lat: number; lng: number } | null = null;

      clickListenerRef.current = map.addListener('click', (e: any) => {
        const clickPos = { lat: e.latLng.lat(), lng: e.latLng.lng() };

        if (!centerPoint) {
          // First click - set center
          centerPoint = clickPos;
          drawingCircleRef.current = new ctors.Circle({
            map,
            center: centerPoint,
            radius: 100, // Initial 100m radius
            strokeColor: '#8b5cf6',
            strokeWeight: 2,
            strokeOpacity: 0.9,
            fillColor: '#8b5cf6',
            fillOpacity: 0.25,
            editable: true,
          });

          // Listen for radius changes
          drawingCircleRef.current.addListener('radius_changed', () => {
            // Radius is being adjusted
          });

          // Double-click or second click to finish
          const finishListener = map.addListener('click', () => {
            if (drawingCircleRef.current && centerPoint) {
              const center = drawingCircleRef.current.getCenter();
              const radius = drawingCircleRef.current.getRadius();

              const result: DrawResult = {
                shape: 'CIRCLE',
                centerLat: center?.lat() ?? centerPoint.lat,
                centerLng: center?.lng() ?? centerPoint.lng,
                radiusM: Math.round(radius),
              };

              drawingCircleRef.current.setMap(null);
              drawingCircleRef.current = null;
              centerPoint = null;
              finishListener.remove();

              onDraw(result);
            }
          });
        }
      });
    } else if (drawMode === 'POLYGON') {
      clickListenerRef.current = map.addListener('click', (e: any) => {
        const clickPos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
        polygonPointsRef.current.push(clickPos);

        if (drawingPolygonRef.current) {
          drawingPolygonRef.current.setMap(null);
        }

        drawingPolygonRef.current = new ctors.Polygon({
          map,
          paths: polygonPointsRef.current,
          strokeColor: '#8b5cf6',
          strokeWeight: 2,
          strokeOpacity: 0.9,
          fillColor: '#8b5cf6',
          fillOpacity: 0.25,
          editable: false,
          clickable: false,
        });

        // Double-click to finish (at least 3 points)
        if (polygonPointsRef.current.length >= 3) {
          const dblClickListener = map.addListener('dblclick', () => {
            if (drawingPolygonRef.current && polygonPointsRef.current.length >= 3) {
              const result: DrawResult = {
                shape: 'POLYGON',
                polygon: [...polygonPointsRef.current],
              };

              drawingPolygonRef.current.setMap(null);
              drawingPolygonRef.current = null;
              polygonPointsRef.current = [];
              dblClickListener.remove();

              onDraw(result);
            }
          });
        }
      });
    }

    // Cleanup on unmount or mode change
    return () => {
      if (clickListenerRef.current) {
        google.maps.event.removeListener(clickListenerRef.current);
      }
      if (drawingCircleRef.current) {
        drawingCircleRef.current.setMap(null);
      }
      if (drawingPolygonRef.current) {
        drawingPolygonRef.current.setMap(null);
      }
      if (map.setOptions) {
        map.setOptions({ draggableCursor: null });
      }
    };
  }, [drawMode, onDraw]);

  return (
    <div className={`relative rounded-2xl border border-white/10 overflow-hidden bg-slate-900 ${className}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400 bg-slate-800/40">
          Loading map…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-rose-300 bg-rose-500/10 p-4 text-center">
          {error}
        </div>
      )}
      {drawMode && !loading && !error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-slate-800 border border-violet-500/50 rounded-lg px-4 py-2 text-xs text-slate-200 shadow-lg z-10">
          {drawMode === 'CIRCLE' && (
            <div>
              <span className="font-semibold text-violet-300">Drawing Circle:</span>
              <span className="ml-2">Click to set center, click again to finish (adjust radius by dragging circle edge)</span>
            </div>
          )}
          {drawMode === 'POLYGON' && (
            <div>
              <span className="font-semibold text-violet-300">Drawing Polygon:</span>
              <span className="ml-2">Click to add points, double-click to finish (minimum 3 points)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
