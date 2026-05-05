'use client';
import React, { useState, useEffect } from 'react';

interface DashData {
  fleet?: {
    total_vehicles: number;
    ev_count: number;
    hybrid_count: number;
    diesel_count: number;
    petrol_count: number;
    ev_percent: number;
    total_km: number;
    ev_km: number;
    diesel_litres: number;
    petrol_litres: number;
    scope1_kg: number;
    scope2_kg: number;
  };
  scope?: {
    scope1: { total_kg: number };
    scope2: { total_kg: number };
    scope3: { total_kg: number };
  };
}

const VEHICLE_COLORS: Record<string, string> = {
  EV:     'from-emerald-500 to-green-600',
  HYBRID: 'from-teal-500 to-cyan-600',
  DIESEL: 'from-amber-500 to-orange-600',
  PETROL: 'from-rose-500 to-red-600',
};

const FUEL_TARGETS = [
  { label: 'EV Fleet Share', target: 30, unit: '%', key: 'ev_percent', color: 'bg-emerald-500' },
  { label: 'Diesel Reduction', target: 20, unit: '% vs 2023 baseline', key: 'diesel_reduction', color: 'bg-amber-500' },
  { label: 'Carbon Intensity', target: 0.18, unit: 'kg CO₂/km', key: 'intensity', color: 'bg-blue-500' },
];

