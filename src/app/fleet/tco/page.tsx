'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface TcoVehicle {
  vehicleId: string;
  licensePlate: string;
  vehicleName: string;
  fuelCost: number;
  totalLiters: number;
  fuelTransactions: number;
  finesCost: number;
  fineCount: number;
  totalTco: number;
}

interface TcoTotals {
  fuelCost: number;
  finesCost: number;
  totalTco: number;
  fuelTransactions: number;
  fineCount: number;
}

interface TcoData {
  months: number;
  totals: TcoTotals;
  vehicles: TcoVehicle[];
}

const MONTHS_OPTIONS = [
  { label: '3 M', value: 3 },
  { label: '6 M', value: 6 },
  { label: '12 M', value: 12 },
  { label: '24 M', value: 24 },
];

function fmt(n: number) {
  return n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtShort(n: number) {
  if (n >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `AED ${(n / 1_000).toFixed(1)}K`;
  return `AED ${fmt(n)}`;
}

export default function TcoDashboard() {
  const [months, setMonths] = useState(12);
  const [data, setData] = useState<TcoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortField, setSortField] = useState<'totalTco' | 'fuelCost' | 'finesCost'>('totalTco');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`/api/fleet/tco?months=${months}`);
      if (!res.ok) throw new Error('Failed to fetch TCO data');
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load TCO');
    } finally {
      setLoading(false);
    }
  }, [months]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const vehicles = data?.vehicles ?? [];
  const totals = data?.totals;

  const filtered = vehicles
    .filter(v =>
      !search ||
      v.vehicleName.toLowerCase().includes(search.toLowerCase()) ||
      v.licensePlate.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => sortDir === 'desc' ? b[sortField] - a[sortField] : a[sortField] - b[sortField]);

  const maxTco = Math.max(...vehicles.map(v => v.totalTco), 1);
  const fuelPct = totals ? (totals.fuelCost / Math.max(totals.totalTco, 1)) * 100 : 0;
  const finesPct = totals ? (totals.finesCost / Math.max(totals.totalTco, 1)) * 100 : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">TCO Analysis</h1>
          <p className="text-slate-400 mt-1">Total Cost of Ownership — fleet-wide cost intelligence</p>
        </div>
        <div className="flex items-center gap-2">
          {MONTHS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setMonths(opt.value)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                months === opt.value
                  ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-lg shadow-orange-500/20'
                  : 'bg-slate-800/50 border border-white/10 text-slate-400 hover:text-white hover:border-white/20'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <button
            onClick={fetchData}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-slate-800/50 border border-white/10 text-slate-400 hover:text-white transition-all"
          >
            ↻
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 text-red-400 text-sm">{error}</div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Total Fleet TCO',
            value: totals ? fmtShort(totals.totalTco) : '—',
            sub: `${months}-month rolling window`,
            icon: '💹',
            grad: 'from-orange-500/20 to-amber-500/20',
            border: 'border-orange-500/30',
            text: 'text-orange-400',
          },
          {
            label: 'Fuel Expenditure',
            value: totals ? fmtShort(totals.fuelCost) : '—',
            sub: `${fuelPct.toFixed(0)}% of TCO · ${totals?.fuelTransactions ?? 0} fills`,
            icon: '⛽',
            grad: 'from-blue-500/20 to-cyan-500/20',
            border: 'border-blue-500/30',
            text: 'text-blue-400',
          },
          {
            label: 'Traffic Fines',
            value: totals ? fmtShort(totals.finesCost) : '—',
            sub: `${finesPct.toFixed(0)}% of TCO · ${totals?.fineCount ?? 0} incidents`,
            icon: '⚠️',
            grad: 'from-red-500/20 to-rose-500/20',
            border: 'border-red-500/30',
            text: 'text-red-400',
          },
          {
            label: 'Vehicles Tracked',
            value: loading ? '…' : String(vehicles.length),
            sub: 'across fleet',
            icon: '🚗',
            grad: 'from-emerald-500/20 to-green-500/20',
            border: 'border-emerald-500/30',
            text: 'text-emerald-400',
          },
        ].map(kpi => (
          <div key={kpi.label} className={`bg-gradient-to-br ${kpi.grad} border ${kpi.border} rounded-2xl p-5`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">{kpi.label}</span>
              <span className="text-2xl">{kpi.icon}</span>
            </div>
            {loading
              ? <div className="h-8 w-24 bg-slate-700/50 rounded-lg animate-pulse" />
              : <p className={`text-2xl font-bold ${kpi.text}`}>{kpi.value}</p>
            }
            <p className="text-slate-500 text-xs mt-1">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Cost Composition Bar */}
      {totals && totals.totalTco > 0 && (
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
          <h2 className="text-white font-semibold mb-4">Fleet Cost Composition</h2>
          <div className="flex h-8 rounded-xl overflow-hidden gap-px">
            {fuelPct > 0 && (
              <div
                className="bg-gradient-to-r from-blue-500 to-cyan-500 flex items-center justify-center text-xs font-semibold text-white transition-all"
                style={{ width: `${fuelPct}%` }}
              >
                {fuelPct > 12 ? `Fuel ${fuelPct.toFixed(0)}%` : ''}
              </div>
            )}
            {finesPct > 0 && (
              <div
                className="bg-gradient-to-r from-red-500 to-rose-500 flex items-center justify-center text-xs font-semibold text-white transition-all"
                style={{ width: `${finesPct}%` }}
              >
                {finesPct > 8 ? `Fines ${finesPct.toFixed(0)}%` : ''}
              </div>
            )}
            <div className="flex-1 bg-slate-700/30" />
          </div>
          <div className="flex gap-6 mt-3">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />
              <span className="text-slate-400 text-xs">Fuel — AED {fmt(totals.fuelCost)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
              <span className="text-slate-400 text-xs">Fines — AED {fmt(totals.finesCost)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Per-Vehicle Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-white font-semibold text-lg">Per-Vehicle Breakdown</h2>
          <input
            type="text"
            placeholder="Search vehicle…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-slate-900/50 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50 w-52"
          />
        </div>

        {loading ? (
          <div className="p-12 text-center">
            <div className="w-10 h-10 border-4 border-slate-700 border-t-orange-500 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-slate-400 text-sm">Calculating TCO…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-5xl mb-3">💹</div>
            <p className="text-white font-medium mb-1">No cost data yet</p>
            <p className="text-slate-400 text-sm">Add fuel logs or traffic fines to populate TCO analysis.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5 bg-slate-900/30">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Vehicle</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Cost Share</th>
                  <th
                    className="px-6 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-blue-400 transition-colors select-none"
                    onClick={() => handleSort('fuelCost')}
                  >
                    Fuel Cost {sortField === 'fuelCost' ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
                  </th>
                  <th
                    className="px-6 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-red-400 transition-colors select-none"
                    onClick={() => handleSort('finesCost')}
                  >
                    Fines {sortField === 'finesCost' ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
                  </th>
                  <th
                    className="px-6 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-orange-400 transition-colors select-none"
                    onClick={() => handleSort('totalTco')}
                  >
                    Total TCO {sortField === 'totalTco' ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => {
                  const barFuel = (v.fuelCost / maxTco) * 100;
                  const barFines = (v.finesCost / maxTco) * 100;
                  return (
                    <tr key={v.vehicleId} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="px-6 py-4">
                        <p className="text-white font-medium text-sm group-hover:text-orange-300 transition-colors">{v.vehicleName}</p>
                        <p className="text-slate-500 text-xs font-mono">{v.licensePlate}</p>
                      </td>
                      <td className="px-6 py-4 min-w-[180px]">
                        <div className="flex h-3 rounded overflow-hidden gap-px w-40">
                          <div className="bg-blue-500/70" style={{ width: `${barFuel}%` }} title="Fuel" />
                          <div className="bg-red-500/70" style={{ width: `${barFines}%` }} title="Fines" />
                          <div className="flex-1 bg-slate-700/30" />
                        </div>
                        <p className="text-slate-500 text-xs mt-1">{v.fuelTransactions} fills · {v.fineCount} fines</p>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-blue-400 text-sm font-medium">AED {fmt(v.fuelCost)}</span>
                        <p className="text-slate-500 text-xs">{v.totalLiters.toFixed(0)} L</p>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className={`text-sm font-medium ${v.finesCost > 0 ? 'text-red-400' : 'text-slate-500'}`}>
                          {v.finesCost > 0 ? `AED ${fmt(v.finesCost)}` : '—'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-orange-400 text-sm font-bold">AED {fmt(v.totalTco)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/20 bg-slate-900/40">
                  <td className="px-6 py-4 text-sm font-bold text-white" colSpan={2}>
                    Fleet Total ({filtered.length} vehicle{filtered.length !== 1 ? 's' : ''})
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-bold text-blue-400">AED {fmt(totals?.fuelCost ?? 0)}</td>
                  <td className="px-6 py-4 text-right text-sm font-bold text-red-400">AED {fmt(totals?.finesCost ?? 0)}</td>
                  <td className="px-6 py-4 text-right text-sm font-bold text-orange-400">AED {fmt(totals?.totalTco ?? 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Insights panel */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
        <h2 className="text-white font-semibold mb-3">💡 TCO Intelligence</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-slate-400">
          <div className="bg-slate-900/40 rounded-xl p-4">
            <p className="text-blue-400 font-medium mb-2">Fuel Optimisation</p>
            <p>Vehicles with high fuel cost relative to fleet average may need route optimisation, tyre checks, or driving behaviour coaching.</p>
          </div>
          <div className="bg-slate-900/40 rounded-xl p-4">
            <p className="text-red-400 font-medium mb-2">Fine Reduction</p>
            <p>Repeated fine incidents on the same vehicle signal a driver behaviour issue. Use HoS tracking to identify fatigue-related violations.</p>
          </div>
          <div className="bg-slate-900/40 rounded-xl p-4">
            <p className="text-orange-400 font-medium mb-2">Renewal Trigger</p>
            <p>When a vehicle&apos;s rolling TCO exceeds its book value, evaluate replacement vs. continued operation to optimise total lifecycle cost.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
