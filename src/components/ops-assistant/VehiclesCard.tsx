'use client';
import React, { useEffect, useState } from 'react';

interface Vehicle {
  id: string; vehicleCode: string; make: string; model: string;
  yearOfManufacture: number; color: string; plateNumber: string;
  status: string; vehicleUsage: string; category: string;
  lifecycleStage: string; odometerReading: number; fuelLevel: number;
}

interface Props {
  status?: string;
  usage?: string;
  segment?: string;
  title?: string;
}

const statusColor: Record<string, string> = {
  AVAILABLE:   'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  RENTED:      'bg-blue-500/20 text-blue-400 border-blue-500/30',
  MAINTENANCE: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  RESERVED:    'bg-purple-500/20 text-purple-400 border-purple-500/30',
  INACTIVE:    'bg-slate-500/20 text-slate-400 border-slate-500/30',
  SOLD:        'bg-red-500/20 text-red-400 border-red-500/30',
};

const statusIcon: Record<string, string> = {
  AVAILABLE: '✅', RENTED: '🚗', MAINTENANCE: '🔧',
  RESERVED: '🔒', INACTIVE: '⏸️', SOLD: '🏷️',
};

export default function VehiclesCard({ status, usage, segment, title }: Props) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(status ?? '');
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchVehicles = async (s?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '12', page: '1' });
      if (s || status) params.set('status', s ?? status ?? '');
      if (usage) params.set('vehicleUsage', usage);
      if (segment) params.set('category', segment);
      const res = await fetch(`/api/fleet/vehicles?${params}`, { cache: 'no-store' });
      const data = await res.json();
      setVehicles(data.data ?? data.items ?? (Array.isArray(data) ? data : []));
      setTotal(data.total ?? 0);
      setLastUpdated(new Date());
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchVehicles(filter); }, [filter]);

  const displayTitle = title ?? (status ? `${status.charAt(0) + status.slice(1).toLowerCase()} Vehicles` : 'Fleet Vehicles');

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-800/50 backdrop-blur-sm p-5 w-full max-w-2xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🚙</span>
          <h3 className="text-sm font-semibold text-white">{displayTitle}</h3>
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          {total > 0 && <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">{total} total</span>}
        </div>
        <button onClick={() => fetchVehicles(filter)} className="text-xs text-slate-400 hover:text-white bg-slate-700/60 px-2 py-1 rounded-lg">↻</button>
      </div>

      {/* Quick filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {['', 'AVAILABLE', 'RENTED', 'MAINTENANCE', 'RESERVED'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1 text-xs rounded-lg font-medium transition-all border ${filter === s ? 'bg-slate-600 border-white/20 text-white' : 'bg-slate-800/60 border-white/5 text-slate-400 hover:text-slate-200'}`}>
            {s ? `${statusIcon[s]} ${s}` : 'All'}
          </button>
        ))}
      </div>

      {/* Vehicle grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-slate-700/40 rounded-xl animate-pulse" />)}
        </div>
      ) : vehicles.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-sm">No vehicles found</div>
      ) : (
        <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1 custom-scroll">
          {vehicles.map(v => (
            <div key={v.id} className="bg-slate-900/50 border border-white/5 rounded-xl p-3 hover:border-white/15 transition-all">
              <div className="flex items-start justify-between mb-2">
                <span className="font-mono text-xs text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded">{v.vehicleCode || '—'}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded border ${statusColor[v.status] ?? 'bg-slate-700 text-slate-300 border-white/10'}`}>
                  {statusIcon[v.status]} {v.status}
                </span>
              </div>
              <div className="text-sm font-semibold text-white truncate">{v.make} {v.model}</div>
              <div className="text-xs text-slate-400">{v.yearOfManufacture} · {v.color || '—'}</div>
              <div className="text-xs font-mono text-slate-300 mt-1">{v.plateNumber || '—'}</div>
              {/* Fuel bar */}
              <div className="mt-2 flex items-center gap-1.5">
                <span className="text-xs text-slate-500">⛽</span>
                <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${(v.fuelLevel ?? 0) < 25 ? 'bg-red-500' : (v.fuelLevel ?? 0) < 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${v.fuelLevel ?? 0}%` }} />
                </div>
                <span className="text-xs text-slate-400">{v.fuelLevel ?? 0}%</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-slate-600 text-right">Updated {lastUpdated.toLocaleTimeString()}</div>
    </div>
  );
}
