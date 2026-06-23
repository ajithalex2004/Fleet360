'use client';
/**
 * ShipmentTrackingMap — live map of a shipment's geofences + position.
 *
 * Loads Mapbox GL JS from CDN (no npm dependency — same pattern as the
 * route-optimizer MapView) and draws, for one shipment:
 *   - geofence zones: a metres-accurate circle polygon per stop (pickup
 *     green, delivery red), so the customer can see the arrival zones
 *   - stop markers
 *   - the recent GPS trail as a breadcrumb line
 *   - the live truck marker at the latest position
 *
 * Data comes from GET /api/logistics/shipments/[id]/tracking-map. Import via
 * next/dynamic with ssr:false (it touches window).
 */

import { useEffect, useRef, useState } from 'react';

// Minimal local typings for the CDN global — intentionally NOT a `declare
// global` (MapView already declares Window.mapboxgl; re-declaring risks a
// conflict). We reach the global through a cast instead.
interface MapboxMap {
  on(event: string, cb: () => void): void;
  addControl(control: object, position?: string): void;
  addSource(id: string, source: object): void;
  addLayer(layer: object): void;
  fitBounds(bounds: MapboxBounds, opts: object): void;
  remove(): void;
}
interface MapboxMarker {
  setLngLat(coords: [number, number]): MapboxMarker;
  setPopup(popup: MapboxPopup): MapboxMarker;
  addTo(map: MapboxMap): MapboxMarker;
  remove(): void;
}
interface MapboxBounds { extend(coords: [number, number]): MapboxBounds; }
interface MapboxPopup { setHTML(html: string): MapboxPopup; }
interface MapboxGL {
  accessToken: string;
  Map: new (opts: object) => MapboxMap;
  Marker: new (opts?: object) => MapboxMarker;
  NavigationControl: new (opts?: object) => object;
  LngLatBounds: new () => MapboxBounds;
  Popup: new (opts?: object) => MapboxPopup;
}
function gl(): MapboxGL | null {
  return (window as unknown as { mapboxgl?: MapboxGL }).mapboxgl ?? null;
}

const MAPBOX_CDN_VERSION = '3.3.0';

function loadMapboxScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (gl()) { resolve(); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_CDN_VERSION}/mapbox-gl.css`;
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_CDN_VERSION}/mapbox-gl.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Mapbox GL JS'));
    document.head.appendChild(script);
  });
}

const EARTH_R_M = 6_371_000;
/** Metres-accurate circle ring as [lng,lat] (see geofence.ts circleToPolygon — tested there). */
function circleRing(lat: number, lng: number, radiusM: number, segments = 64): Array<[number, number]> {
  const rad = Math.PI / 180;
  const latRad = lat * rad;
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * 2 * Math.PI;
    const dLat = (radiusM * Math.cos(theta) / EARTH_R_M) * (180 / Math.PI);
    const dLng = (radiusM * Math.sin(theta) / (EARTH_R_M * Math.cos(latRad))) * (180 / Math.PI);
    ring.push([lng + dLng, lat + dLat]);
  }
  return ring;
}

interface Stop { id: string; type: string; latitude: number; longitude: number; label: string | null; radiusM: number; }
interface TrailPoint { latitude: number; longitude: number; at: string; }
interface MapData {
  shipmentNo: string | null;
  stops: Stop[];
  trail: TrailPoint[];
  latest: TrailPoint | null;
}

const PICKUP_COLOR = '#10b981';   // emerald
const DELIVERY_COLOR = '#ef4444'; // red
const TRAIL_COLOR = '#38bdf8';    // sky

export default function ShipmentTrackingMap({ shipmentId, className }: { shipmentId: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<MapboxMarker[]>([]);
  const [data, setData] = useState<MapData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch the map payload for this shipment.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/logistics/shipments/${shipmentId}/tracking-map`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as MapData;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load map data');
      }
    })();
    return () => { cancelled = true; };
  }, [shipmentId]);

  // Build the map once data + Mapbox are ready.
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token || !data) return;
    let cancelled = false;

    loadMapboxScript().then(() => {
      const mb = gl();
      if (cancelled || !containerRef.current || mapRef.current || !mb) return;

      mb.accessToken = token;
      const center: [number, number] = data.latest
        ? [data.latest.longitude, data.latest.latitude]
        : data.stops[0] ? [data.stops[0].longitude, data.stops[0].latitude] : [55.2708, 25.2048];

      const map = new mb.Map({ container: containerRef.current, style: 'mapbox://styles/mapbox/dark-v11', center, zoom: 10 });
      mapRef.current = map;
      map.addControl(new mb.NavigationControl(), 'top-right');

      map.on('load', () => {
        if (cancelled) return;
        const bounds = new mb.LngLatBounds();

        // Geofence zones (one circle polygon per stop).
        data.stops.forEach(stop => {
          const ring = circleRing(stop.latitude, stop.longitude, stop.radiusM);
          ring.forEach(c => bounds.extend(c));
          const color = stop.type === 'PICKUP' ? PICKUP_COLOR : stop.type === 'DELIVERY' ? DELIVERY_COLOR : '#a3a3a3';
          const srcId = `geofence-${stop.id}`;
          map.addSource(srcId, {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } },
          });
          map.addLayer({ id: `${srcId}-fill`, type: 'fill', source: srcId, paint: { 'fill-color': color, 'fill-opacity': 0.12 } });
          map.addLayer({ id: `${srcId}-line`, type: 'line', source: srcId, paint: { 'line-color': color, 'line-width': 2, 'line-opacity': 0.7 } });

          // Stop marker.
          const el = document.createElement('div');
          el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 2px ${color}55;`;
          const popup = new mb.Popup({ offset: 16 }).setHTML(
            `<strong>${stop.type === 'PICKUP' ? 'Pickup' : stop.type === 'DELIVERY' ? 'Delivery' : 'Stop'}</strong><br/>${stop.label ?? ''}<br/><span style="opacity:.7">geofence ${stop.radiusM}m</span>`,
          );
          const m = new mb.Marker({ element: el }).setLngLat([stop.longitude, stop.latitude]).setPopup(popup).addTo(map);
          markersRef.current.push(m);
        });

        // GPS trail (breadcrumb line).
        if (data.trail.length >= 2) {
          const coords = data.trail.map(p => [p.longitude, p.latitude] as [number, number]);
          coords.forEach(c => bounds.extend(c));
          map.addSource('trail', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } });
          map.addLayer({ id: 'trail-line', type: 'line', source: 'trail', paint: { 'line-color': TRAIL_COLOR, 'line-width': 3, 'line-opacity': 0.8 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
        }

        // Live truck marker.
        if (data.latest) {
          const el = document.createElement('div');
          el.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#f59e0b;border:3px solid #fff;box-shadow:0 0 0 4px #f59e0b66;';
          const popup = new mb.Popup({ offset: 18 }).setHTML(`<strong>${data.shipmentNo ?? 'Shipment'}</strong><br/>Live position`);
          const m = new mb.Marker({ element: el }).setLngLat([data.latest.longitude, data.latest.latitude]).setPopup(popup).addTo(map);
          markersRef.current.push(m);
          bounds.extend([data.latest.longitude, data.latest.latitude]);
        }

        try { map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 }); } catch { /* empty bounds */ }
      });
    }).catch(() => setError('Map failed to load'));

    return () => {
      cancelled = true;
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [data]);

  if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
    return <div className={`flex items-center justify-center rounded-xl border border-white/10 bg-slate-900/50 text-sm text-slate-500 ${className ?? ''}`} style={{ minHeight: 280 }}>Map unavailable — NEXT_PUBLIC_MAPBOX_TOKEN not configured.</div>;
  }
  if (error) {
    return <div className={`flex items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 text-sm text-red-300 ${className ?? ''}`} style={{ minHeight: 280 }}>{error}</div>;
  }
  return (
    <div className={`relative overflow-hidden rounded-xl border border-white/10 ${className ?? ''}`} style={{ minHeight: 320 }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {!data && <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">Loading map…</div>}
    </div>
  );
}
