'use client';
/**
 * FleetOptimizerMap — renders a solved run's per-vehicle routes on a
 * Google Map with a distinct color per vehicle.
 *
 * Each route is drawn as:
 *   • A colored Polyline decoded from the encoded polyline Google returned.
 *   • Small numbered circle markers at each stop.
 * Unassigned shipments (skipped by the solver) are drawn as red X markers
 * so the operator can see the geographic distribution of what didn't fit.
 *
 * Pure presentation. All the domain logic lives in solve-orchestrator.ts
 * and the parent page hands us the ready-made routes[] + unassigned[].
 */

import { useEffect, useRef } from 'react';
import { loadGoogleMaps } from '@/lib/google-maps-loader';
import { decodePolyline } from '@/lib/planning/fleet-routing/polyline';

export interface FleetMapRoute {
  vehicleId: string;
  encodedPolyline: string;
  stops: Array<{
    sequence: number;
    lat: number;
    lng: number;
    label: string;
    passengerCount: number;
  }>;
}

export interface FleetMapUnassigned {
  passengerId: string | null;
  stopLat: number;
  stopLng: number;
  stopLabel: string;
  reason: string;
}

interface Props {
  routes: FleetMapRoute[];
  unassigned: FleetMapUnassigned[];
  className?: string;
}

// Colorblind-friendly palette — cycles for >8 vehicles.
const VEHICLE_COLORS = [
  '#8B5CF6', '#10B981', '#F59E0B', '#EF4444',
  '#3B82F6', '#EC4899', '#14B8A6', '#F97316',
];

export default function FleetOptimizerMap({ routes, unassigned, className = '' }: Props) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<google.maps.MVCObject[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const g = await loadGoogleMaps();
      if (cancelled || !mapDivRef.current) return;
      if (!mapRef.current) {
        mapRef.current = new g.Map(mapDivRef.current, {
          center: { lat: 25.2048, lng: 55.2708 },   // Dubai fallback
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
      }
      renderOverlays(g);
    })();
    return () => { cancelled = true; };
  }, []);

  // Re-render overlays whenever the input data changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!mapRef.current) return;
      const g = await loadGoogleMaps();
      if (cancelled) return;
      renderOverlays(g);
    })();
    return () => { cancelled = true; };
  }, [routes, unassigned]);

  function renderOverlays(g: Awaited<ReturnType<typeof loadGoogleMaps>>) {
    const map = mapRef.current;
    if (!map) return;

    // Clear previous overlays.
    for (const ov of overlaysRef.current) (ov as unknown as { setMap: (m: null) => void }).setMap(null);
    overlaysRef.current = [];

    const bounds = new g.LatLngBounds();

    routes.forEach((route, i) => {
      const color = VEHICLE_COLORS[i % VEHICLE_COLORS.length];
      const path = decodePolyline(route.encodedPolyline);
      if (path.length > 0) {
        const line = new g.Polyline({
          path,
          strokeColor: color,
          strokeOpacity: 0.85,
          strokeWeight: 4,
        }) as unknown as google.maps.MVCObject & { setMap: (m: google.maps.Map) => void };
        line.setMap(map);
        overlaysRef.current.push(line);
        for (const p of path) bounds.extend(new g.LatLng(p.lat, p.lng));
      }

      route.stops.forEach((s) => {
        const marker = new g.Marker({
          position: { lat: s.lat, lng: s.lng },
          map,
          label: { text: String(s.sequence), color: 'white', fontSize: '11px', fontWeight: 'bold' },
          title: `${route.vehicleId} · Stop ${s.sequence}: ${s.label} (${s.passengerCount} pax)`,
          icon: {
            path: g.SymbolPath.CIRCLE,
            scale: 12,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: 'white',
            strokeWeight: 2,
          },
        }) as unknown as google.maps.MVCObject & { setMap: (m: null) => void };
        overlaysRef.current.push(marker);
        bounds.extend(new g.LatLng(s.lat, s.lng));
      });
    });

    unassigned.forEach((u) => {
      const marker = new g.Marker({
        position: { lat: u.stopLat, lng: u.stopLng },
        map,
        title: `Unassigned: ${u.stopLabel} — ${u.reason}`,
        icon: {
          path: 'M -6 -6 L 6 6 M 6 -6 L -6 6',
          scale: 1.5,
          strokeColor: '#DC2626',
          strokeWeight: 3,
        },
      }) as unknown as google.maps.MVCObject & { setMap: (m: null) => void };
      overlaysRef.current.push(marker);
      bounds.extend(new g.LatLng(u.stopLat, u.stopLng));
    });

    if (!bounds.isEmpty()) map.fitBounds(bounds, 80);
  }

  return (
    <div
      ref={mapDivRef}
      className={`w-full h-full min-h-[400px] rounded-2xl border border-white/10 bg-slate-900/40 ${className}`}
    />
  );
}
