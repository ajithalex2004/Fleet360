'use client';
/**
 * GeofenceMap — Google Map + DrawingManager for the Geofence Management page.
 *
 * Renders every existing geofence as either a Circle (metres-accurate — the
 * radius scales with the map, unlike Google's icon circles) or a Polygon
 * coloured by type. When the operator picks a drawing tool, DrawingManager
 * takes over; on completion we lift the geometry off the overlay and hand it
 * up via onDraw so the parent can pop the metadata modal. We immediately
 * remove the DrawingManager's own overlay because the parent will re-render
 * from the freshly-created row (single source of truth).
 *
 * ssr:false is REQUIRED — loadGoogleMaps touches window.
 */
import { useEffect, useRef, useState } from 'react';
import {
  loadGoogleMaps,
  type GMapsMap,
  type GMapsCircle,
  type GMapsPolygon,
  type GMapsDrawingManager,
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
  const drawingRef   = useRef<GMapsDrawingManager | null>(null);
  // Overlays keyed by geofence id so we can dispose/replace individually.
  const overlaysRef  = useRef<Map<string, GMapsCircle | GMapsPolygon>>(new Map());
  const ctorsRef     = useRef<Awaited<ReturnType<typeof loadGoogleMaps>> | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  // Drawing-mode toggle. Lazy-create the DrawingManager the first time it's
  // needed to keep the initial map render fast for read-only viewing.
  useEffect(() => {
    const ctors = ctorsRef.current;
    const map = mapRef.current;
    if (!ctors || !map) return;

    if (!drawingRef.current) {
      drawingRef.current = new ctors.DrawingManager({
        drawingMode: null,
        drawingControl: false, // we drive the mode from the sidebar buttons
        circleOptions:  { strokeColor: '#8b5cf6', fillColor: '#8b5cf6', fillOpacity: 0.25, editable: false, clickable: false },
        polygonOptions: { strokeColor: '#8b5cf6', fillColor: '#8b5cf6', fillOpacity: 0.25, editable: false, clickable: false },
      });
      drawingRef.current.setMap(map);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      drawingRef.current.addListener('circlecomplete', (circle: any) => {
        const centre = circle.getCenter();
        const result: DrawResult = {
          shape: 'CIRCLE',
          centerLat: centre.lat(),
          centerLng: centre.lng(),
          radiusM: Math.round(circle.getRadius()),
        };
        circle.setMap(null); // parent will re-render from the created row
        drawingRef.current?.setDrawingMode(null);
        onDraw(result);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      drawingRef.current.addListener('polygoncomplete', (polygon: any) => {
        const path = polygon.getPath().getArray().map((p: { lat(): number; lng(): number }) => ({
          lat: p.lat(), lng: p.lng(),
        }));
        polygon.setMap(null);
        drawingRef.current?.setDrawingMode(null);
        onDraw({ shape: 'POLYGON', polygon: path });
      });
    }

    const mode =
      drawMode === 'CIRCLE'  ? ctors.OverlayType.CIRCLE :
      drawMode === 'POLYGON' ? ctors.OverlayType.POLYGON :
      null;
    drawingRef.current.setDrawingMode(mode);
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
    </div>
  );
}
