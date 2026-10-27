'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Navigation,
  Clock,
  Gauge,
  MapPin,
  Calendar,
  RefreshCw,
  Download,
  ExternalLink,
  Smartphone,
  Cpu,
  User,
  Shield,
  Loader2,
} from 'lucide-react';
import { loadGoogleMaps, type GMapsMap, type GMapsMarker, type GMapsPolyline } from '@/lib/google-maps-loader';

interface BreadcrumbPing {
  id: string;
  lat: number;
  lng: number;
  speedKmh: number;
  headingDeg: number;
  accuracyM: number;
  occurredAt: string;
  source: string;
}

interface HistoryData {
  vehicle: {
    id: string;
    vehicleCode: string | null;
    licensePlate: string | null;
    make: string | null;
    model: string | null;
    deviceId: string | null;
    simCardNo: string | null;
    odometerKm: number;
    fuelLevelPercent: number | null;
    assignedDriver: {
      id: string;
      name: string;
      contactNumber: string | null;
    } | null;
  };
  stats: {
    totalPings: number;
    maxSpeedKmh: number;
    avgSpeedKmh: number;
    totalDistanceKm: number;
    firstPingAt: string | null;
    lastPingAt: string | null;
  };
  breadcrumbs: BreadcrumbPing[];
}

interface Props {
  vehicleId: string;
  vehicleCodeOrPlate?: string;
  onClose: () => void;
}

function getHeadingCompass(deg: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(((deg % 360) / 45)) % 8;
  return directions[index];
}

