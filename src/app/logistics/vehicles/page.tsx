'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface Vehicle {
  id: string;
  plate_number: string | null;
  registration_no: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  status: string;
  vehicle_usage: string | null;
  color: string | null;
  fuel_type: string | null;
  seating_capacity: number | null;
  current_mileage: number | null;
  registration_expiry: string | null;
  insurance_expiry: string | null;
  // service schedule (joined)
  next_service_date: string | null;
  next_service_mileage: number | null;
  // extra capacity metadata from notes (if present)
  notes: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  AVAILABLE:   'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  RENTED:      'bg-blue-500/20 text-blue-400 border-blue-500/30',
  MAINTENANCE: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  RESERVED:    'bg-purple-500/20 text-purple-400 border-purple-500/30',
  INACTIVE:    'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

function isExpiringSoon(date: string | null) {
  if (!date) return false;
  const diff = (new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return diff <= 30 && diff >= 0;
}

function isExpired(date: string | null) {
  if (!date) return false;
  return new Date(date).getTime() < Date.now();
}

function ExpiryCell({ date }: { date: string | null }) {
  if (!date) return <span className="text-slate-600">—</span>;
  const expired  = isExpired(date);
  const expiring = isExpiringSoon(date);
  return (
    <span className={`text-xs font-medium ${expired ? 'text-red-400' : expiring ? 'text-amber-400' : 'text-slate-400'}`}>
      {expired ? '⚠️ ' : expiring ? '⏰ ' : ''}
      {new Date(date).toLocaleDateString('en-AE')}
    </span>
  );
}

function parseCapacity(notes: string | null): { weightKg?: number; cbm?: number } {
  if (!notes) return {};
  try {
    const n = JSON.parse(notes) as Record<string, unknown>;
    return {
      weightKg: typeof n.weightCapacityKg === 'number' ? n.weightCapacityKg : undefined,
      cbm:      typeof n.cbmCapacity      === 'number' ? n.cbmCapacity      : undefined,
    };
  } catch { return {}; }
}

function fuelIcon(ft: string | null) {
  const map: Record<string, string> = {
    PETROL: '⛽', GASOLINE: '⛽', DIESEL: '🛢️', ELECTRIC: '⚡', HYBRID: '🔋', CNG: '🌿',
  };
  return map[(ft ?? '').toUpperCase()] ?? '⛽';
}

export default function LogisticsVehiclesPage() {
  const [vehicles,     setVehicles]     = useState<Vehicle[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [view,         setView]         = useState<'grid' | 'table'>('table');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Use enriched endpoint that joins service_schedules
      const res = await fetch('/api/vehicles/logistics', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setVehicles(Array.isArray(data) ? data : data.data ?? []);
      } else {
        // Fallback to generic endpoint
        const res2 = await fetch('/api/vehicles?usage=LOGISTICS', { cache: 'no-store' });
        if (res2.ok) {
          const data = await res2.json();
          setVehicles(Array.isArray(data) ? data : data.data ?? []);
        }
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const statuses = ['ALL', 'AVAILABLE', 'RENTED', 'MAINTENANCE', 'RESERVED', 'INACTIVE'];
  const filtered = vehicles.filter(v => {
    const matchStatus = statusFilter === 'ALL' || v.status === statusFilter;
    const matchSearch = !search || [v.plate_number, v.make, v.model, v.registration_no]
      .some(f => f?.toLowerCase().includes(search.toLowerCase()));
    return matchStatus && matchSearch;
  });

  const expiryAlerts = vehicles.filter(v => isExpired(v.insurance_expiry) || isExpired(v.registration_expiry)).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Logistics Fleet</h1>
          <p className="text-slate-400 text-sm mt-0.5">Vehicles assigned to logistics operations</p>
        </div>
        <div className="flex items-center gap-3">
          {expiryAlerts > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-1.5 rounded-full">
              ⚠️ {expiryAlerts} expiry alert{expiryAlerts > 1 ? 's' : ''}
            </div>
          )}
          <div className="flex items-center gap-1 text-xs text-slate-400 bg-slate-800 border border-white/10 px-3 py-1.5 rounded-lg">
            {vehicles.filter(v => v.status === 'AVAILABLE').length} available of {vehicles.length}
          </div>
          {/* View toggle */}
          <div className="flex bg-slate-800 border border-white/10 rounded-lg overflow-hidden">
            {(['table', 'grid'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  view === v ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-white'
                }`}>
                {v === 'table' ? '☰' : '⊞'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {statuses.map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              statusFilter === s
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                : 'text-slate-400 border-white/10 hover:text-white'
            }`}>
            {s} {s !== 'ALL' && (
              <span className="ml-0.5 opacity-60">({vehicles.filter(v => v.status === s).length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by plate, make, model…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40"
      />

      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-slate-800/60 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-16 text-center">
          <div className="text-5xl mb-3">🚛</div>
          <p className="text-slate-400">No logistics vehicles found</p>
          <p className="text-slate-600 text-xs mt-1">Vehicles with vehicle_usage = LOGISTICS appear here</p>
        </div>
      ) : view === 'table' ? (
        /* ── Table View ──────────────────────────────────────────────────── */
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3">Vehicle</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Fuel</th>
                <th className="text-right px-4 py-3">Mileage</th>
                <th className="text-left px-4 py-3">Insurance Exp.</th>
                <th className="text-left px-4 py-3">Reg. Exp.</th>
                <th className="text-left px-4 py-3">Next Service</th>
                <th className="text-left px-4 py-3">Capacity</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(v => {
                const cap = parseCapacity(v.notes);
                return (
                  <tr key={v.id} className="border-b border-white/5 last:border-0 hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-sm">
                          🚛
                        </div>
                        <div>
                          <p className="text-white font-bold text-sm">{v.plate_number ?? v.registration_no ?? 'No Plate'}</p>
                          <p className="text-slate-400 text-xs">{[v.year, v.make, v.model].filter(Boolean).join(' ')}</p>
                          {v.color && <p className="text-slate-600 text-xs">{v.color}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[v.status] ?? STATUS_BADGE.INACTIVE}`}>
                        {v.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {v.fuel_type ? <span>{fuelIcon(v.fuel_type)} {v.fuel_type}</span> : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 text-right font-mono">
                      {v.current_mileage != null ? `${v.current_mileage.toLocaleString()} km` : '—'}
                    </td>
                    <td className="px-4 py-3"><ExpiryCell date={v.insurance_expiry} /></td>
                    <td className="px-4 py-3"><ExpiryCell date={v.registration_expiry} /></td>
                    <td className="px-4 py-3 text-xs">
                      {v.next_service_date ? (
                        <div>
                          <ExpiryCell date={v.next_service_date} />
                          {v.next_service_mileage != null && (
                            <p className="text-slate-600 text-xs mt-0.5">@ {v.next_service_mileage.toLocaleString()} km</p>
                          )}
                        </div>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {cap.weightKg || cap.cbm ? (
                        <div className="space-y-0.5">
                          {cap.weightKg && <p>⚖️ {cap.weightKg.toLocaleString()} kg</p>}
                          {cap.cbm      && <p>📦 {cap.cbm} m³</p>}
                        </div>
                      ) : v.seating_capacity ? (
                        <span className="text-slate-400">💺 {v.seating_capacity} seats</span>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── Grid View ───────────────────────────────────────────────────── */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(v => {
            const cap           = parseCapacity(v.notes);
            const insExpired    = isExpired(v.insurance_expiry);
            const insExpiring   = isExpiringSoon(v.insurance_expiry);
            const regExpired    = isExpired(v.registration_expiry);
            const svcDue        = isExpiringSoon(v.next_service_date) || isExpired(v.next_service_date);
            return (
              <div key={v.id} className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-all space-y-3">
                <div className="flex items-start justify-between">
                  <div className="text-2xl">🚛</div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[v.status] ?? STATUS_BADGE.INACTIVE}`}>
                    {v.status}
                  </span>
                </div>
                <div>
                  <p className="text-white font-bold text-lg">{v.plate_number ?? v.registration_no ?? 'No Plate'}</p>
                  <p className="text-slate-400 text-sm">{[v.year, v.make, v.model].filter(Boolean).join(' ')}</p>
                  {v.color && <p className="text-slate-600 text-xs">{v.color}</p>}
                </div>

                {/* Specs row */}
                <div className="flex flex-wrap gap-2 text-xs">
                  {v.fuel_type && (
                    <span className="bg-slate-800 border border-white/10 rounded-lg px-2 py-1">
                      {fuelIcon(v.fuel_type)} {v.fuel_type}
                    </span>
                  )}
                  {v.current_mileage != null && (
                    <span className="bg-slate-800 border border-white/10 rounded-lg px-2 py-1 font-mono text-slate-400">
                      {v.current_mileage.toLocaleString()} km
                    </span>
                  )}
                  {cap.weightKg && (
                    <span className="bg-slate-800 border border-white/10 rounded-lg px-2 py-1">⚖️ {cap.weightKg.toLocaleString()} kg</span>
                  )}
                  {cap.cbm && (
                    <span className="bg-slate-800 border border-white/10 rounded-lg px-2 py-1">📦 {cap.cbm} m³</span>
                  )}
                </div>

                {/* Compliance */}
                <div className="space-y-1 border-t border-white/5 pt-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Insurance</span>
                    <ExpiryCell date={v.insurance_expiry} />
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Registration</span>
                    <ExpiryCell date={v.registration_expiry} />
                  </div>
                  {v.next_service_date && (
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Next Service</span>
                      <ExpiryCell date={v.next_service_date} />
                    </div>
                  )}
                </div>

                {/* Alert badges */}
                {(insExpired || insExpiring || regExpired || svcDue) && (
                  <div className="flex flex-wrap gap-1">
                    {(insExpired || insExpiring) && (
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${insExpired ? 'text-red-400 bg-red-500/10 border-red-500/20' : 'text-amber-400 bg-amber-500/10 border-amber-500/20'}`}>
                        {insExpired ? '⚠️ Ins. Expired' : '⏰ Ins. Expiring'}
                      </span>
                    )}
                    {regExpired && (
                      <span className="text-xs px-2 py-0.5 rounded-full border text-red-400 bg-red-500/10 border-red-500/20">
                        ⚠️ Reg. Expired
                      </span>
                    )}
                    {svcDue && (
                      <span className="text-xs px-2 py-0.5 rounded-full border text-orange-400 bg-orange-500/10 border-orange-500/20">
                        🔧 Service Due
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
