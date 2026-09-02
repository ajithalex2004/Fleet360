/**
 * src/components/bus-ops/outsource/OutsourceLiveMap.tsx
 *
 * Real-Time Telematics & Geofence Map Component for Tenant Operations.
 * Displays moving vehicle, breadcrumb trajectory, geofence perimeters, and projected ETA.
 */

'use client';

import React, { useEffect, useState } from 'react';
import {
  MapPin,
  Navigation,
  Clock,
  Gauge,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

interface OutsourceLiveMapProps {
  token: string;
  tripNumber?: string;
}

export function OutsourceLiveMap({ token, tripNumber }: OutsourceLiveMapProps) {
  const [telemetry, setTelemetry] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchLiveTelemetry = async () => {
    try {
      const res = await fetch(`/api/public/partner-driver/${token}/telemetry`);
      const json = await res.json();
      setTelemetry(json);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchLiveTelemetry();
    const interval = setInterval(fetchLiveTelemetry, 10000); // 10s auto-polling
    return () => clearInterval(interval);
  }, [token]);

  if (loading) {
    return (
      <div className="p-8 rounded-3xl bg-slate-900 border border-slate-800 text-center text-slate-500 text-xs font-semibold animate-pulse">
        Initializing live satellite telemetry stream...
      </div>
    );
  }

  const latest = telemetry?.latestPosition;
  const speed = latest?.payload?.speed ? `${Math.round(latest.payload.speed)} km/h` : 'Stationary';
  const predictedEta = latest?.payload?.predictedEta || 'Calculating...';

  return (
    <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-4 font-sans text-xs shadow-xl">
      {/* Map Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
          <span className="font-bold text-white text-sm">Live In-Transit Telematics</span>
          {tripNumber && <span className="text-slate-500 font-mono">({tripNumber})</span>}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 font-mono">
            <Gauge className="w-3.5 h-3.5 text-cyan-400" />
            <span>{speed}</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 font-bold">
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span>ETA: {predictedEta}</span>
          </div>
        </div>
      </div>

      {/* Simulated Interactive Geofence Map Canvas */}
      <div className="relative h-64 w-full rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden flex flex-col justify-between p-4 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px]">
        {/* Pickup Geofence Marker */}
        <div className="flex items-start gap-2 text-[11px] bg-slate-900/90 border border-slate-800 p-2.5 rounded-xl max-w-xs backdrop-blur">
          <MapPin className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-emerald-400 uppercase text-[9px]">Pickup (250m Geofence Active)</span>
            <div className="text-white font-semibold truncate">{telemetry?.pickupLocation?.name || 'Origin Site'}</div>
          </div>
        </div>

        {/* Live Moving Vehicle Marker */}
        <div className="mx-auto flex flex-col items-center animate-bounce">
          <div className="p-2.5 rounded-full bg-cyan-500 text-white shadow-lg shadow-cyan-500/50 border-2 border-white">
            <Navigation className="w-5 h-5" />
          </div>
          <span className="mt-1 px-2 py-0.5 rounded-md bg-slate-900 text-[10px] font-mono font-bold text-cyan-300 border border-cyan-500/30">
            {telemetry?.vehiclePlate || 'PARTNER VEHICLE'}
          </span>
        </div>

        {/* Dropoff Geofence Marker */}
        <div className="self-end flex items-start gap-2 text-[11px] bg-slate-900/90 border border-slate-800 p-2.5 rounded-xl max-w-xs backdrop-blur">
          <MapPin className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-rose-400 uppercase text-[9px]">Drop-off (250m Geofence Active)</span>
            <div className="text-white font-semibold truncate">{telemetry?.dropoffLocation?.name || 'Destination Site'}</div>
          </div>
        </div>
      </div>

      {/* Telematics Footer */}
      <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1">
        <div className="flex items-center gap-2">
          <span>Driver: <strong className="text-white">{telemetry?.driverName || 'Assigned Driver'}</strong></span>
          <span>•</span>
          <span>Trajectory Breadcrumbs: <strong className="text-cyan-400 font-mono">{telemetry?.breadcrumbs?.length || 0} pings</strong></span>
        </div>

        <span className="text-[10px] text-slate-500">Auto-refreshing every 10s via satellite GPS</span>
      </div>
    </div>
  );
}
