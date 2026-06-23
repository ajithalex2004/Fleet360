'use client';
/**
 * MapView.tsx — Mapbox GL JS map loaded from CDN (no npm install needed).
 * Renders the route polyline, numbered markers for each waypoint.
 * Must be imported with next/dynamic + ssr:false.
 */
import { useEffect, useRef } from 'react';

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

const MODE_COLORS = {
  logistics: '#f59e0b', // amber
  staff:     '#8b5cf6', // purple
  school:    '#eab308', // yellow
};

declare global {
  interface Window {
    mapboxgl: {
      accessToken: string;
      Map: new (opts: object) => MapboxMap;
      Marker: new (opts?: object) => MapboxMarker;
      NavigationControl: new (opts?: object) => object;
      LngLatBounds: new () => MapboxBounds;
      Popup: new (opts?: object) => MapboxPopup;
    };
  }
}

interface MapboxMap {
  on(event: string, cb: () => void): void;
  addControl(control: object, position?: string): void;
  flyTo(opts: object): void;
  addSource(id: string, source: object): void;
  addLayer(layer: object): void;
  getSource(id: string): { setData: (data: object) => void } | undefined;
  getLayer(id: string): unknown;
  removeLayer(id: string): void;
  removeSource(id: string): void;
  fitBounds(bounds: MapboxBounds, opts: object): void;
  remove(): void;
}
interface MapboxMarker {
  setLngLat(coords: [number, number]): MapboxMarker;
  setPopup(popup: MapboxPopup): MapboxMarker;
  togglePopup(): MapboxMarker;
  addTo(map: MapboxMap): MapboxMarker;
  remove(): void;
}
interface MapboxBounds {
  extend(coords: [number, number]): MapboxBounds;
}
interface MapboxPopup {
  setHTML(html: string): MapboxPopup;
}

const MAPBOX_CDN_VERSION = '3.3.0';

function loadMapboxScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.mapboxgl) { resolve(); return; }
    // CSS
    const link = document.createElement('link');
    link.rel  = 'stylesheet';
    link.href = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_CDN_VERSION}/mapbox-gl.css`;
    document.head.appendChild(link);
    // JS
    const script = document.createElement('script');
    script.src   = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_CDN_VERSION}/mapbox-gl.js`;
    script.onload  = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Mapbox GL JS'));
    document.head.appendChild(script);
  });
}

export default function MapView({ waypoints, routeGeometry, mode = 'logistics', className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<MapboxMap | null>(null);
  const markersRef   = useRef<MapboxMarker[]>([]);
  const accentColor  = MODE_COLORS[mode];

  // Initialize map once
  useEffect(() => {
    const publicToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!publicToken) return; // Token not configured — show placeholder

    let cancelled = false;

    loadMapboxScript().then(() => {
      if (cancelled || !containerRef.current || mapRef.current) return;

      window.mapboxgl.accessToken = publicToken;
      const map = new window.mapboxgl.Map({
        container: containerRef.current,
        style:     'mapbox://styles/mapbox/dark-v11',
        center:    [55.2708, 25.2048], // Dubai default
        zoom:      10,
      });

      mapRef.current = map;

      map.on('load', () => {
        // Route line source
        map.addSource('route', {
          type: 'geojson',
          data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} },
        });
        map.addLayer({
          id:   'route-line',
          type: 'line',
          source: 'route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint:  { 'line-color': accentColor, 'line-width': 4, 'line-opacity': 0.85 },
        });
      });
    }).catch(console.error);

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update markers whenever waypoints change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.mapboxgl) return;

    // Clear old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    if (!waypoints.length) return;

    const bounds = new window.mapboxgl.LngLatBounds();

    waypoints.forEach((wp, idx) => {
      const color =
        wp.type === 'origin'      ? '#10b981' : // emerald
        wp.type === 'destination' ? '#ef4444' : // red
        accentColor;

      const el = document.createElement('div');
      el.style.cssText = `
        width:32px;height:32px;border-radius:50%;
        background:${color};border:3px solid white;
        display:flex;align-items:center;justify-content:center;
        font-weight:700;font-size:13px;color:white;
        box-shadow:0 2px 8px rgba(0,0,0,0.5);cursor:pointer;
      `;
      el.textContent = wp.type === 'origin' ? 'S' : wp.type === 'destination' ? 'E' : String(idx);

      const popup = new window.mapboxgl.Popup({ offset: 25 }).setHTML(`
        <div style="font-family:sans-serif;padding:4px 8px">
          <strong style="font-size:12px">${wp.label}</strong>
          <div style="font-size:11px;color:#888;margin-top:2px">${wp.type.toUpperCase()}</div>
        </div>
      `);

      const marker = new window.mapboxgl.Marker({ element: el })
        .setLngLat([wp.lng, wp.lat])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.push(marker);
      bounds.extend([wp.lng, wp.lat]);
    });

    map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 800 });
  }, [waypoints, accentColor]);

  // Update route polyline whenever routeGeometry changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const waitForSource = () => {
      const src = map.getSource('route');
      if (src) {
        src.setData({
          type: 'Feature',
          geometry: routeGeometry ?? { type: 'LineString', coordinates: [] },
          properties: {},
        });
      } else {
        setTimeout(waitForSource, 200);
      }
    };
    waitForSource();
  }, [routeGeometry]);

  const publicToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  if (!publicToken) {
    return (
      <div className={`flex flex-col items-center justify-center bg-slate-900/60 border border-white/10 rounded-2xl ${className ?? 'h-96'}`}>
        <div className="text-4xl mb-3">🗺️</div>
        <p className="text-slate-400 text-sm font-medium">Map not configured</p>
        <p className="text-slate-600 text-xs mt-1 text-center max-w-xs">
          Add <code className="bg-slate-800 px-1 rounded text-amber-400">NEXT_PUBLIC_MAPBOX_TOKEN=pk.xxx</code> to .env.local
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`rounded-2xl overflow-hidden border border-white/10 ${className ?? 'h-96'}`}
    />
  );
}
