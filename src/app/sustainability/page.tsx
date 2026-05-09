'use client';

import { useEffect, useState, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SustainabilityDashboard {
  period: { start: string; end: string; months: number };
  methodology: {
    standard: string;
    iso_reference: string;
    grid_factor: number;
    baseline_factor: number;
    data_source: string;
  };
  overview: {
    co2_avoided_kg: number;
    co2_avoided_tonnes: number;
    co2_actual_kg: number;
    co2_baseline_kg: number;
    fuel_litres: number;
    fuel_saved_litres: number;
    total_km: number;
    ev_km_driven: number;
  };
  fleet: {
    total_vehicles: number;
    ev_vehicles: number;
    ev_pct: number;
    total_capacity: number;
    utilisation_pct: number;
  };
  scope: {
    scope1_kg: number;
    scope2_kg: number;
    scope3_avoided_kg: number;
  };
  modal_shift: {
    trips_consolidated: number;
    car_equiv_removed: number;
    co2_from_modal_shift: number;
  };
  school_bus: {
    occupancy_pct: number;
    total_trips: number;
    total_passengers: number;
    total_capacity: number;
  };
  paperless: {
    digital_docs: number;
    paper_docs: number;
    total_docs: number;
    paperless_pct: number;
  };
  certification: {
    readiness_score: number;
    level: 'BASELINE' | 'BRONZE' | 'SILVER' | 'GOLD';
  };
  trend: {
    month: string;
    km: number;
    co2_actual: number;
    co2_baseline: number;
    co2_avoided: number;
    fuel: number;
    occupancy: number;
  }[];
  module_breakdown: {
    module: string;
    label: string;
    km: number;
    co2_avoided: number;
    fuel_litres: number;
    icon: string;
  }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtNum(n: number, dec = 0) {
  return new Intl.NumberFormat('en-AE', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
}
function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

const CERT_CONFIG = {
  GOLD:     { color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30', icon: '🥇', label: 'Gold Certified' },
  SILVER:   { color: 'text-slate-300',  bg: 'bg-slate-500/10 border-slate-500/30',  icon: '🥈', label: 'Silver Certified' },
  BRONZE:   { color: 'text-amber-500',  bg: 'bg-amber-500/10 border-amber-500/30',  icon: '🥉', label: 'Bronze Certified' },
  BASELINE: { color: 'text-slate-400',  bg: 'bg-slate-800/60 border-white/10',       icon: '📋', label: 'Baseline' },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function KPICard({
  label, value, unit, sub, icon, color = 'emerald', trend,
}: {
  label: string; value: string; unit?: string; sub?: string;
  icon: string; color?: string; trend?: number;
}) {
  const colors: Record<string, string> = {
    emerald: 'from-emerald-600 to-green-700',
    blue:    'from-blue-600 to-blue-700',
    purple:  'from-purple-600 to-violet-700',
    amber:   'from-amber-500 to-orange-600',
    teal:    'from-teal-600 to-cyan-700',
    rose:    'from-rose-600 to-pink-700',
  };
  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 flex flex-col gap-3 hover:border-white/20 transition-colors">
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${colors[color] ?? colors.emerald} flex items-center justify-center text-xl shadow-lg`}>
          {icon}
        </div>
        {trend !== undefined && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            trend > 0 ? 'text-emerald-400 bg-emerald-500/10' : trend < 0 ? 'text-red-400 bg-red-500/10' : 'text-slate-400 bg-slate-800'
          }`}>
            {trend > 0 ? '↑' : trend < 0 ? '↓' : '—'} {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div>
        <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">{label}</p>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold text-white">{value}</span>
          {unit && <span className="text-sm text-slate-400">{unit}</span>}
        </div>
        {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function ProgressBar({ pct, color = 'emerald', label, sublabel }: {
  pct: number; color?: string; label: string; sublabel?: string;
}) {
  const colors: Record<string, string> = {
    emerald: 'bg-gradient-to-r from-emerald-500 to-green-500',
    blue:    'bg-gradient-to-r from-blue-500 to-cyan-500',
    amber:   'bg-gradient-to-r from-amber-500 to-orange-500',
    purple:  'bg-gradient-to-r from-purple-500 to-violet-500',
    teal:    'bg-gradient-to-r from-teal-500 to-cyan-500',
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <div className="flex items-center gap-2">
          {sublabel && <span className="text-xs text-slate-500">{sublabel}</span>}
          <span className="text-white font-semibold">{fmtNum(pct, 1)}%</span>
        </div>
      </div>
      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${colors[color] ?? colors.emerald}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

function TrendChart({ data }: { data: SustainabilityDashboard['trend'] }) {
  if (!data.length) return (
    <div className="h-48 flex items-center justify-center text-slate-500 text-sm">No trend data available</div>
  );
  const maxVal = Math.max(...data.map(d => d.co2_baseline), 1);
  return (
    <div className="flex items-end gap-1.5 h-48 w-full">
      {data.map((d, i) => {
        const baseH = (d.co2_baseline / maxVal) * 100;
        const actH  = (d.co2_actual  / maxVal) * 100;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
            <div className="w-full flex items-end gap-0.5 h-40">
              {/* Baseline bar */}
              <div
                className="flex-1 bg-slate-700/50 rounded-t-sm transition-all"
                style={{ height: `${baseH}%` }}
                title={`Baseline: ${fmtNum(d.co2_baseline)} kg CO₂`}
              />
              {/* Actual bar */}
              <div
                className="flex-1 bg-gradient-to-t from-emerald-600 to-emerald-400 rounded-t-sm transition-all"
                style={{ height: `${actH}%` }}
                title={`Actual: ${fmtNum(d.co2_actual)} kg CO₂`}
              />
            </div>
            {/* Avoided label */}
            {d.co2_avoided > 0 && (
              <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] text-emerald-400 font-medium hidden group-hover:block whitespace-nowrap bg-slate-900 px-1 rounded z-10">
                -{fmtNum(d.co2_avoided)}kg
              </span>
            )}
            <span className="text-[9px] text-slate-600 text-center leading-tight">
              {d.month.slice(5)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SustainabilityPage() {
  const [data, setData]         = useState<SustainabilityDashboard | null>(null);
  const [loading, setLoading]   = useState(true);
  const [months, setMonths]     = useState(12);
  const [activeTab, setActiveTab] = useState<'overview' | 'fleet' | 'modules' | 'scope'>('overview');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sustainability/dashboard?months=${months}`);
      if (res.ok) setData(await res.json());
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [months]);

  useEffect(() => { load(); }, [load]);

  const cert = data ? CERT_CONFIG[data.certification.level] : null;
  const ov   = data?.overview;
  const fl   = data?.fleet;
  const sc   = data?.scope;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-white">Sustainability &amp; ESG Dashboard</h1>
            {cert && (
              <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold ${cert.bg} ${cert.color}`}>
                {cert.icon} {cert.label}
              </span>
            )}
          </div>
          <p className="text-slate-400 text-sm">
            GHG Protocol Project Standard · ISO 14064-1:2018 · UAE Net Zero 2050 Aligned
            {data && <span className="ml-2 text-slate-500">· {fmtDate(data.period.start)} – {fmtDate(data.period.end)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Period selector */}
          <select
            value={months}
            onChange={e => setMonths(parseInt(e.target.value))}
            className="bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none"
          >
            <option value={3}>Last 3 months</option>
            <option value={6}>Last 6 months</option>
            <option value={12}>Last 12 months</option>
            <option value={24}>Last 24 months</option>
          </select>
          <button
            onClick={load}
            className="px-4 py-2 rounded-xl border border-white/10 text-sm text-slate-300 hover:bg-slate-800 transition-colors"
          >
            ↺ Refresh
          </button>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white text-sm font-semibold transition-colors"
          >
            Export Report
          </button>
        </div>
      </div>

      {/* ── UAE compliance banner ── */}
      <div className="bg-gradient-to-r from-emerald-900/30 to-green-900/20 border border-emerald-500/20 rounded-2xl px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <span className="text-2xl">🇦🇪</span>
          <div>
            <p className="text-emerald-300 font-semibold text-sm">UAE Net Zero 2050 Strategic Initiative</p>
            <p className="text-slate-400 text-xs">Transport sector · Mohammed Bin Rashid Al Maktoum Global Initiatives · Dubai Carbon Centre of Excellence</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {['GHG Protocol', 'ISO 14064', 'UAE MOEI 2023', 'IPCC AR6'].map(b => (
            <span key={b} className="px-2 py-1 bg-emerald-900/40 border border-emerald-500/30 rounded-lg text-emerald-400 font-medium">
              ✓ {b}
            </span>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
            <p className="text-slate-400 text-sm">Computing sustainability metrics…</p>
          </div>
        </div>
      )}

      {!loading && data && (
        <>
          {/* ── 6 KPI Cards ── */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <KPICard
              label="CO₂ Avoided"
              value={fmtNum(ov?.co2_avoided_tonnes ?? 0, 2)}
              unit="tonnes"
              sub={`vs ${fmtNum(ov?.co2_baseline_kg ?? 0)} kg baseline`}
              icon="💨"
              color="emerald"
            />
            <KPICard
              label="Fuel Saved"
              value={fmtNum(ov?.fuel_saved_litres ?? 0)}
              unit="L"
              sub={`of ${fmtNum(ov?.fuel_litres ?? 0)} L total`}
              icon="⛽"
              color="blue"
            />
            <KPICard
              label="Green Fleet"
              value={fmtNum(fl?.ev_pct ?? 0, 1)}
              unit="%"
              sub={`${fl?.ev_vehicles ?? 0} EV of ${fl?.total_vehicles ?? 0} vehicles`}
              icon="⚡"
              color="teal"
            />
            <KPICard
              label="Bus Occupancy"
              value={fmtNum(data.school_bus.occupancy_pct, 1)}
              unit="%"
              sub={`${fmtNum(data.school_bus.total_passengers)} passengers`}
              icon="🏫"
              color="purple"
            />
            <KPICard
              label="Cars Removed"
              value={fmtNum(data.modal_shift.car_equiv_removed)}
              sub="private car trips avoided"
              icon="🔄"
              color="amber"
            />
            <KPICard
              label="Paperless Score"
              value={fmtNum(data.paperless.paperless_pct, 1)}
              unit="%"
              sub={`${fmtNum(data.paperless.digital_docs)} digital docs`}
              icon="📄"
              color="rose"
            />
          </div>

          {/* ── Certification Readiness ── */}
          <div className={`rounded-2xl border p-5 ${cert?.bg ?? 'bg-slate-900/60 border-white/10'}`}>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div>
                <p className={`text-lg font-bold ${cert?.color}`}>{cert?.icon} ISO 14064 Certification Readiness</p>
                <p className="text-slate-400 text-xs mt-0.5">Based on data completeness, emission reductions evidenced, EV adoption and paperless operations</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-white">{data.certification.readiness_score}<span className="text-slate-400 text-lg">/100</span></p>
                <p className={`text-sm font-semibold ${cert?.color}`}>{cert?.label}</p>
              </div>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${
                  data.certification.level === 'GOLD'   ? 'bg-gradient-to-r from-yellow-500 to-amber-400' :
                  data.certification.level === 'SILVER' ? 'bg-gradient-to-r from-slate-400 to-slate-300' :
                  data.certification.level === 'BRONZE' ? 'bg-gradient-to-r from-amber-700 to-amber-500' :
                                                          'bg-gradient-to-r from-emerald-700 to-emerald-500'
                }`}
                style={{ width: `${data.certification.readiness_score}%` }}
              />
            </div>
            <div className="flex justify-between mt-2 text-xs text-slate-500">
              <span>0 — Baseline</span><span>40 — Bronze</span><span>60 — Silver</span><span>80 — Gold</span>
            </div>
          </div>

          {/* ── Tab bar ── */}
          <div className="flex gap-1 bg-slate-900/60 border border-white/10 rounded-xl p-1 w-fit">
            {(['overview', 'fleet', 'modules', 'scope'] as const).map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
                  activeTab === t ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                }`}>
                {t === 'overview' ? '📊 Overview' : t === 'fleet' ? '🚗 Fleet' : t === 'modules' ? '🏗️ Modules' : '🔬 GHG Scope'}
              </button>
            ))}
          </div>

          {/* ── Overview Tab ── */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* CO2 Trend Chart */}
              <div className="lg:col-span-2 bg-slate-900/60 border border-white/10 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="text-base font-semibold text-white">CO₂ Reduction Trend</h2>
                    <p className="text-xs text-slate-400 mt-0.5">Baseline vs actual emissions · monthly</p>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-700/80" /> Baseline</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500" /> Actual</span>
                  </div>
                </div>
                <TrendChart data={data.trend} />
              </div>

              {/* Right column: metrics */}
              <div className="space-y-4">
                {/* School bus occupancy */}
                <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
                  <h3 className="text-sm font-semibold text-white mb-4">Key Performance Rates</h3>
                  <div className="space-y-4">
                    <ProgressBar
                      pct={data.school_bus.occupancy_pct}
                      color="emerald"
                      label="School Bus Occupancy"
                      sublabel={`${fmtNum(data.school_bus.total_passengers)} pax`}
                    />
                    <ProgressBar
                      pct={fl?.utilisation_pct ?? 0}
                      color="blue"
                      label="Fleet Utilisation"
                      sublabel={`${fl?.total_vehicles ?? 0} vehicles`}
                    />
                    <ProgressBar
                      pct={fl?.ev_pct ?? 0}
                      color="teal"
                      label="EV Fleet Share"
                      sublabel={`${fl?.ev_vehicles ?? 0} EV`}
                    />
                    <ProgressBar
                      pct={data.paperless.paperless_pct}
                      color="purple"
                      label="Paperless Operations"
                      sublabel={`${fmtNum(data.paperless.digital_docs)} digital`}
                    />
                  </div>
                </div>

                {/* Modal shift */}
                <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
                  <h3 className="text-sm font-semibold text-white mb-3">Modal Shift Impact</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Trips Consolidated</span>
                      <span className="text-white font-semibold">{fmtNum(data.modal_shift.trips_consolidated)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Car Trips Removed</span>
                      <span className="text-emerald-400 font-semibold">{fmtNum(data.modal_shift.car_equiv_removed)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">CO₂ from Modal Shift</span>
                      <span className="text-white font-semibold">{fmtNum(data.modal_shift.co2_from_modal_shift)} kg</span>
                    </div>
                    <div className="pt-2 border-t border-white/5">
                      <p className="text-xs text-slate-500">Scope 3 calculation: UAE avg 18km commute × 0.170 kg CO₂e/km per private car</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Fleet Tab ── */}
          {activeTab === 'fleet' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-6">
                <h2 className="text-base font-semibold text-white mb-5">Fleet Composition & EV Adoption</h2>
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-4 bg-slate-800/60 rounded-xl">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">⚡</span>
                      <div>
                        <p className="text-white font-medium">Electric Vehicles</p>
                        <p className="text-xs text-slate-400">Zero Scope 1 emissions</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-emerald-400">{fl?.ev_vehicles ?? 0}</p>
                      <p className="text-xs text-slate-500">{fmtNum(fl?.ev_pct ?? 0, 1)}% of fleet</p>
                    </div>
                  </div>
                  <div className="flex justify-between items-center p-4 bg-slate-800/60 rounded-xl">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">⛽</span>
                      <div>
                        <p className="text-white font-medium">ICE Vehicles</p>
                        <p className="text-xs text-slate-400">Scope 1 emission source</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-white">{(fl?.total_vehicles ?? 0) - (fl?.ev_vehicles ?? 0)}</p>
                      <p className="text-xs text-slate-500">{fmtNum(100 - (fl?.ev_pct ?? 0), 1)}% of fleet</p>
                    </div>
                  </div>
                  <div className="flex justify-between items-center p-4 bg-slate-800/60 rounded-xl">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">🚌</span>
                      <div>
                        <p className="text-white font-medium">Total Capacity</p>
                        <p className="text-xs text-slate-400">Seats available platform-wide</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-white">{fmtNum(fl?.total_capacity ?? 0)}</p>
                      <p className="text-xs text-slate-500">seats</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-6">
                <h2 className="text-base font-semibold text-white mb-5">Distance & Energy</h2>
                <div className="space-y-4">
                  {[
                    { label: 'Total km Operated', value: fmtNum(ov?.total_km ?? 0), unit: 'km', icon: '🛣️', note: 'All modules combined' },
                    { label: 'EV km Driven', value: fmtNum(ov?.ev_km_driven ?? 0), unit: 'km', icon: '⚡', note: 'Zero Scope 1 emissions' },
                    { label: 'ICE km Driven', value: fmtNum((ov?.total_km ?? 0) - (ov?.ev_km_driven ?? 0)), unit: 'km', icon: '🔥', note: 'Scope 1 source' },
                    { label: 'Fuel Consumed', value: fmtNum(ov?.fuel_litres ?? 0), unit: 'L', icon: '⛽', note: 'Diesel + Petrol + LPG' },
                    { label: 'Fuel Saved (optimisation)', value: fmtNum(ov?.fuel_saved_litres ?? 0), unit: 'L', icon: '💚', note: 'vs unoptimised baseline' },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>{item.icon}</span>
                        <div>
                          <p className="text-slate-300 text-sm">{item.label}</p>
                          <p className="text-xs text-slate-500">{item.note}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-white font-semibold">{item.value}</span>
                        <span className="text-slate-400 text-xs ml-1">{item.unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Modules Tab ── */}
          {activeTab === 'modules' && (
            <div className="space-y-4">
              <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-white/10">
                  <h2 className="text-base font-semibold text-white">CO₂ Reduction by Module</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Platform contribution to UAE transport emission reduction</p>
                </div>
                {(() => {
                  const maxAvoided = Math.max(...data.module_breakdown.map(m => m.co2_avoided), 1);
                  return (
                    <div className="divide-y divide-white/5">
                      {data.module_breakdown.map(mod => (
                        <div key={mod.module} className="px-6 py-4 hover:bg-white/5 transition-colors">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-xl flex-shrink-0">
                              {mod.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-white font-medium text-sm">{mod.label}</p>
                                <div className="flex items-center gap-4 text-sm">
                                  <span className="text-slate-400">{fmtNum(mod.km)} km</span>
                                  <span className="text-slate-400">{fmtNum(mod.fuel_litres)} L</span>
                                  <span className="text-emerald-400 font-semibold">{fmtNum(mod.co2_avoided)} kg avoided</span>
                                </div>
                              </div>
                              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-emerald-500 to-green-400 rounded-full"
                                  style={{ width: `${(mod.co2_avoided / maxAvoided) * 100}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ── GHG Scope Tab ── */}
          {activeTab === 'scope' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Scope breakdown cards */}
              <div className="space-y-4">
                {[
                  {
                    scope: 'Scope 1', color: 'red', icon: '🔥',
                    kg: sc?.scope1_kg ?? 0,
                    desc: 'Direct GHG emissions from owned/controlled vehicles. Fuel combustion from diesel, petrol, LPG vehicles.',
                    source: 'IPCC AR6 × BEIS 2023 Tier 1',
                  },
                  {
                    scope: 'Scope 2', color: 'blue', icon: '⚡',
                    kg: sc?.scope2_kg ?? 0,
                    desc: 'Indirect emissions from purchased electricity. EV charging using UAE national grid (0.457 kg CO₂e/kWh).',
                    source: 'UAE MOEI Grid Factor 2023',
                  },
                  {
                    scope: 'Scope 3 Avoided', color: 'emerald', icon: '✅',
                    kg: sc?.scope3_avoided_kg ?? 0,
                    desc: 'Avoided emissions from private car trips replaced by consolidated fleet transport. Modal shift benefit.',
                    source: 'GHG Protocol Project Standard §5.4',
                  },
                ].map(s => (
                  <div key={s.scope} className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{s.icon}</span>
                        <div>
                          <p className="text-white font-semibold">{s.scope}</p>
                          <p className="text-xs text-slate-500">{s.source}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold text-white">{fmtNum(s.kg, 1)} <span className="text-slate-400 text-sm">kg CO₂e</span></p>
                        <p className="text-xs text-slate-500">{fmtNum(s.kg / 1000, 3)} tonnes</p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">{s.desc}</p>
                  </div>
                ))}
              </div>

              {/* Methodology transparency */}
              <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-6">
                <h3 className="text-base font-semibold text-white mb-4">Methodology Transparency</h3>
                <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                  All emissions are calculated in accordance with the GHG Protocol Project Standard and ISO 14064-1:2018. Emission factors are sourced from IPCC AR6 Working Group III (2022) and the UK BEIS Greenhouse Gas Reporting Conversion Factors 2023. The UAE electricity grid factor is sourced from UAE Ministry of Energy &amp; Infrastructure (2023).
                </p>
                <div className="space-y-3">
                  {[
                    { label: 'Baseline Factor', value: `${((data.methodology.baseline_factor - 1) * 100).toFixed(0)}% reduction vs unoptimised routing` },
                    { label: 'UAE Grid Factor', value: `${data.methodology.grid_factor} kg CO₂e / kWh` },
                    { label: 'Data Quality Tier', value: 'Tier 1 (measured) + Tier 2 (calculated)' },
                    { label: 'Reporting Standard', value: 'GHG Protocol Project Standard' },
                    { label: 'ISO Reference', value: data.methodology.iso_reference.replace(/_/g, ' ') },
                    { label: 'Private Car Baseline', value: 'UAE avg 18km commute · 1.2 occ · 0.170 kg/km' },
                  ].map(item => (
                    <div key={item.label} className="flex flex-col gap-0.5 py-2 border-b border-white/5 last:border-0">
                      <p className="text-xs text-slate-500 uppercase tracking-wide">{item.label}</p>
                      <p className="text-sm text-white">{item.value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 p-3 bg-emerald-900/20 border border-emerald-500/20 rounded-xl">
                  <p className="text-emerald-400 text-xs font-semibold mb-1">Conservative Estimation Principle</p>
                  <p className="text-slate-400 text-xs leading-relaxed">
                    Per ISO 14064-1 §6.3.2: where data uncertainty exists, we apply conservative estimates that may understate the true emission reduction. Verified third-party audit recommended annually.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Bottom summary row ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-5 text-center">
              <p className="text-4xl font-bold text-emerald-400 mb-1">{fmtNum(ov?.co2_avoided_tonnes ?? 0, 2)}</p>
              <p className="text-white font-medium">Tonnes CO₂e Avoided</p>
              <p className="text-xs text-slate-500 mt-1">vs unoptimised baseline · {fmtDate(data.period.start)} – {fmtDate(data.period.end)}</p>
            </div>
            <div className="bg-slate-900/60 border border-blue-500/20 rounded-2xl p-5 text-center">
              <p className="text-4xl font-bold text-blue-400 mb-1">{fmtNum(ov?.fuel_saved_litres ?? 0)}</p>
              <p className="text-white font-medium">Litres of Fuel Saved</p>
              <p className="text-xs text-slate-500 mt-1">Route optimisation benefit · GHG Protocol Project Standard</p>
            </div>
            <div className="bg-slate-900/60 border border-purple-500/20 rounded-2xl p-5 text-center">
              <p className="text-4xl font-bold text-purple-400 mb-1">{fmtNum(data.modal_shift.car_equiv_removed)}</p>
              <p className="text-white font-medium">Private Cars Removed</p>
              <p className="text-xs text-slate-500 mt-1">Modal shift · Scope 3 avoided emissions</p>
            </div>
          </div>

          {/* ── GHG Protocol footer ── */}
          <div className="border-t border-white/5 pt-4 text-center">
            <p className="text-xs text-slate-600">
              Fleet360 Sustainability Report · Calculated per GHG Protocol Project Standard (2005) &amp; ISO 14064-1:2018 ·
              UAE Ministry of Energy &amp; Infrastructure grid factor (2023) · IPCC AR6 WGIII emission factors ·
              This report is prepared for internal management and external disclosure purposes.
              Third-party verification recommended for regulatory submission.
            </p>
          </div>
        </>
      )}

      {!loading && !data && (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <span className="text-4xl">🌱</span>
          <p className="text-white font-medium">No sustainability data available</p>
          <p className="text-slate-400 text-sm">Start logging trips, fuel consumption and vehicle usage to generate your ESG report.</p>
        </div>
      )}
    </div>
  );
}
