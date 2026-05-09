'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TripPosition {
  id: string;
  bookingRef: string | null;
  status: string | null;
  requestorName: string | null;
  origin: string | null;
  destination: string | null;
  driverName: string | null;
  vehiclePlate: string | null;
  shipmentType: string | null;
  startDate: string | null;
  endDate: string | null;
  position: {
    lat: number;
    lng: number;
    ts: string;
    source: 'driver_update' | 'epod' | 'estimated';
  };
}

const STATUS_LABEL: Record<string, string> = {
  DISPATCHED: 'Dispatched', ENROUTE_PICKUP: 'En-route Pickup',
  LOADED: 'Loaded', ENROUTE_DELIVERY: 'En-route Delivery',
  ACTIVE: 'En-route', DELIVERED: 'Delivered',
};

const STATUS_COLOR: Record<string, string> = {
  DISPATCHED: '#fb923c', ENROUTE_PICKUP: '#22d3ee', LOADED: '#facc15',
  ENROUTE_DELIVERY: '#4ade80', ACTIVE: '#4ade80', DELIVERED: '#2dd4bf',
};

// ── Map Component (dynamic import of Mapbox) ──────────────────────────────────
// Window.mapboxgl is declared globally in components/route-optimizer/MapView.tsx
// — single source of truth so the two declarations don't conflict.

function LiveTrackingMap({
  trips,
  selected,
  onSelect,
}: {
  trips: TripPosition[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<import('mapbox-gl').Map | null>(null);
  const markersRef   = useRef<Map<string, import('mapbox-gl').Marker>>(new Map());

  // Load Mapbox GL JS
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;

    const loadMapbox = () => {
      if (typeof window.mapboxgl !== 'undefined') init();
      else {
        const script = document.createElement('script');
        script.src = 'https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js';
        script.onload = init;
        document.head.appendChild(script);
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css';
        document.head.appendChild(link);
      }
    };

    const init = () => {
      if (!containerRef.current || mapRef.current) return;
      window.mapboxgl.accessToken = token;
      const map = new window.mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [55.2797, 25.1972], // Dubai
        zoom: 10,
      });
      map.addControl(new window.mapboxgl.NavigationControl(), 'top-right');
      mapRef.current = map;
    };

    loadMapbox();

    return () => {
      markersRef.current.forEach(m => m.remove());
      markersRef.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update markers when trips change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof window.mapboxgl === 'undefined') return;

    const existing = new Set(markersRef.current.keys());

    trips.forEach(trip => {
      const { lat, lng, source } = trip.position;
      const color = STATUS_COLOR[trip.status ?? ''] ?? '#f59e0b';
      const isEstimated = source === 'estimated';

      if (markersRef.current.has(trip.id)) {
        // Update position
        markersRef.current.get(trip.id)!.setLngLat([lng, lat]);
        existing.delete(trip.id);
        return;
      }

      // Create custom marker element
      const el = document.createElement('div');
      el.style.cssText = `
        width: 36px; height: 36px;
        background: ${color}${isEstimated ? '66' : 'cc'};
        border: 2px solid ${color};
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; font-size: 16px;
        box-shadow: 0 0 0 ${isEstimated ? '0' : '4px'} ${color}33;
        transition: transform 0.2s;
      `;
      el.innerHTML = '🚛';
      el.title = trip.bookingRef ?? trip.id;

      const popup = new window.mapboxgl.Popup({ offset: 20, closeButton: true, maxWidth: '240px' })
        .setHTML(`
          <div style="font-family:Arial,sans-serif;font-size:12px;color:#e2e8f0;background:#1e293b;padding:8px 0">
            <p style="font-weight:bold;color:#f8fafc;margin:0 0 4px">${trip.bookingRef ?? trip.id.slice(0, 8)}</p>
            <p style="color:${color};margin:0 0 3px">● ${STATUS_LABEL[trip.status ?? ''] ?? trip.status}</p>
            ${trip.vehiclePlate ? `<p style="margin:0 0 2px">🚛 ${trip.vehiclePlate}</p>` : ''}
            ${trip.driverName   ? `<p style="margin:0 0 2px">👤 ${trip.driverName}</p>` : ''}
            ${trip.origin       ? `<p style="color:#64748b;margin:0 0 2px">↑ ${trip.origin}</p>` : ''}
            ${trip.destination  ? `<p style="color:#64748b;margin:0">↓ ${trip.destination}</p>` : ''}
            ${isEstimated       ? `<p style="color:#f97316;font-size:10px;margin:4px 0 0">⚠️ Estimated position</p>` : ''}
          </div>
        `);

      const marker = new window.mapboxgl.Marker({ element: el })
        .setLngLat([lng, lat])
        .setPopup(popup)
        .addTo(map);

      el.addEventListener('click', () => onSelect(trip.id));
      markersRef.current.set(trip.id, marker);
      existing.delete(trip.id);
    });

    // Remove stale markers
    existing.forEach(id => {
      markersRef.current.get(id)?.remove();
      markersRef.current.delete(id);
    });
  }, [trips, onSelect]);

  // Fly to selected trip
  useEffect(() => {
    if (!selected || !mapRef.current) return;
    const trip = trips.find(t => t.id === selected);
    if (!trip) return;
    mapRef.current.flyTo({
      center: [trip.position.lng, trip.position.lat],
      zoom: 13, duration: 1200,
    });
    markersRef.current.get(selected)?.togglePopup();
  }, [selected, trips]);

  const noToken = !process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  if (noToken) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-900/60 border border-white/10 rounded-2xl">
        <div className="text-center text-slate-500 p-8">
          <div className="text-4xl mb-3">🗺️</div>
          <p className="font-medium text-slate-400">Map requires Mapbox token</p>
          <p className="text-xs mt-2">Add <code className="text-amber-400">NEXT_PUBLIC_MAPBOX_TOKEN</code> to .env.local</p>
          <p className="text-xs mt-1 text-slate-600">Trip list is shown on the right panel</p>
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className="w-full h-full rounded-2xl overflow-hidden" />;
}