export default function FleetCarbonPage() {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/sustainability/dashboard')
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const fleet = data?.fleet;
  const scope = data?.scope;

  const fuelTypes = fleet ? [
    { type: 'EV',     count: fleet.ev_count,     pct: fleet.total_vehicles > 0 ? Math.round((fleet.ev_count / fleet.total_vehicles) * 100) : 0, co2: 0, color: 'emerald' },
    { type: 'HYBRID', count: fleet.hybrid_count,  pct: fleet.total_vehicles > 0 ? Math.round((fleet.hybrid_count / fleet.total_vehicles) * 100) : 0, co2: 1.2, color: 'teal' },
    { type: 'DIESEL', count: fleet.diesel_count,  pct: fleet.total_vehicles > 0 ? Math.round((fleet.diesel_count / fleet.total_vehicles) * 100) : 0, co2: 2.68, color: 'amber' },
    { type: 'PETROL', count: fleet.petrol_count,  pct: fleet.total_vehicles > 0 ? Math.round((fleet.petrol_count / fleet.total_vehicles) * 100) : 0, co2: 2.31, color: 'rose' },
  ] : [];

  const totalScope12 = (scope?.scope1.total_kg ?? 0) + (scope?.scope2.total_kg ?? 0);
  const carbonIntensity = (fleet?.total_km ?? 0) > 0 ? (totalScope12 / (fleet!.total_km)).toFixed(3) : '—';

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-white">Fleet Carbon Analysis</h1>
        <p className="text-slate-400 text-sm mt-1">Vehicle-level Scope 1 & 2 emissions · Fuel composition · Decarbonisation roadmap</p>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-slate-800/60 rounded-2xl" />)}
        </div>
      ) : (
        <>
          {/* Fleet composition */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {fuelTypes.map(f => (
              <div key={f.type} className={`bg-slate-900 border border-white/10 rounded-2xl p-5`}>
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full bg-${f.color}-500/10 text-${f.color}-400 border border-${f.color}-500/20`}>{f.type}</span>
                  <span className="text-slate-500 text-xs">{f.pct}% fleet</span>
                </div>
                <p className="text-3xl font-bold text-white">{f.count}</p>
                <p className="text-slate-400 text-xs mt-1">vehicles</p>
                {f.co2 > 0 && <p className="text-slate-600 text-xs mt-2">{f.co2} kg CO₂e/L</p>}
                {f.co2 === 0 && <p className="text-emerald-600 text-xs mt-2">Zero direct emissions</p>}
                <div className="mt-3 h-1 bg-slate-800 rounded-full overflow-hidden">
                  <div className={`h-full bg-${f.color}-500 rounded-full transition-all`} style={{ width: `${f.pct}%` }} />
                </div>
              </div>
            ))}
          </div>

          {/* Scope emissions breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
              <h2 className="text-white font-semibold mb-4 flex items-center gap-2">🏭 GHG Emissions by Scope</h2>
              <div className="space-y-4">
                {[
                  { label: 'Scope 1 — Direct (fuel combustion)', kg: scope?.scope1.total_kg ?? 0, color: 'bg-red-500', desc: 'Diesel + petrol burnt in fleet' },
                  { label: 'Scope 2 — Indirect (electricity)', kg: scope?.scope2.total_kg ?? 0, color: 'bg-amber-500', desc: 'EV charging from UAE grid' },
                  { label: 'Scope 3 — Value chain (modal shift)', kg: scope?.scope3.total_kg ?? 0, color: 'bg-blue-500', desc: 'Private car trips avoided' },
                ].map(s => {
                  const t = (scope?.scope1.total_kg ?? 0) + (scope?.scope2.total_kg ?? 0) + (scope?.scope3.total_kg ?? 0);
                  const pct = t > 0 ? Math.round((s.kg / t) * 100) : 0;
                  return (
                    <div key={s.label}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-slate-300">{s.label}</span>
                        <span className="text-white font-semibold">{(s.kg / 1000).toFixed(2)} t CO₂e</span>
                      </div>
                      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full ${s.color} rounded-full`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-slate-600 text-xs mt-1">{s.desc} · {pct}% of total</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
              <h2 className="text-white font-semibold mb-4 flex items-center gap-2">⚡ Operational Metrics</h2>
              <div className="space-y-3">
                {[
                  { label: 'Total Fleet Distance', value: `${((fleet?.total_km ?? 0) / 1000).toFixed(0)}k km`, sub: 'All vehicles combined' },
                  { label: 'EV Distance Share', value: `${fleet?.total_km ? Math.round(((fleet?.ev_km ?? 0) / fleet.total_km) * 100) : 0}%`, sub: `${((fleet?.ev_km ?? 0) / 1000).toFixed(0)}k km electric` },
                  { label: 'Diesel Consumed', value: `${(fleet?.diesel_litres ?? 0).toLocaleString()} L`, sub: `${((fleet?.diesel_litres ?? 0) * 2.68 / 1000).toFixed(2)} t CO₂e` },
                  { label: 'Petrol Consumed', value: `${(fleet?.petrol_litres ?? 0).toLocaleString()} L`, sub: `${((fleet?.petrol_litres ?? 0) * 2.31 / 1000).toFixed(2)} t CO₂e` },
                  { label: 'Carbon Intensity', value: `${carbonIntensity} kg/km`, sub: 'Scope 1+2 per km driven' },
                ].map(m => (
                  <div key={m.label} className="flex items-center justify-between py-2 border-b border-white/5">
                    <div>
                      <p className="text-slate-300 text-sm">{m.label}</p>
                      <p className="text-slate-600 text-xs">{m.sub}</p>
                    </div>
                    <p className="text-white font-semibold text-sm">{m.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* UAE Net Zero roadmap */}
          <div className="bg-gradient-to-br from-emerald-950/60 to-slate-900 border border-emerald-500/20 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-5">
              <span className="text-2xl">🇦🇪</span>
              <div>
                <h2 className="text-white font-bold">UAE Net Zero 2050 Fleet Roadmap</h2>
                <p className="text-emerald-400/70 text-xs">Aligned with UAE Green Agenda 2030 · COP28 commitments</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { year: '2026', target: '15% EV fleet', current: `${fleet?.ev_percent ?? 0}%`, status: (fleet?.ev_percent ?? 0) >= 15 ? '✅ On track' : '⚠️ Behind' },
                { year: '2030', target: '50% EV fleet + hybrid', current: `${fleet?.ev_percent ?? 0}%`, status: 'Roadmap target' },
                { year: '2050', target: 'Net Zero Operations', current: 'Planning phase', status: '🎯 Strategic goal' },
              ].map(r => (
                <div key={r.year} className="bg-slate-900/60 border border-white/10 rounded-xl p-4">
                  <p className="text-emerald-400 text-lg font-bold">{r.year}</p>
                  <p className="text-white text-sm font-medium mt-1">{r.target}</p>
                  <p className="text-slate-400 text-xs mt-1">Current: {r.current}</p>
                  <p className="text-slate-500 text-xs mt-2">{r.status}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
