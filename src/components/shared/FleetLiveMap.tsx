'use client';
/**
 * FleetLiveMap — Google Maps view of live vehicle positions for the
 * /bus-ops/live-map page.
 *
 * Rendering rules:
 *   - Each vehicle is a Marker whose colour reflects its status
 *     (EN_ROUTE / AT_STOP / IDLE / OFFLINE / BREAKDOWN).
 *   - Vehicles offline for >5 minutes render at reduced opacity so operators
 *     can still see where the last-known position was, but they visibly fade.
 *   - Selection: clicking a marker fires onSelect(id). The selected marker
 *     gets a pulsing outer ring drawn with a Circle overlay (metres-accurate
 *     so it scales with zoom instead of drifting off the marker).
 *   - Auto-fit: the map re-fits to the current set of visible positions the
 *     first time positions arrive, and again whenever the count changes.
 *     It does NOT re-fit on every ping — that would fight the operator
 *     panning the map during monitoring.
 *
 * ssr:false required — the loader touches window.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  loadGoogleMaps,
  type GMapsMap,
  type GMapsMarker,
  type GMapsCircle,
} from '@/lib/google-maps-loader';

export interface VehiclePosition {
  id: string;
  vehicle_id: string;
  vehicle_plate: string | null;
  lat: number;
  lng: number;
  status: string;
  is_online: boolean;
  seconds_since_ping: number;
  speed_kmh: number;
}

interface Props {
  positions: VehiclePosition[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}

// Distinct, colour-blind-friendly-ish palette. Matches STATUS_CONFIG in the page.
const STATUS_COLOR: Record<string, string> = {
  EN_ROUTE:  '#22c55e', // green
  AT_STOP:   '#60a5fa', // blue
  IDLE:      '#94a3b8', // slate
  OFFLINE:   '#475569', // slate-dark
  BREAKDOWN: '#f87171', // red
};

const DEFAULT_CENTER = { lat: 24.4539, lng: 54.3773 }; // Abu Dhabi

/**
 * Data URL for a circular bus marker. Kept simple — Google's advanced
 * marker system requires a marker-library upgrade path we haven't taken;
 * a small SVG data URL passes cleanly as an Icon spec on the legacy Marker
 * and renders sharply at every zoom level.
 */
function busSvg(color: string, dim: boolean): string {
  const opacity = dim ? 0.45 : 1;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36' viewBox='0 0 36 36'>
    <circle cx='18' cy='18' r='14' fill='${color}' opacity='${opacity}' stroke='white' stroke-width='2'/>
    <text x='18' y='23' font-size='18' text-anchor='middle' font-family='Arial'>🚌</text>
  </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

export default function FleetLiveMap({ positions, selectedId, onSelect, className = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<GMapsMap | null>(null);
  const markersRef   = useRef<Map<string, GMapsMarker>>(new Map());
  const ringRef      = useRef<GMapsCircle | null>(null);
  const ctorsRef     = useRef<Awaited<ReturnType<typeof loadGoogleMaps>> | null>(null);
  const lastFitCountRef = useRef<number>(0);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Bootstrap map once.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then(ctors => {
      if (cancelled) return;
      ctorsRef.current = ctors;
      const el = containerRef.current;
      if (!el) return;
      if (!mapRef.current) {
        mapRef.current = new ctors.Map(el, {
          center: DEFAULT_CENTER,
          zoom: 11,
          zoomControl: true,
          gestureHandling: 'greedy',
          mapTypeControl: false,
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

  // Precompute icon URLs per (status, dim) so we don't re-encode a data URL
  // on every render frame.
  const iconFor = useMemo(() => {
    const cache = new Map<string, string>();
    return (status: string, dim: boolean) => {
      const key = `${status}|${dim ? 1 : 0}`;
      let url = cache.get(key);
      if (!url) {
        url = busSvg(STATUS_COLOR[status] ?? STATUS_COLOR.IDLE, dim);
        cache.set(key, url);
      }
      return url;
    };
  }, []);

  // Sync markers whenever positions change.
  useEffect(() => {
    const ctors = ctorsRef.current;
    const map = mapRef.current;
    if (!ctors || !map) return;

    const nextIds = new Set(positions.map(p => p.id));

    // Remove markers whose vehicle is no longer in the feed.
    markersRef.current.forEach((m, id) => {
      if (!nextIds.has(id)) {
        m.setMap(null);
        markersRef.current.delete(id);
      }
    });

    // Upsert markers.
    for (const p of positions) {
      const dim = !p.is_online;
      const iconUrl = iconFor(p.status, dim);
      const existing = markersRef.current.get(p.id);
      if (existing) {
        existing.setPosition({ lat: p.lat, lng: p.lng });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (existing as any).setIcon?.({ url: iconUrl, scaledSize: new (window as any).google.maps.Size(36, 36), anchor: new (window as any).google.maps.Point(18, 18) });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (existing as any).setTitle?.(p.vehicle_plate ?? p.vehicle_id);
      } else {
        const marker = new ctors.Marker({
          map,
          position: { lat: p.lat, lng: p.lng },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          icon: { url: iconUrl, scaledSize: new (window as any).google.maps.Size(36, 36), anchor: new (window as any).google.maps.Point(18, 18) },
          title: p.vehicle_plate ?? p.vehicle_id,
        });
        marker.addListener('click', () => onSelect(p.id));
        markersRef.current.set(p.id, marker);
      }
    }

    // Fit bounds only when the set of vehicles changes size (first load, or
    // a vehicle joins/leaves). Skipping the fit on every ping keeps operator
    // panning stable during monitoring.
    if (positions.length > 0 && positions.length !== lastFitCountRef.current) {
      const bounds = new ctors.LatLngBounds();
      positions.forEach(p => bounds.extend({ lat: p.lat, lng: p.lng }));
      map.fitBounds(bounds, 60);
      lastFitCountRef.current = positions.length;
    }
  }, [positions, iconFor, onSelect]);

  // Selection ring — pulses around the selected vehicle. Rebuild on selection
  // change or when the selected vehicle moves.
  useEffect(() => {
    const ctors = ctorsRef.current;
    const map = mapRef.current;
    if (!ctors || !map) return;

    ringRef.current?.setMap(null);
    ringRef.current = null;

    if (!selectedId) return;
    const sel = positions.find(p => p.id === selectedId);
    if (!sel) return;

    ringRef.current = new ctors.Circle({
      map,
      center: { lat: sel.lat, lng: sel.lng },
      radius: 180, // metres — visible at city zoom
      strokeColor: STATUS_COLOR[sel.status] ?? STATUS_COLOR.IDLE,
      strokeOpacity: 0.7,
      strokeWeight: 3,
      fillColor: STATUS_COLOR[sel.status] ?? STATUS_COLOR.IDLE,
      fillOpacity: 0.12,
      clickable: false,
    });
    map.panTo({ lat: sel.lat, lng: sel.lng });
  }, [selectedId, positions]);

  return (
    <div className={`relative rounded-2xl border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-surface)] ${className}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--text-muted)] bg-[var(--bg-surface)]/40">
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