// ── Sidebar Trip Panel ────────────────────────────────────────────────────────

function TripPanel({ trip, isSelected, onSelect }: {
  trip: TripPosition;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const color = STATUS_COLOR[trip.status ?? ''] ?? '#f59e0b';
  const label = STATUS_LABEL[trip.status ?? ''] ?? trip.status;

  return (
    <button onClick={onSelect}
      className={`w-full text-left p-3 rounded-xl border transition-all ${
        isSelected
          ? 'border-amber-500/40 bg-amber-500/10'
          : 'border-white/5 bg-slate-900/40 hover:border-white/10 hover:bg-slate-800/40'
      }`}>
      <div className="flex items-start gap-2">
        <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: color }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="font-mono text-xs text-white font-semibold truncate">
              {trip.bookingRef ?? trip.id.slice(0, 8)}
            </span>
            <span className="text-xs flex-shrink-0" style={{ color }}>{label}</span>
          </div>
          {trip.vehiclePlate && <p className="text-xs text-amber-400 mt-0.5">🚛 {trip.vehiclePlate}</p>}
          {trip.driverName   && <p className="text-xs text-blue-400">👤 {trip.driverName}</p>}
          {(trip.origin || trip.destination) && (
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {trip.origin} {trip.origin && trip.destination ? '→' : ''} {trip.destination}
            </p>
          )}
          {trip.position.source === 'estimated' && (
            <p className="text-xs text-orange-400/60 mt-0.5">⚠️ Estimated position</p>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LogisticsTrackingPage() {
  const [trips,       setTrips]       = useState<TripPosition[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [selected,    setSelected]    = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [filter,      setFilter]      = useState('ALL');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/logistics/tracking', { cache: 'no-store' });
      if (res.ok) {
        setTrips(await res.json());
        setLastRefresh(new Date());
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000); // refresh every 15s
    return () => clearInterval(t);
  }, [load]);

  const statuses = ['ALL', 'DISPATCHED', 'ENROUTE_PICKUP', 'LOADED', 'ENROUTE_DELIVERY'];
  const filtered = filter === 'ALL' ? trips : trips.filter(t => t.status === filter);

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Live Fleet Tracking</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {trips.length} active trip{trips.length !== 1 ? 's' : ''} · Auto-refresh every 15s
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {lastRefresh.toLocaleTimeString()}
          </div>
          <button onClick={load}
            className="text-xs text-slate-400 border border-white/10 px-3 py-1.5 rounded-lg hover:border-white/20 hover:text-white transition-colors">
            ↺ Refresh
          </button>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {statuses.map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              filter === s
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                : 'text-slate-400 border-white/10 hover:border-white/20 hover:text-white'
            }`}>
            {s === 'ALL' ? 'All Active' : STATUS_LABEL[s] ?? s}
            <span className="ml-1 opacity-60">
              ({s === 'ALL' ? trips.length : trips.filter(t => t.status === s).length})
            </span>
          </button>
        ))}
      </div>

      {/* Map + panel */}
      <div className="flex gap-4 flex-1 min-h-0" style={{ height: 'calc(100vh - 260px)' }}>
        {/* Map */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="w-full h-full bg-slate-800/60 rounded-2xl animate-pulse flex items-center justify-center text-slate-600">
              Loading map…
            </div>
          ) : (
            <LiveTrackingMap trips={filtered} selected={selected} onSelect={setSelected} />
          )}
        </div>

        {/* Side panel */}
        <div className="w-72 flex-shrink-0 flex flex-col gap-2 overflow-y-auto">
          {loading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-slate-800/60 rounded-xl animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-center text-slate-600 p-6">
              <div>
                <div className="text-4xl mb-3">🚛</div>
                <p className="text-sm">No active trips in transit</p>
              </div>
            </div>
          ) : (
            filtered.map(trip => (
              <TripPanel
                key={trip.id}
                trip={trip}
                isSelected={selected === trip.id}
                onSelect={() => setSelected(trip.id === selected ? null : trip.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-slate-600 border-t border-white/5 pt-3">
        <span className="font-medium text-slate-500">Position sources:</span>
        {[
          { color: '#4ade80', label: 'Driver GPS update' },
          { color: '#22d3ee', label: 'ePOD GPS' },
          { color: '#fb923c', label: 'Estimated (no GPS data)' },
        ].map(l => (
          <span key={l.label} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
