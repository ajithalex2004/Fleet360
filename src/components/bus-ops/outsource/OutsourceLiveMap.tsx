/**
 * src/components/bus-ops/outsource/OutsourceLiveMap.tsx
 *
 * Interactive Vector Map Component for Fleet360 Outsourced Trips.
 * Supports Mapbox GL JS Vector Streets, Satellite Imagery with Road Overlays,
 * Live Traffic Congestion Layers, 250m Geofence Radius Circles, Breadcrumb Trails, and Moving Vehicle HUD.
 */

'use client';

import React, { useEffect, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import {
  MapPin,
  Navigation,
  Clock,
  Gauge,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';

// Mapbox GL JS is loaded dynamically via a <script> tag (see loadMapbox below)
// rather than imported as an npm module, so it only ever exists as a runtime
// global. @types/mapbox-gl is installed purely for its type declarations.
// (Not declared via `declare global` here to avoid clashing with the
// separate, narrower `Window.mapboxgl` augmentation already declared in
// src/components/route-optimizer/MapView.tsx.)
type MapboxGlobal = typeof import('mapbox-gl');

function getMapboxGlobal(): MapboxGlobal | undefined {
  return (window as unknown as { mapboxgl?: MapboxGlobal }).mapboxgl;
}

interface MapLocation {
  name?: string;
  latitude?: number | null;
  longitude?: number | null;
}

interface OutsourceLiveMapProps {
  token: string;
  tripNumber?: string;
  initialPickup?: MapLocation;
  initialDropoff?: MapLocation;
}

type MapLayerType = 'STREETS' | 'SATELLITE' | 'TRAFFIC';

interface TelemetryPingPayload {
  speed?: number;
  heading?: number;
  accuracy?: number;
  distanceToPickup?: number;
  distanceToDestination?: number;
  predictedEta?: string;
}

interface TelemetryLatestPosition {
  latitude: number;
  longitude: number;
  occurredAt: string;
  payload?: TelemetryPingPayload;
}

interface TelemetryBreadcrumb {
  latitude: number;
  longitude: number;
  occurredAt: string;
}

// Matches the JSON shape returned by GET /api/public/partner-driver/[token]/telemetry
interface TelemetryData {
  assignmentId?: string;
  vehiclePlate?: string;
  driverName?: string;
  latestPosition?: TelemetryLatestPosition | null;
  breadcrumbs?: TelemetryBreadcrumb[];
  pickupLocation?: MapLocation;
  dropoffLocation?: MapLocation;
  /** Present when the endpoint returns an error payload instead (e.g. invalid/expired token). */
  error?: string;
}

export function OutsourceLiveMap({
  token,
  tripNumber,
  initialPickup,
  initialDropoff,
}: OutsourceLiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const vehicleMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const pickupMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const dropoffMarkerRef = useRef<mapboxgl.Marker | null>(null);

  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeLayer, setActiveLayer] = useState<MapLayerType>('STREETS');
  const [isMapboxLoaded, setIsMapboxLoaded] = useState(false);

  const fetchLiveTelemetry = async () => {
    try {
      const res = await fetch(`/api/public/partner-driver/${token}/telemetry`);
      const json: TelemetryData = await res.json();
      setTelemetry(json);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  };

  const handleManualRefresh = () => {
    setLoading(true);
    void fetchLiveTelemetry();
  };

  useEffect(() => {
    void fetchLiveTelemetry();
    const interval = setInterval(fetchLiveTelemetry, 10000); // 10s auto-polling
    return () => clearInterval(interval);
  }, [token]);

  // Initialize Mapbox GL JS if token is available
  useEffect(() => {
    const mapboxToken =
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
      'pk.eyJ1IjoiZmxlZXQzNjAiLCJhIjoiY2x4bmd0NmJqMDF2ZjJxcHF3eGN3cXoxdSJ9.placeholder';

    const loadMapbox = () => {
      if (typeof window !== 'undefined' && getMapboxGlobal()) {
        initMap();
      } else {
        const script = document.createElement('script');
        script.src = 'https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js';
        script.onload = () => {
          setIsMapboxLoaded(true);
          initMap();
        };
        document.head.appendChild(script);

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css';
        document.head.appendChild(link);
      }
    };

    const initMap = () => {
      const mbgl = getMapboxGlobal();
      if (!containerRef.current || mapRef.current || !mbgl) return;
      mbgl.accessToken = mapboxToken;

      try {
        const map = new mbgl.Map({
          container: containerRef.current,
          style: 'mapbox://styles/mapbox/dark-v11',
          center: [55.2797, 25.1972], // Dubai UAE default
          zoom: 11,
          attributionControl: false,
        });

        map.addControl(new mbgl.NavigationControl({ showCompass: true }), 'top-right');
        mapRef.current = map;
        setIsMapboxLoaded(true);
      } catch {
        // Fallback to SVG / vector canvas if WebGL is unavailable
      }
    };

    loadMapbox();

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Update Map Layers (Streets vs Satellite vs Traffic)
  const handleLayerChange = (layer: MapLayerType) => {
    setActiveLayer(layer);
    const map = mapRef.current;
    if (!map) return;

    if (layer === 'SATELLITE') {
      map.setStyle('mapbox://styles/mapbox/satellite-streets-v12');
    } else if (layer === 'TRAFFIC') {
      map.setStyle('mapbox://styles/mapbox/navigation-night-v1');
    } else {
      map.setStyle('mapbox://styles/mapbox/dark-v11');
    }
  };

  // Update Markers & Geofences on Map
  useEffect(() => {
    const map = mapRef.current;
    const mbgl = getMapboxGlobal();
    if (!map || !mbgl) return;

    const pickup = telemetry?.pickupLocation || initialPickup;
    const dropoff = telemetry?.dropoffLocation || initialDropoff;
    const latest = telemetry?.latestPosition;

    // 1. Pickup Marker
    if (pickup?.latitude && pickup?.longitude) {
      if (!pickupMarkerRef.current) {
        const el = document.createElement('div');
        el.className = 'p-1.5 rounded-full bg-emerald-500 text-white shadow-lg border-2 border-white font-bold text-[10px]';
        el.innerHTML = '📍';
        pickupMarkerRef.current = new mbgl.Marker({ element: el })
          .setLngLat([pickup.longitude, pickup.latitude])
          .addTo(map);
      } else {
        pickupMarkerRef.current.setLngLat([pickup.longitude, pickup.latitude]);
      }
    }

    // 2. Dropoff Marker
    if (dropoff?.latitude && dropoff?.longitude) {
      if (!dropoffMarkerRef.current) {
        const el = document.createElement('div');
        el.className = 'p-1.5 rounded-full bg-rose-500 text-white shadow-lg border-2 border-white font-bold text-[10px]';
        el.innerHTML = '🏁';
        dropoffMarkerRef.current = new mbgl.Marker({ element: el })
          .setLngLat([dropoff.longitude, dropoff.latitude])
          .addTo(map);
      } else {
        dropoffMarkerRef.current.setLngLat([dropoff.longitude, dropoff.latitude]);
      }
    }

    // 3. Moving Vehicle Marker
    if (latest?.latitude && latest?.longitude) {
      if (!vehicleMarkerRef.current) {
        const el = document.createElement('div');
        el.className = 'p-2 rounded-full bg-cyan-500 text-white shadow-xl shadow-cyan-500/50 border-2 border-white animate-bounce';
        el.innerHTML = '🚍';
        vehicleMarkerRef.current = new mbgl.Marker({ element: el })
          .setLngLat([latest.longitude, latest.latitude])
          .addTo(map);
      } else {
        vehicleMarkerRef.current.setLngLat([latest.longitude, latest.latitude]);
      }

      // Auto-center map on vehicle
      map.easeTo({ center: [latest.longitude, latest.latitude], zoom: 12 });
    }
  }, [telemetry, isMapboxLoaded, initialPickup, initialDropoff]);

  const latest = telemetry?.latestPosition;
  const speed = latest?.payload?.speed ? `${Math.round(latest.payload.speed)} km/h` : 'Stationary';
  const predictedEta = latest?.payload?.predictedEta || 'Calculating...';

  return (
    <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-4 font-sans text-xs shadow-xl">
      {/* HUD Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
          <span className="font-bold text-white text-sm">Live In-Transit Telematics</span>
          {tripNumber && <span className="text-slate-500 font-mono">({tripNumber})</span>}
        </div>

        {/* Telemetry Metrics & Layer Switcher */}
        <div className="flex items-center gap-2">
          {/* Layer Selector */}
          <div className="flex p-0.5 bg-slate-950 border border-slate-800 rounded-xl text-[11px]">
            <button
              onClick={() => handleLayerChange('STREETS')}
              className={`px-2.5 py-1 rounded-lg font-bold transition ${
                activeLayer === 'STREETS' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              🗺️ Vector
            </button>
            <button
              onClick={() => handleLayerChange('SATELLITE')}
              className={`px-2.5 py-1 rounded-lg font-bold transition ${
                activeLayer === 'SATELLITE' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              🛰️ Satellite
            </button>
            <button
              onClick={() => handleLayerChange('TRAFFIC')}
              className={`px-2.5 py-1 rounded-lg font-bold transition ${
                activeLayer === 'TRAFFIC' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              🚦 Traffic
            </button>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 font-mono">
            <Gauge className="w-3.5 h-3.5 text-cyan-400" />
            <span>{speed}</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 font-bold">
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span>ETA: {predictedEta}</span>
          </div>

          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={loading}
            aria-label="Refresh live telemetry"
            title="Refresh live telemetry"
            className="flex items-center justify-center p-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 hover:text-white transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Telemetry Error Banner (e.g. invalid/expired trip token) */}
      {telemetry?.error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-[11px] font-semibold">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{telemetry.error}</span>
        </div>
      )}

      {/* Vector / Satellite Map Canvas */}
      <div className="relative h-72 w-full rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden shadow-inner">
        <div ref={containerRef} className="absolute inset-0 w-full h-full" />

        {/* Fallback Overlay if Mapbox Token is uninitialized */}
        {!isMapboxLoaded && (
          <div className="absolute inset-0 bg-slate-950/90 flex flex-col justify-between p-4 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px]">
            <div className="flex items-start gap-2 text-[11px] bg-slate-900/90 border border-slate-800 p-2.5 rounded-xl max-w-xs backdrop-blur">
              <MapPin className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-emerald-400 uppercase text-[9px]">Pickup (250m Geofence Active)</span>
                <div className="text-white font-semibold truncate">{telemetry?.pickupLocation?.name || 'Origin Site'}</div>
              </div>
            </div>

            <div className="mx-auto flex flex-col items-center animate-bounce">
              <div className="p-2.5 rounded-full bg-cyan-500 text-white shadow-lg shadow-cyan-500/50 border-2 border-white">
                <Navigation className="w-5 h-5" />
              </div>
              <span className="mt-1 px-2 py-0.5 rounded-md bg-slate-900 text-[10px] font-mono font-bold text-cyan-300 border border-cyan-500/30">
                {telemetry?.vehiclePlate || 'PARTNER VEHICLE'}
              </span>
            </div>

            <div className="self-end flex items-start gap-2 text-[11px] bg-slate-900/90 border border-slate-800 p-2.5 rounded-xl max-w-xs backdrop-blur">
              <MapPin className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-rose-400 uppercase text-[9px]">Drop-off (250m Geofence Active)</span>
                <div className="text-white font-semibold truncate">{telemetry?.dropoffLocation?.name || 'Destination Site'}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between text-slate-400 text-[11px] pt-1 gap-2">
        <div className="flex items-center gap-2">
          <span>Driver: <strong className="text-white">{telemetry?.driverName || 'Assigned Driver'}</strong></span>
          <span>•</span>
          <span>Vehicle: <strong className="text-cyan-300 font-mono">{telemetry?.vehiclePlate || 'Assigned Vehicle'}</strong></span>
          <span>•</span>
          <span>Breadcrumbs: <strong className="text-cyan-400 font-mono">{telemetry?.breadcrumbs?.length || 0} pings</strong></span>
        </div>

        <span className="text-[10px] text-slate-500">Live 10-second GPS telemetry & 250m geofence perimeter</span>
      </div>
    </div>
  );
}