export default function VehicleTrackingHistoryModal({
  vehicleId,
  vehicleCodeOrPlate,
  onClose,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<HistoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<'all' | 'today' | 'yesterday' | '7days'>('all');
  const [activeTab, setActiveTab] = useState<'map' | 'table'>('map');

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GMapsMap | null>(null);
  const polylineRef = useRef<GMapsPolyline | null>(null);
  const markersRef = useRef<GMapsMarker[]>([]);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      let fromDate: string | undefined;
      let toDate: string | undefined;

      if (dateRange === 'today') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        fromDate = start.toISOString();
      } else if (dateRange === 'yesterday') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
        fromDate = start.toISOString();
        toDate = end.toISOString();
      } else if (dateRange === '7days') {
        const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        fromDate = start.toISOString();
      }

      const params = new URLSearchParams({
        ...(vehicleId ? { vehicleId } : {}),
        ...(vehicleCodeOrPlate ? { search: vehicleCodeOrPlate } : {}),
        ...(fromDate ? { from: fromDate } : {}),
        ...(toDate ? { to: toDate } : {}),
        limit: '1000',
      });

      const res = await fetch(`/api/telematics/history?${params.toString()}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const json: HistoryData = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch history');
    } finally {
      setLoading(false);
    }
  }, [vehicleId, vehicleCodeOrPlate, dateRange]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Google Maps route rendering
  useEffect(() => {
    if (activeTab !== 'map' || !data || data.breadcrumbs.length === 0 || !mapContainerRef.current) return;

    let cancelled = false;
    loadGoogleMaps().then((ctors) => {
      if (cancelled || !mapContainerRef.current) return;

      // Clean up previous markers and polylines
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      if (polylineRef.current) {
        polylineRef.current.setMap(null);
        polylineRef.current = null;
      }

      const points = data.breadcrumbs.map((p) => ({ lat: p.lat, lng: p.lng }));
      const bounds = new ctors.LatLngBounds();
      points.forEach((pt) => bounds.extend(pt));

      if (!mapRef.current) {
        mapRef.current = new ctors.Map(mapContainerRef.current, {
          center: points[points.length - 1] || { lat: 25.2048, lng: 55.2708 },
          zoom: 14,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          zoomControl: true,
        });
      }

      const map = mapRef.current;
      map.fitBounds(bounds, 50);

      // Draw polyline connecting points
      const poly = new ctors.Polyline({
        path: points,
        geodesic: true,
        strokeColor: '#06b6d4', // cyan-500
        strokeOpacity: 0.9,
        strokeWeight: 4,
      });
      poly.setMap(map);
      polylineRef.current = poly;

      // Add Start Marker (green)
      if (points.length > 0) {
        const startPt = points[0];
        const startMarker = new ctors.Marker({
          position: startPt,
          map,
          title: `Start: ${new Date(data.breadcrumbs[0].occurredAt).toLocaleTimeString()}`,
          icon: {
            path: ctors.SymbolPath ? ctors.SymbolPath.CIRCLE : undefined,
            scale: 7,
            fillColor: '#10b981', // emerald-500
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
        });
        markersRef.current.push(startMarker);
      }

      // Add Latest / Current Marker (cyan with pulse or red if stopped)
      if (points.length > 1) {
        const endPt = points[points.length - 1];
        const lastPing = data.breadcrumbs[points.length - 1];
        const endMarker = new ctors.Marker({
          position: endPt,
          map,
          title: `Latest: ${new Date(lastPing.occurredAt).toLocaleTimeString()} (${lastPing.speedKmh} km/h)`,
          icon: {
            path: ctors.SymbolPath ? ctors.SymbolPath.CIRCLE : undefined,
            scale: 8,
            fillColor: lastPing.speedKmh > 5 ? '#06b6d4' : '#ef4444',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2.5,
          },
        });
        markersRef.current.push(endMarker);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, data]);

  // Export to CSV
  const handleExportCsv = () => {
    if (!data || data.breadcrumbs.length === 0) return;
    const headers = ['Timestamp_UTC', 'Timestamp_Local_Muscat', 'Speed_Kmh', 'Latitude', 'Longitude', 'Heading_Deg', 'Accuracy_M', 'Source'];
    const rows = data.breadcrumbs.map((p) => {
      const d = new Date(p.occurredAt);
      return [
        d.toISOString(),
        `"${d.toLocaleDateString()} ${d.toLocaleTimeString()}"`,
        p.speedKmh,
        p.lat,
        p.lng,
        p.headingDeg,
        p.accuracyM,
        p.source,
      ].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `history_${data.vehicle.licensePlate || data.vehicle.vehicleCode || 'vehicle'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative flex flex-col w-full max-w-5xl h-[90vh] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <Navigation className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[var(--text-main)] font-mono">
                  {data?.vehicle.licensePlate || vehicleCodeOrPlate || 'Vehicle'} · {data?.vehicle.make} {data?.vehicle.model}
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                  {data?.vehicle.vehicleCode || 'Asset'}
                </span>
                {data?.vehicle.assignedDriver ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <User className="w-3 h-3" /> {data.vehicle.assignedDriver.name}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] text-[var(--text-muted)] bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                    No Driver Assigned
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-0.5 flex items-center gap-2">
                <span>Historical GPS Tracking & Route Breadcrumb Log</span>
                <span>•</span>
                <span className="text-cyan-400 font-medium">🕒 Timestamps in Muscat Local Time (GST, UTC+4)</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCsv}
              disabled={!data || data.breadcrumbs.length === 0}
              className="px-3 py-1.5 rounded-xl bg-[var(--bg-surface-hover)] hover:bg-[var(--border-subtle)] text-xs text-[var(--text-main)] font-semibold border border-[var(--border-subtle)] transition flex items-center gap-1.5 disabled:opacity-40"
              title="Export historical pings to CSV"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Controls & Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 bg-[var(--bg-canvas)]/50 border-b border-[var(--border-subtle)] text-xs">
          {/* Date range filters */}
          <div className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-cyan-400 mr-1" />
            <span className="text-[var(--text-muted)] font-medium mr-1">Timeframe:</span>
            {[
              { id: 'all', label: 'All Recorded' },
              { id: 'today', label: 'Today' },
              { id: 'yesterday', label: 'Yesterday' },
              { id: '7days', label: 'Last 7 Days' },
            ].map((btn) => (
              <button
                key={btn.id}
                onClick={() => setDateRange(btn.id as typeof dateRange)}
                className={`px-3 py-1 rounded-lg font-semibold transition ${
                  dateRange === btn.id
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                    : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)] border border-[var(--border-subtle)]'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          {/* View switcher */}
          <div className="flex items-center gap-2">
            <div className="flex bg-[var(--bg-surface)] p-0.5 rounded-xl border border-[var(--border-subtle)]">
              <button
                onClick={() => setActiveTab('map')}
                className={`px-3 py-1 rounded-lg font-semibold transition ${
                  activeTab === 'map'
                    ? 'bg-cyan-500/20 text-cyan-300 shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                🗺️ Route Map
              </button>
              <button
                onClick={() => setActiveTab('table')}
                className={`px-3 py-1 rounded-lg font-semibold transition ${
                  activeTab === 'table'
                    ? 'bg-cyan-500/20 text-cyan-300 shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                📋 Telemetry Log ({data?.stats.totalPings ?? 0})
              </button>
            </div>
            <button
              onClick={fetchHistory}
              disabled={loading}
              className="p-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Metric Cards Summary */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 px-6 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-mono">
            <div className="p-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
              <div className="text-[10px] text-[var(--text-muted)] font-sans uppercase">Total Distance</div>
              <div className="text-base font-bold text-cyan-400">{data.stats.totalDistanceKm} km</div>
            </div>
            <div className="p-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
              <div className="text-[10px] text-[var(--text-muted)] font-sans uppercase">Max Speed</div>
              <div className="text-base font-bold text-amber-400">{data.stats.maxSpeedKmh} km/h</div>
            </div>
            <div className="p-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
              <div className="text-[10px] text-[var(--text-muted)] font-sans uppercase">Average Speed</div>
              <div className="text-base font-bold text-[var(--text-main)]">{data.stats.avgSpeedKmh} km/h</div>
            </div>
            <div className="p-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
              <div className="text-[10px] text-[var(--text-muted)] font-sans uppercase">Recorded Pings</div>
              <div className="text-base font-bold text-emerald-400">{data.stats.totalPings} points</div>
            </div>
            <div className="col-span-2 md:col-span-1 p-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
              <div className="text-[10px] text-[var(--text-muted)] font-sans uppercase">Last Communication</div>
              <div className="text-xs font-bold text-[var(--text-main)] truncate mt-0.5">
                {data.stats.lastPingAt ? (
                  <>
                    <div>{new Date(data.stats.lastPingAt).toLocaleTimeString()}</div>
                    <div className="text-[10px] font-normal text-[var(--text-muted)]">
                      {new Date(data.stats.lastPingAt).toLocaleDateString()}
                    </div>
                  </>
                ) : (
                  'No pings'
                )}
              </div>
            </div>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 relative overflow-hidden bg-[var(--bg-canvas)]">
          {loading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--text-muted)] gap-2 bg-[var(--bg-canvas)]/80 z-20">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
              <p className="text-xs">Loading GPS tracking breadcrumbs & history…</p>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-rose-400 p-6 text-center">
              <p className="text-sm font-semibold">{error}</p>
              <button
                onClick={fetchHistory}
                className="mt-3 px-4 py-2 rounded-xl bg-cyan-500/20 text-cyan-300 text-xs font-semibold"
              >
                Retry
              </button>
            </div>
          ) : data && data.breadcrumbs.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--text-muted)] p-6 text-center">
              <MapPin className="w-12 h-12 text-[var(--text-faint)] mb-2" />
              <p className="text-sm font-semibold text-[var(--text-main)]">No GPS pings recorded in this timeframe</p>
              <p className="text-xs text-[var(--text-muted)] max-w-md mt-1">
                Try selecting "All Recorded" to view historical trips or ensure the driver mobile app or OBD gateway is actively transmitting.
              </p>
            </div>
          ) : (
            <>
              {/* Route Map View */}
              <div
                className={`w-full h-full ${activeTab === 'map' ? 'block' : 'hidden'}`}
                ref={mapContainerRef}
              />

              {/* Telemetry Log Table View */}
              <div className={`w-full h-full overflow-auto p-4 ${activeTab === 'table' ? 'block' : 'hidden'}`}>
                <table className="w-full text-left text-xs border-collapse font-mono">
                  <thead className="sticky top-0 bg-[var(--bg-surface)] text-[var(--text-muted)] uppercase tracking-wider font-semibold border-b border-[var(--border-subtle)] z-10 shadow-sm">
                    <tr>
                      <th className="py-2.5 px-3">Time (Muscat GST)</th>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Speed</th>
                      <th className="py-2.5 px-3">Heading</th>
                      <th className="py-2.5 px-3">Coordinates (Lat, Lng)</th>
                      <th className="py-2.5 px-3">Source</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
                    {data?.breadcrumbs.slice().reverse().map((p) => {
                      const pingDate = new Date(p.occurredAt);
                      const isMoving = p.speedKmh > 5;
                      const isIdle = p.speedKmh > 0 && p.speedKmh <= 5;
                      return (
                        <tr key={p.id} className="hover:bg-[var(--bg-surface-hover)] transition">
                          <td className="py-2.5 px-3 font-bold text-cyan-400">
                            {pingDate.toLocaleTimeString()}
                          </td>
                          <td className="py-2.5 px-3 text-[var(--text-muted)]">
                            {pingDate.toLocaleDateString()}
                          </td>
                          <td className="py-2.5 px-3">
                            {isMoving ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                Moving
                              </span>
                            ) : isIdle ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                Idle
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                                Stopped
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-semibold">
                            {p.speedKmh.toFixed(1)} km/h
                          </td>
                          <td className="py-2.5 px-3 text-[var(--text-muted)]">
                            {p.headingDeg}° ({getHeadingCompass(p.headingDeg)})
                          </td>
                          <td className="py-2.5 px-3 text-[var(--text-muted)]">
                            {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                          </td>
                          <td className="py-2.5 px-3">
                            {p.source === 'DRIVER_APP' ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                <Smartphone className="w-3 h-3" /> Driver App
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                                <Cpu className="w-3 h-3" /> Hardware GPS
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <a
                              href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 text-[11px] underline"
                            >
                              Pin <ExternalLink className="w-3 h-3" />
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Footer info */}
        <div className="px-6 py-2.5 bg-[var(--bg-canvas)] border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Green Marker = Start point</span>
            <span className="mx-2">•</span>
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <span>Cyan Line = Driven path breadcrumbs</span>
            <span className="mx-2">•</span>
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            <span>Red/Cyan Ring = Latest ping</span>
          </div>
          <div>
            Showing {data?.breadcrumbs.length ?? 0} historical GPS coordinates
          </div>
        </div>

      </div>
    </div>
  );
}
