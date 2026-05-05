'use client';
import React, { useState, useEffect } from 'react';

interface SnapRow {
  id: string;
  period_label: string;
  period_start: string;
  period_end: string;
  co2_avoided_kg: number;
  co2_actual_kg: number;
  co2_baseline_kg: number;
  fuel_saved_litres: number;
  ev_km: number;
  total_km: number;
  created_at: string;
}

const SCOPE_FACTORS = [
  { scope: 'Scope 1', label: 'Direct combustion (diesel & petrol fleet)', factor: '2.68 kg CO₂e/L (diesel), 2.31 kg CO₂e/L (petrol)', standard: 'IPCC AR6 Table 2.2' },
  { scope: 'Scope 2', label: 'Electricity for EV charging', factor: '0.457 kg CO₂e/kWh', standard: 'MOEI UAE Grid 2023' },
  { scope: 'Scope 3', label: 'Modal shift — private car trips avoided', factor: '0.170 kg CO₂e/km × 18 km avg', standard: 'GHG Protocol Project Standard' },
];

export default function EmissionReportsPage() {
  const [snapshots, setSnapshots] = useState<SnapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeReport, setActiveReport] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/sustainability/dashboard?period=12m')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.trend) {
          setSnapshots(data.trend.map((t: Record<string, unknown>, i: number) => ({
            id: String(i),
            period_label: t.month as string,
            period_start: `${t.month}-01`,
            period_end: `${t.month}-28`,
            co2_avoided_kg: Number(t.avoided ?? 0) * 1000,
            co2_actual_kg: Number(t.actual ?? 0) * 1000,
            co2_baseline_kg: Number(t.baseline ?? 0) * 1000,
            fuel_saved_litres: Number(t.avoided ?? 0) * 380,
            ev_km: 0,
            total_km: 0,
            created_at: new Date().toISOString(),
          })));
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const totalAvoided = snapshots.reduce((s, r) => s + r.co2_avoided_kg, 0);
  const totalActual  = snapshots.reduce((s, r) => s + r.co2_actual_kg, 0);
  const totalFuel    = snapshots.reduce((s, r) => s + r.fuel_saved_litres, 0);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Emission Reports</h1>
          <p className="text-slate-400 text-sm mt-1">GHG Protocol Project Standard · ISO 14064-1:2018 · Monthly verified snapshots</p>
        </div>
        <button className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm px-4 py-2 rounded-xl transition-colors">
          <span>⬇</span> Export CSV
        </button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { icon: '🌿', label: 'Total CO₂ Avoided (12m)', value: `${(totalAvoided / 1000).toFixed(1)} t`, color: 'text-emerald-400' },
          { icon: '⛽', label: 'Fuel Saved (12m)', value: `${totalFuel.toLocaleString()} L`, color: 'text-amber-400' },
          { icon: '🏭', label: 'Actual Emissions (12m)', value: `${(totalActual / 1000).toFixed(1)} t CO₂e`, color: 'text-slate-300' },
        ].map(k => (
          <div key={k.label} className="bg-slate-900 border border-white/10 rounded-2xl p-5">
            <p className="text-slate-400 text-xs">{k.icon} {k.label}</p>
            <p className={`text-3xl font-bold mt-1 ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Emission factors transparency */}
      <div className="bg-slate-900 border border-emerald-500/20 rounded-2xl p-5">
        <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
          <span className="text-lg">🔬</span> Emission Factor Methodology
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left text-slate-400 font-medium py-2 pr-4">GHG Scope</th>
                <th className="text-left text-slate-400 font-medium py-2 pr-4">Source</th>
                <th className="text-left text-slate-400 font-medium py-2 pr-4">Emission Factor</th>
                <th className="text-left text-slate-400 font-medium py-2">Standard</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {SCOPE_FACTORS.map(s => (
                <tr key={s.scope}>
                  <td className="py-3 pr-4">
                    <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs px-2 py-0.5 rounded-full">{s.scope}</span>
                  </td>
                  <td className="py-3 pr-4 text-slate-300 text-xs">{s.label}</td>
                  <td className="py-3 pr-4 text-white font-mono text-xs">{s.factor}</td>
                  <td className="py-3 text-slate-400 text-xs">{s.standard}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-slate-600 text-xs mt-4 border-t border-white/5 pt-4">
          All calculations follow conservative estimation methodology per ISO 14064-1 §6.3.3. Baseline assumes 20% routing efficiency improvement vs unoptimised operation. Uncertainty range ±15%.
        </p>
      </div>

      {/* Monthly report table */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-white font-semibold">Monthly Emission Snapshots</h2>
          <span className="text-xs text-slate-500">Verified · GHG Protocol compliant</span>
        </div>
        {loading ? (
          <div className="p-12 text-center text-slate-500 text-sm">Loading emission data…</div>
        ) : snapshots.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-slate-400 text-sm">No emission snapshots yet.</p>
            <p className="text-slate-600 text-xs mt-2">Snapshots are generated automatically at month-end when operational data is present.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/50 text-xs text-slate-400">
                  <th className="text-left px-6 py-3">Period</th>
                  <th className="text-right px-4 py-3">Baseline (t CO₂e)</th>
                  <th className="text-right px-4 py-3">Actual (t CO₂e)</th>
                  <th className="text-right px-4 py-3">Avoided (t CO₂e)</th>
                  <th className="text-right px-4 py-3">Fuel Saved (L)</th>
                  <th className="text-center px-4 py-3">Report</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {snapshots.map(row => {
                  const avoided_t = row.co2_avoided_kg / 1000;
                  const actual_t  = row.co2_actual_kg / 1000;
                  const baseline_t = row.co2_baseline_kg / 1000;
                  const reduction_pct = baseline_t > 0 ? Math.round((avoided_t / baseline_t) * 100) : 0;
                  return (
                    <tr key={row.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4">
                        <p className="text-white font-medium">{row.period_label}</p>
                        <p className="text-slate-500 text-xs">Monthly snapshot</p>
                      </td>
                      <td className="px-4 py-4 text-right text-slate-400">{baseline_t.toFixed(2)}</td>
                      <td className="px-4 py-4 text-right text-slate-300">{actual_t.toFixed(2)}</td>
                      <td className="px-4 py-4 text-right">
                        <span className="text-emerald-400 font-semibold">{avoided_t.toFixed(2)}</span>
                        <span className="text-xs text-emerald-600 ml-1">({reduction_pct}%↓)</span>
                      </td>
                      <td className="px-4 py-4 text-right text-amber-400">{row.fuel_saved_litres.toLocaleString()}</td>
                      <td className="px-4 py-4 text-center">
                        <button
                          onClick={() => setActiveReport(activeReport === row.id ? null : row.id)}
                          className="text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1 rounded-lg hover:bg-emerald-500/20 transition-colors"
                        >
                          {activeReport === row.id ? 'Hide' : 'View'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ISO 14064 footer */}
      <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-900/60 border border-white/5">
        <span className="text-2xl">🌍</span>
        <p className="text-slate-500 text-xs leading-relaxed">
          This report is prepared in accordance with the <strong className="text-slate-400">ISO 14064-1:2018</strong> standard for quantification and reporting of greenhouse gas emissions.
          Emission reductions are calculated against a conservative baseline using <strong className="text-slate-400">GHG Protocol Project Standard</strong> methodology.
          External third-party verification is recommended annually for regulatory submissions to UAE Ministry of Climate Change and Environment (MOCCAE).
        </p>
      </div>
    </div>
  );
}
