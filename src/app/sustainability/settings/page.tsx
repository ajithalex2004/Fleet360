'use client';
import React, { useState, useEffect } from 'react';

interface Settings {
  baseline_year: number;
  baseline_routing_improvement: number;
  private_car_km_assumption: number;
  private_car_ef_kg_per_km: number;
  diesel_ef_kg_per_litre: number;
  petrol_ef_kg_per_litre: number;
  uae_grid_ef_kg_per_kwh: number;
  ev_km_per_kwh: number;
  school_bus_avg_occupancy_target: number;
  reporting_currency: string;
  vat_rate: number;
  org_name: string;
  tenant_id: string;
}

const DEFAULT_SETTINGS: Settings = {
  baseline_year: 2023,
  baseline_routing_improvement: 0.20,
  private_car_km_assumption: 18,
  private_car_ef_kg_per_km: 0.170,
  diesel_ef_kg_per_litre: 2.68,
  petrol_ef_kg_per_litre: 2.31,
  uae_grid_ef_kg_per_kwh: 0.457,
  ev_km_per_kwh: 6.5,
  school_bus_avg_occupancy_target: 75,
  reporting_currency: 'AED',
  vat_rate: 0.05,
  org_name: '',
  tenant_id: '',
};

const EF_SOURCES = [
  { factor: 'Diesel emission factor', value: '2.68 kg CO₂e/L', source: 'IPCC AR6 Table 2.2 (2021)', locked: true },
  { factor: 'Petrol emission factor', value: '2.31 kg CO₂e/L', source: 'IPCC AR6 Table 2.2 (2021)', locked: true },
  { factor: 'UAE Grid electricity', value: '0.457 kg CO₂e/kWh', source: 'MOEI UAE Electricity 2023', locked: false },
  { factor: 'Private car (petrol sedan)', value: '0.170 kg CO₂e/km', source: 'IPCC AR6 / RTA Survey 2022', locked: false },
  { factor: 'EV energy efficiency', value: '6.5 km/kWh', source: 'IEA EV Outlook 2023 (MENA avg)', locked: false },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);

  useEffect(() => {
    fetch('/api/sustainability/settings')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setSettings({ ...DEFAULT_SETTINGS, ...d }); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/sustainability/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const Field = ({ label, field, type = 'number', step = '0.001', desc }: {
    label: string; field: keyof Settings; type?: string; step?: string; desc?: string;
  }) => (
    <div className="space-y-1.5">
      <label className="block text-slate-300 text-sm font-medium">{label}</label>
      {desc && <p className="text-slate-500 text-xs">{desc}</p>}
      <input
        type={type}
        step={step}
        value={settings[field] as string | number}
        onChange={e => setSettings(s => ({ ...s, [field]: type === 'number' ? parseFloat(e.target.value) : e.target.value }))}
        className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
      />
    </div>
  );

  if (loading) return (
    <div className="p-6">
      <div className="animate-pulse space-y-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-32 bg-slate-800/60 rounded-2xl" />)}
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Methodology Settings</h1>
          <p className="text-slate-400 text-sm mt-1">Configure emission factors, baseline assumptions and reporting parameters</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
            saved ? 'bg-emerald-700 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'
          } disabled:opacity-60`}
        >
          {saving ? '⏳ Saving…' : saved ? '✅ Saved!' : '💾 Save Settings'}
        </button>
      </div>

      {/* ISO warning */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
        <span className="text-xl flex-shrink-0">⚠️</span>
        <p className="text-amber-300/80 text-xs leading-relaxed">
          Changing emission factors retroactively will recalculate all historical GHG reports. Per <strong>ISO 14064-1 §6.3.3</strong>, any methodology change must be documented and disclosed in the subsequent verification report. Locked factors (marked 🔒) use internationally recognised IPCC AR6 values and should not be changed without auditor approval.
        </p>
      </div>

      {/* Baseline settings */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 space-y-5">
        <h2 className="text-white font-semibold flex items-center gap-2">📐 Baseline Assumptions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field
            label="Baseline Year"
            field="baseline_year"
            step="1"
            desc="Reference year for GHG reduction calculations"
          />
          <Field
            label="Routing Improvement Factor"
            field="baseline_routing_improvement"
            step="0.01"
            desc="Conservative routing efficiency gain vs unoptimised (0.20 = 20%)"
          />
          <Field
            label="Avg Private Car Trip Distance (km)"
            field="private_car_km_assumption"
            step="0.5"
            desc="Assumed km per car trip avoided via modal shift (UAE RTA: 18 km)"
          />
          <Field
            label="School Bus Occupancy Target (%)"
            field="school_bus_avg_occupancy_target"
            step="1"
            desc="Target occupancy rate for school bus efficiency reporting"
          />
        </div>
      </div>

      {/* Emission factors */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 space-y-5">
        <h2 className="text-white font-semibold flex items-center gap-2">🔬 Emission Factors</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field
            label="Diesel EF (kg CO₂e/L)"
            field="diesel_ef_kg_per_litre"
            step="0.01"
            desc="IPCC AR6 Table 2.2 — international standard (2.68)"
          />
          <Field
            label="Petrol EF (kg CO₂e/L)"
            field="petrol_ef_kg_per_litre"
            step="0.01"
            desc="IPCC AR6 Table 2.2 — international standard (2.31)"
          />
          <Field
            label="UAE Grid EF (kg CO₂e/kWh)"
            field="uae_grid_ef_kg_per_kwh"
            step="0.001"
            desc="MOEI UAE Electricity Factor 2023 (0.457)"
          />
          <Field
            label="Private Car EF (kg CO₂e/km)"
            field="private_car_ef_kg_per_km"
            step="0.001"
            desc="IPCC AR6 — petrol mid-size sedan average (0.170)"
          />
          <Field
            label="EV Efficiency (km/kWh)"
            field="ev_km_per_kwh"
            step="0.1"
            desc="IEA EV Outlook MENA average 2023 (6.5)"
          />
        </div>
      </div>

      {/* Reference table */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10">
          <h2 className="text-white font-semibold">Emission Factor Reference Sources</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/50 text-xs text-slate-400">
                <th className="text-left px-6 py-3">Factor</th>
                <th className="text-right px-4 py-3">Value</th>
                <th className="text-left px-4 py-3">Source</th>
                <th className="text-center px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {EF_SOURCES.map(ef => (
                <tr key={ef.factor} className="hover:bg-white/5">
                  <td className="px-6 py-3 text-slate-300">{ef.factor}</td>
                  <td className="px-4 py-3 text-right font-mono text-white text-xs">{ef.value}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{ef.source}</td>
                  <td className="px-4 py-3 text-center">
                    {ef.locked
                      ? <span className="text-xs bg-slate-700/60 text-slate-400 border border-white/10 px-2 py-0.5 rounded-full">🔒 Locked</span>
                      : <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">✏️ Editable</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit trail notice */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-900/60 border border-white/5">
        <span className="text-xl">🗂️</span>
        <p className="text-slate-500 text-xs leading-relaxed">
          All settings changes are logged with timestamp and user ID for ISO 14064 audit trail purposes.
          Changes take effect immediately for new calculations; historical snapshots retain the settings active at time of generation.
          For certification submissions, provide the methodology change log to your third-party verifier.
        </p>
      </div>
    </div>
  );
}
