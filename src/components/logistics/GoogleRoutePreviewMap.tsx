'use client';
/**
 * GoogleRoutePreviewMap — renders a Google Maps preview of a computed route.
 *
 * Given:
 *   - An encoded polyline (from Google Directions API)
 *   - Optional bounds (northeast/southwest lat/lng, also from Directions)
 *   - Optional origin/destination markers
 *
 * Draws them on an interactive map that auto-fits to the route bounds. Uses
 * the shared google-maps-loader so it doesn't double-download the SDK.
 *
 * Cheap to mount: renders a placeholder when no polyline is provided; only
 * calls loadGoogleMaps once a polyline arrives.
 */

import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, type GMapsMap, type GMapsMarker, type GMapsPolyline } from '@/lib/google-maps-loader';

interface Props {
  encodedPolyline: string | null;
  bounds?: {
    northeast: { latitude: number; longitude: number };
    southwest: { latitude: number; longitude: number };
  } | null;
  originCoords?:      { latitude: number; longitude: number } | null;
  destinationCoords?: { latitude: number; longitude: number } | null;
  /** Additional intermediate stop markers, in order. */
  stopCoords?: Array<{ latitude: number; longitude: number; label?: string }>;
  /** When true, dims the map + shows a "Recomputing…" overlay so the operator
   *  sees the change was registered while the new route is being calculated. */
  recomputing?: boolean;
  className?: string;
  heightPx?: number;
}

export default function GoogleRoutePreviewMap({
  encodedPolyline, bounds, originCoords, destinationCoords, stopCoords, recomputing, className, heightPx = 260,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GMapsMap | null>(null);
  const polylineRef = useRef<GMapsPolyline | null>(null);
  const markersRef = useRef<GMapsMarker[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!encodedPolyline) return;
    let cancelled = false;

    loadGoogleMaps().then((ctors) => {
      if (cancelled) return;
      const container = containerRef.current;
      if (!container) return;

      // Clean up any prior map / markers / polyline from a previous render.
      markersRef.current.forEach(m => m.setMap(null));
      markersRef.current = [];
      polylineRef.current?.setMap(null);

      // Create the map if we don't have one yet — reuse existing for updates.
      let map = mapRef.current;
      if (!map) {
        map = new ctors.Map(container, {
          center: originCoords ? { lat: originCoords.latitude, lng: originCoords.longitude } : { lat: 24.4539, lng: 54.3773 }, // Abu Dhabi default
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        mapRef.current = map;
      }

      // Decode the polyline into lat/lng points and draw it.
      const path = ctors.decodePath(encodedPolyline).map(p => ({ lat: p.lat(), lng: p.lng() }));
      polylineRef.current = new ctors.Polyline({
        map,
        path,
        strokeColor: '#8b5cf6',    // violet-500, matches the bus-ops theme
        strokeOpacity: 0.9,
        strokeWeight: 4,
      });

      // Origin marker (green-ish styling implicit via letter).
      if (originCoords) {
        markersRef.current.push(new ctors.Marker({
          map, position: { lat: originCoords.latitude, lng: originCoords.longitude },
          label: { text: 'A', color: 'white', fontWeight: 'bold' },
          title: 'Origin',
        }));
      }
      // Intermediate stops.
      (stopCoords ?? []).forEach((s, i) => {
        markersRef.current.push(new ctors.Marker({
          map, position: { lat: s.latitude, lng: s.longitude },
          label: { text: String(i + 1), color: 'white', fontWeight: 'bold' },
          title: s.label ?? `Stop ${i + 1}`,
        }));
      });
      // Destination marker.
      if (destinationCoords) {
        markersRef.current.push(new ctors.Marker({
          map, position: { lat: destinationCoords.latitude, lng: destinationCoords.longitude },
          label: { text: 'B', color: 'white', fontWeight: 'bold' },
          title: 'Destination',
        }));
      }

      // Fit the view to the route bounds — use Google's bounds if given
      // (already accounts for polyline curvature), otherwise fold every
      // stop into a fresh LatLngBounds.
      const b = new ctors.LatLngBounds();
      if (bounds) {
        b.extend({ lat: bounds.northeast.latitude, lng: bounds.northeast.longitude });
        b.extend({ lat: bounds.southwest.latitude, lng: bounds.southwest.longitude });
      } else {
        for (const p of path) b.extend(p);
      }
      map.fitBounds(b, 40);
    }).catch((err) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : 'Failed to load map');
    });

    return () => { cancelled = true; };
    // Coord objects change on every render even when values equal, so
    // serialise a stable key for the effect deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    encodedPolyline,
    originCoords?.latitude, originCoords?.longitude,
    destinationCoords?.latitude, destinationCoords?.longitude,
    JSON.stringify(stopCoords ?? []),
    JSON.stringify(bounds ?? null),
  ]);

  return (
    <div className={`relative rounded-xl overflow-hidden border border-white/10 ${className ?? ''}`} style={{ height: heightPx }}>
      <div ref={containerRef} className="absolute inset-0" />
      {!encodedPolyline && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500 bg-slate-800/40">
          Route preview will appear here once origin + destination are set.
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-rose-300 bg-rose-500/10 p-3 text-center">
          {error}
        </div>
      )}
      {/* Recomputing overlay — appears while a new estimate is in flight.
          Non-interactive (`pointer-events-none`) so the operator can still
          scroll/drag the underlying map, but visually dims the tiles + shows
          a spinner so it's clear the map they see is about to update. */}
      {recomputing && encodedPolyline && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-900/40">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-900/90 border border-violet-500/40 px-3 py-1.5 text-xs text-violet-200 shadow-lg">
            <span className="inline-block w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
            Recomputing route…
          </div>
        </div>
      )}
    </div>
  );
}
