'use client';
import React, { useState, useEffect } from 'react';

interface DashData {
  modal_shift?: {
    trips_provided: number;
    passengers_moved: number;
    avg_occupancy_pct: number;
    cars_removed_equivalent: number;
    co2_avoided_scope3_kg: number;
    bus_trips: number;
    school_trips: number;
    logistics_trips: number;
  };
  school_bus?: {
    trips: number;
    students: number;
    avg_occupancy: number;
    co2_avoided_kg: number;
    cars_removed: number;
  };
}

export default function ModalShiftPage() {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/sustainability/dashboard')
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const ms   = data?.modal_shift;
  const sb   = data?.school_bus;

  const totalCarsRemoved = (ms?.cars_removed_equivalent ?? 0) + (sb?.cars_removed ?? 0);
  const totalCO2Avoided  = (ms?.co2_avoided_scope3_kg ?? 0) + (sb?.co2_avoided_kg ?? 0);
  const totalPassengers  = (ms?.passengers_moved ?? 0) + (sb?.students ?? 0);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-white">Modal Shift Analysis</h1>
        <p className="text-slate-400 text-sm mt-1">Scope 3 avoided emissions · Private car displacement · GHG Protocol Project Standard</p>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-slate-800/60 rounded-2xl" />)}
        </div>
      ) : (
        <>
          {/* Hero stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: '🚗', label: 'Cars Removed from Roads', value: totalCarsRemoved.toLocaleString(), sub: 'private car trips avoided', color: 'text-emerald-400' },
              { icon: '👥', label: 'Passengers Moved', value: totalPassengers.toLocaleString(), sub: 'by fleet transport', color: 'text-blue-400' },
              { icon: '🌿', label: 'CO₂ Avoided (Scope 3)', value: `${(totalCO2Avoided / 1000).toFixed(1)} t`, sub: 'modal shift benefit', color: 'text-emerald-400' },
              { icon: '📊', label: 'Avg Bus Occupancy', value: `${Math.round(ms?.avg_occupancy_pct ?? 0)}%`, sub: 'vehicle fill rate', color: 'text-amber-400' },
            ].map(k => (
              <div key={k.label} className="bg-slate-900 border border-white/10 rounded-2xl p-5">
                <p className="text-slate-400 text-xs">{k.icon} {k.label}</p>
                <p className={`text-3xl font-bold mt-1 ${k.color}`}>{k.value}</p>
                <p className="text-slate-600 text-xs mt-1">{k.sub}</p>
              </div>
            ))}
          </div>

          {/* Methodology explanation */}
          <div className="bg-slate-900 border border-emerald-500/20 rounded-2xl p-6">
            <h2 className="text-white font-semibold mb-4 flex items-center gap-2">🔬 How Modal Shift CO₂ is Calculated</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              {[
                {
                  step: '01',
                  title: 'Count trips provided',
                  desc: 'Total passenger trips across staff transport, school bus, and logistics delivery runs. Each trip = one car journey avoided.',
                  color: 'emerald',
                },
                {
                  step: '02',
                  title: 'Apply distance assumption',
                  desc: 'Average commute/trip distance: 18 km per trip (UAE urban average). Source: RTA Abu Dhabi Mobility Survey 2022.',
                  color: 'blue',
                },
                {
                  step: '03',
                  title: 'Apply emission factor',
                  desc: 'Private car emission factor: 0.170 kg CO₂e/km (IPCC AR6, petrol mid-size sedan). Result: 0.170 × 18 = 3.06 kg CO₂e avoided per trip.',
                  color: 'violet',
                },
              ].map(s => (
                <div key={s.step} className={`bg-slate-800/60 border border-${s.color}-500/20 rounded-xl p-4`}>
                  <div className={`w-8 h-8 rounded-lg bg-${s.color}-500/10 border border-${s.color}-500/20 flex items-center justify-center text-${s.color}-400 font-bold text-xs mb-3`}>
                    {s.step}
                  </div>
                  <p className="text-white font-medium text-sm">{s.title}</p>
                  <p className="text-slate-400 text-xs mt-2 leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* By service breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
              <h2 className="text-white font-semibold mb-4">Modal Shift by Service</h2>
              <div className="space-y-4">
                {[
                  { label: '🚌 Staff Transport', trips: ms?.bus_trips ?? 0, pct: ms?.avg_occupancy_pct ?? 0 },
                  { label: '🏫 School Bus', trips: ms?.school_trips ?? 0, pct: sb?.avg_occupancy ?? 0 },
                  { label: '🚛 Logistics Delivery', trips: ms?.logistics_trips ?? 0, pct: 100 },
                ].map(s => {
                  const total = (ms?.trips_provided ?? 0) + (ms?.school_trips ?? 0);
                  const sharePct = total > 0 ? Math.round((s.trips / total) * 100) : 0;
                  return (
                    <div key={s.label}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-slate-300">{s.label}</span>
                        <span className="text-white font-semibold">{s.trips.toLocaleString()} trips</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${sharePct}%` }} />
                        </div>
                        <span className="text-slate-500 text-xs w-8 text-right">{sharePct}%</span>
                      </div>
                      <p className="text-slate-600 text-xs mt-1">Avg occupancy: {Math.round(s.pct)}%</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
              <h2 className="text-white font-semibold mb-4">School Bus Environmental Impact</h2>
              <div className="space-y-3">
                {[
                  { label: 'Total School Trips', value: (sb?.trips ?? 0).toLocaleString() },
                  { label: 'Students Transported', value: (sb?.students ?? 0).toLocaleString() },
                  { label: 'Average Occupancy', value: `${Math.round(sb?.avg_occupancy ?? 0)}%` },
                  { label: 'CO₂ Avoided', value: `${((sb?.co2_avoided_kg ?? 0) / 1000).toFixed(2)} t CO₂e` },
                  { label: 'Cars Removed Equivalent', value: (sb?.cars_removed ?? 0).toLocaleString() },
                ].map(m => (
                  <div key={m.label} className="flex items-center justify-between py-2 border-b border-white/5">
                    <span className="text-slate-400 text-sm">{m.label}</span>
                    <span className="text-white font-semibold text-sm">{m.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* UAE policy context */}
          <div className="bg-gradient-to-r from-slate-900 to-emerald-950/30 border border-emerald-500/20 rounded-2xl p-5 flex items-start gap-4">
            <span className="text-3xl flex-shrink-0">🇦🇪</span>
            <div>
              <p className="text-emerald-400 font-semibold text-sm">UAE Sustainable Mobility Strategy Alignment</p>
              <p className="text-slate-400 text-xs mt-2 leading-relaxed">
                The UAE National Climate Change Plan 2017-2050 and Dubai Integrated Energy Strategy target a 30% reduction in transport emissions by 2030.
                Every 1,000 shared trips provided by this platform removes approximately <strong className="text-white">3.06 tonnes CO₂e</strong> from the UAE&apos;s transport sector carbon footprint —
                directly contributing to the UAE&apos;s COP28 pledge to reduce GHG emissions by 40% from a business-as-usual baseline by 2030.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
