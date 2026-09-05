'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  PieChart,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  Download,
  Search,
  Layers,
  Clock,
  Car,
  ChevronRight,
  X,
  Sparkles,
} from 'lucide-react';

export interface VehicleTcoItem {
  vehicleId: string;
  vehicleCode: string;
  licensePlate: string;
  vehicleName: string;
  vehicleGroup: string;
  vehicleUsage: string;
  acquisitionType: string;
  currentOdometerKm: number;
  distancePeriodKm: number;
  timeWindowMonths: number;

  // 7 Cost Pillars (AED)
  depreciationCost: number;
  fuelCost: number;
  maintenanceCost: number;
  tiresCost: number;
  insuranceCost: number;
  finesCost: number;
  laborCost: number;
  totalTco: number;

  // Efficiency
  costPerKm: number;
  costPerHour: number;
  fuelEfficiencyKmL: number;
  fleetBenchmarkVariancePct: number;

  // Recommendation
  dispositionStatus: 'KEEP_AND_OPERATE' | 'MAINTENANCE_REVIEW' | 'RECOMMEND_REPLACEMENT';
  dispositionReason: string;
}

export interface TcoTotals {
  totalTco: number;
  depreciationCost: number;
  fuelCost: number;
  maintenanceCost: number;
  tiresCost: number;
  insuranceCost: number;
  finesCost: number;
  laborCost: number;
  totalDistanceKm: number;
  totalFuelLiters: number;
  averageCpk: number;
}

export interface TcoData {
  months: number;
  totals: TcoTotals;
  totalVehicles: number;
  costPillarsPct: {
    depreciation: number;
    fuel: number;
    maintenance: number;
    tires: number;
    insurance: number;
    fines: number;
    labor: number;
  };
  replacementRecommendations: VehicleTcoItem[];
  vehicles: VehicleTcoItem[];
}

const MONTHS_OPTIONS = [
  { label: '3 Months', value: 3 },
  { label: '6 Months', value: 6 },
  { label: '12 Months (1 Year)', value: 12 },
  { label: '24 Months (2 Years)', value: 24 },
  { label: '36 Months (3 Years)', value: 36 },
];

function fmt(n: number) {
  return (n || 0).toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtCurrency(n: number) {
  return `AED ${fmt(n)}`;
}

export default function TcoDashboard() {
  const [months, setMonths] = useState(12);
  const [data, setData] = useState<TcoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<keyof VehicleTcoItem>('totalTco');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleTcoItem | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`/api/fleet/tco?months=${months}`);
      if (!res.ok) throw new Error('Failed to fetch TCO intelligence');
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load TCO data');
    } finally {
      setLoading(false);
    }
  }, [months]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSort = (field: keyof VehicleTcoItem) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const vehicles = data?.vehicles ?? [];
  const totals = data?.totals;
  const pillarsPct = data?.costPillarsPct;

  const filteredVehicles = useMemo(() => {
    return vehicles
      .filter((v) => {
        if (groupFilter !== 'ALL' && v.vehicleGroup !== groupFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          return (
            v.vehicleName.toLowerCase().includes(q) ||
            v.licensePlate.toLowerCase().includes(q) ||
            v.vehicleCode.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        const valA = a[sortField] ?? 0;
        const valB = b[sortField] ?? 0;
        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortDir === 'desc' ? valB - valA : valA - valB;
        }
        return sortDir === 'desc'
          ? String(valB).localeCompare(String(valA))
          : String(valA).localeCompare(String(valB));
      });
  }, [vehicles, groupFilter, search, sortField, sortDir]);

  const handleExportCsv = () => {
    if (!vehicles.length) return;
    const headers = [
      'Vehicle Code',
      'License Plate',
      'Make / Model',
      'Group',
      'Total TCO (AED)',
      'Cost Per Km (AED)',
      'Odometer (km)',
      'Period Km',
      'Depreciation (AED)',
      'Fuel (AED)',
      'Maintenance (AED)',
      'Tires (AED)',
      'Insurance (AED)',
      'Fines (AED)',
      'Labor (AED)',
      'Recommendation',
    ];
    const rows = vehicles.map((v) => [
      v.vehicleCode,
      v.licensePlate,
      v.vehicleName,
      v.vehicleGroup,
      v.totalTco,
      v.costPerKm,
      v.currentOdometerKm,
      v.distancePeriodKm,
      v.depreciationCost,
      v.fuelCost,
      v.maintenanceCost,
      v.tiresCost,
      v.insuranceCost,
      v.finesCost,
      v.laborCost,
      v.dispositionStatus,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.map((val) => `"${val}"`).join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `fleet_tco_report_${months}M.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[var(--text-main)] flex items-center gap-2">
              <PieChart className="w-6 h-6 text-cyan-400" />
              Fleet Total Cost of Ownership (TCO) Engine
            </h1>
            <span className="px-2 py-0.5 text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-full">
              7-Pillar Analytics
            </span>
          </div>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Holistic lifecycle cost intelligence, Cost Per Kilometer (CPK) benchmarks, and vehicle replacement advisory.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-1">
            {MONTHS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setMonths(opt.value)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${
                  months === opt.value
                    ? 'bg-cyan-500 text-white font-bold shadow'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-main)] text-xs font-semibold border border-[var(--border-subtle)] transition shadow"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-16 text-center text-[var(--text-faint)] text-sm">
          Crunching 7-pillar lifecycle TCO and CPK telemetry...
        </div>
      ) : error ? (
        <div className="p-6 rounded-2xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-sm">
          {error}
        </div>
      ) : (
        <>
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] space-y-1">
              <p className="text-xs text-[var(--text-muted)] font-medium">Fleet Total TCO ({months}M)</p>
              <p className="text-2xl font-bold text-[var(--text-main)]">{fmtCurrency(totals?.totalTco || 0)}</p>
              <p className="text-[11px] text-[var(--text-faint)]">Across {data?.totalVehicles || 0} active assets</p>
            </div>

            <div className="p-4 rounded-2xl bg-[var(--bg-surface)]/60 border border-cyan-500/30 space-y-1">
              <p className="text-xs text-cyan-400 font-medium">Fleet Average CPK</p>
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-bold text-cyan-300">{(totals?.averageCpk || 0).toFixed(2)}</p>
                <span className="text-xs text-[var(--text-muted)]">AED / km</span>
              </div>
              <p className="text-[11px] text-[var(--text-faint)]">
                {fmt(totals?.totalDistanceKm || 0)} km traveled in period
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-[var(--bg-surface)]/60 border border-amber-500/20 space-y-1">
              <p className="text-xs text-amber-400 font-medium">Fuel & Energy Spend</p>
              <p className="text-2xl font-bold text-amber-300">{fmtCurrency(totals?.fuelCost || 0)}</p>
              <p className="text-[11px] text-amber-500/80">
                {fmt(totals?.totalFuelLiters || 0)} Liters consumed ({pillarsPct?.fuel || 0}% of TCO)
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-[var(--bg-surface)]/60 border border-rose-500/20 space-y-1">
              <p className="text-xs text-rose-400 font-medium">Maintenance & Repairs</p>
              <p className="text-2xl font-bold text-rose-300">
                {fmtCurrency(totals?.maintenanceCost || 0)}
              </p>
              <p className="text-[11px] text-rose-500/80">
                PM & corrective orders ({pillarsPct?.maintenance || 0}% of TCO)
              </p>
            </div>
          </div>

          {/* 7-Pillar Cost Distribution Visualizer */}
          <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                7-Pillar Lifecycle Cost Distribution
              </h3>
              <span className="text-xs text-[var(--text-muted)]">
                Fleet Total: <strong className="text-[var(--text-main)]">{fmtCurrency(totals?.totalTco || 0)}</strong>
              </span>
            </div>

            {/* Stacked Multi-Color Progress Bar */}
            <div className="w-full h-4 rounded-full overflow-hidden flex bg-[var(--bg-surface)]">
              <div
                style={{ width: `${pillarsPct?.depreciation || 0}%` }}
                className="bg-indigo-500 h-full"
                title={`Depreciation: ${pillarsPct?.depreciation}%`}
              />
              <div
                style={{ width: `${pillarsPct?.fuel || 0}%` }}
                className="bg-amber-500 h-full"
                title={`Fuel: ${pillarsPct?.fuel}%`}
              />
              <div
                style={{ width: `${pillarsPct?.maintenance || 0}%` }}
                className="bg-rose-500 h-full"
                title={`Maintenance: ${pillarsPct?.maintenance}%`}
              />
              <div
                style={{ width: `${pillarsPct?.tires || 0}%` }}
                className="bg-orange-500 h-full"
                title={`Tires: ${pillarsPct?.tires}%`}
              />
              <div
                style={{ width: `${pillarsPct?.insurance || 0}%` }}
                className="bg-emerald-500 h-full"
                title={`Insurance: ${pillarsPct?.insurance}%`}
              />
              <div
                style={{ width: `${pillarsPct?.labor || 0}%` }}
                className="bg-violet-500 h-full"
                title={`Labor: ${pillarsPct?.labor}%`}
              />
              <div
                style={{ width: `${pillarsPct?.fines || 0}%` }}
                className="bg-pink-500 h-full"
                title={`Fines: ${pillarsPct?.fines}%`}
              />
            </div>

            {/* Legend */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 pt-2 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 shrink-0" />
                <span className="text-[var(--text-muted)]">
                  Deprec ({pillarsPct?.depreciation || 0}%)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                <span className="text-[var(--text-muted)]">Fuel ({pillarsPct?.fuel || 0}%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
                <span className="text-[var(--text-muted)]">Maint ({pillarsPct?.maintenance || 0}%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-orange-500 shrink-0" />
                <span className="text-[var(--text-muted)]">Tires ({pillarsPct?.tires || 0}%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-[var(--text-muted)]">Insur ({pillarsPct?.insurance || 0}%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-violet-500 shrink-0" />
                <span className="text-[var(--text-muted)]">Labor ({pillarsPct?.labor || 0}%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-pink-500 shrink-0" />
                <span className="text-[var(--text-muted)]">Fines ({pillarsPct?.fines || 0}%)</span>
              </div>
            </div>
          </div>

          {/* Outlier & Replacement Advisory Banner */}
          {data?.replacementRecommendations && data.replacementRecommendations.length > 0 && (
            <div className="p-4 rounded-2xl bg-rose-950/30 border border-rose-500/40 space-y-2">
              <div className="flex items-center gap-2 text-rose-300 font-bold text-sm">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                Replacement & High-Cost Outliers Advisory ({data.replacementRecommendations.length} vehicles)
              </div>
              <p className="text-xs text-rose-200/80">
                The following vehicles have cumulative maintenance costs and CPK exceeding acceptable economic thresholds. Disposal or replacement is recommended to prevent ongoing negative cash flow.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {data.replacementRecommendations.map((v) => (
                  <button
                    key={v.vehicleId}
                    onClick={() => setSelectedVehicle(v)}
                    className="flex items-center gap-2 px-3 py-1 rounded-xl bg-rose-900/60 border border-rose-500/50 text-rose-100 text-xs font-semibold hover:bg-rose-900 transition"
                  >
                    <span>{v.vehicleCode || v.licensePlate}</span>
                    <span className="font-mono text-rose-300 font-bold">{v.costPerKm} AED/km</span>
                    <ChevronRight className="w-3 h-3 text-rose-400" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Filters & Search */}
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
              {(['ALL', 'BUS', 'VAN', 'SEDAN', 'SUV', 'PICKUP', 'TRUCK'] as const).map((grp) => (
                <button
                  key={grp}
                  onClick={() => setGroupFilter(grp)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    groupFilter === grp
                      ? 'bg-[var(--bg-surface-hover)] text-[var(--text-main)] border border-slate-500'
                      : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)] border border-transparent'
                  }`}
                >
                  {grp}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder="Search vehicle, plate, code..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Vehicle TCO Intelligence Grid */}
          <div className="rounded-2xl border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-surface)]/60 shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-[var(--text-muted)]">
                <thead className="bg-[var(--bg-canvas)]/80 text-[var(--text-muted)] uppercase tracking-wider font-semibold border-b border-[var(--border-subtle)]">
                  <tr>
                    <th className="p-3.5 cursor-pointer" onClick={() => handleSort('vehicleCode')}>
                      Vehicle
                    </th>
                    <th className="p-3.5 cursor-pointer" onClick={() => handleSort('totalTco')}>
                      Total TCO
                    </th>
                    <th className="p-3.5 cursor-pointer" onClick={() => handleSort('costPerKm')}>
                      Cost Per Km (CPK)
                    </th>
                    <th className="p-3.5 cursor-pointer" onClick={() => handleSort('fuelCost')}>
                      Fuel (AED)
                    </th>
                    <th className="p-3.5 cursor-pointer" onClick={() => handleSort('maintenanceCost')}>
                      Maint (AED)
                    </th>
                    <th className="p-3.5 cursor-pointer" onClick={() => handleSort('depreciationCost')}>
                      Deprec (AED)
                    </th>
                    <th className="p-3.5">Lifecycle Recommendation</th>
                    <th className="p-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {!filteredVehicles.length ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-[var(--text-faint)]">
                        No vehicle TCO records found for the selected criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredVehicles.map((v) => {
                      const isOver = v.fleetBenchmarkVariancePct > 15;
                      const isUnder = v.fleetBenchmarkVariancePct < -10;

                      return (
                        <tr key={v.vehicleId} className="hover:bg-[var(--bg-surface-hover)] transition">
                          <td className="p-3.5">
                            <div className="font-bold text-[var(--text-main)]">{v.vehicleCode}</div>
                            <div className="text-[11px] text-[var(--text-muted)]">{v.vehicleName}</div>
                            <div className="text-[10px] text-[var(--text-faint)] font-mono">{v.licensePlate}</div>
                          </td>

                          <td className="p-3.5 font-mono font-bold text-[var(--text-main)]">
                            {fmtCurrency(v.totalTco)}
                          </td>

                          <td className="p-3.5 font-mono">
                            <div className="font-bold text-cyan-300 text-sm">{v.costPerKm} AED/km</div>
                            <span
                              className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${
                                isOver ? 'text-rose-400' : isUnder ? 'text-emerald-400' : 'text-[var(--text-muted)]'
                              }`}
                            >
                              {isOver ? <TrendingUp className="w-3 h-3" /> : isUnder ? <TrendingDown className="w-3 h-3" /> : null}
                              {v.fleetBenchmarkVariancePct > 0 ? `+${v.fleetBenchmarkVariancePct}%` : `${v.fleetBenchmarkVariancePct}%`} vs fleet
                            </span>
                          </td>

                          <td className="p-3.5 font-mono">
                            <div className="text-amber-300">{fmtCurrency(v.fuelCost)}</div>
                            <div className="text-[10px] text-[var(--text-faint)]">{v.fuelEfficiencyKmL} km/L</div>
                          </td>

                          <td className="p-3.5 font-mono">
                            <div className="text-rose-300">{fmtCurrency(v.maintenanceCost)}</div>
                            <div className="text-[10px] text-[var(--text-faint)]">
                              {((v.maintenanceCost / Math.max(1, v.totalTco)) * 100).toFixed(0)}% of TCO
                            </div>
                          </td>

                          <td className="p-3.5 font-mono text-indigo-300">
                            {fmtCurrency(v.depreciationCost)}
                          </td>

                          <td className="p-3.5">
                            {v.dispositionStatus === 'RECOMMEND_REPLACEMENT' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                <AlertTriangle className="w-3 h-3" />
                                RECOMMEND REPLACEMENT
                              </span>
                            )}
                            {v.dispositionStatus === 'MAINTENANCE_REVIEW' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                <Clock className="w-3 h-3" />
                                MAINTENANCE REVIEW
                              </span>
                            )}
                            {v.dispositionStatus === 'KEEP_AND_OPERATE' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                <Sparkles className="w-3 h-3" />
                                KEEP & OPERATE
                              </span>
                            )}
                          </td>

                          <td className="p-3.5 text-right">
                            <button
                              onClick={() => setSelectedVehicle(v)}
                              className="px-2.5 py-1 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-main)] text-xs font-semibold border border-[var(--border-subtle)] transition"
                            >
                              Deep Dive
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Vehicle Deep-Dive Modal */}
      {selectedVehicle && (
        <div className="fixed inset-0 z-50 bg-[var(--bg-canvas)]/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl max-w-2xl w-full p-6 space-y-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-4">
              <div>
                <h3 className="text-lg font-bold text-[var(--text-main)] flex items-center gap-2">
                  <Car className="w-5 h-5 text-cyan-400" />
                  {selectedVehicle.vehicleCode} · {selectedVehicle.vehicleName}
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Plate: <span className="font-mono text-[var(--text-main)]">{selectedVehicle.licensePlate}</span> · Group: {selectedVehicle.vehicleGroup}
                </p>
              </div>
              <button
                onClick={() => setSelectedVehicle(null)}
                className="p-1 rounded-lg hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Total TCO & CPK Badge */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="p-3.5 rounded-xl bg-[var(--bg-canvas)]/60 border border-[var(--border-subtle)] space-y-0.5">
                <p className="text-[11px] text-[var(--text-muted)] font-medium">Total TCO ({months}M)</p>
                <p className="text-xl font-bold text-cyan-400">{fmtCurrency(selectedVehicle.totalTco)}</p>
              </div>

              <div className="p-3.5 rounded-xl bg-[var(--bg-canvas)]/60 border border-[var(--border-subtle)] space-y-0.5">
                <p className="text-[11px] text-[var(--text-muted)] font-medium">Cost Per Km</p>
                <p className="text-xl font-bold text-emerald-400">{selectedVehicle.costPerKm} AED/km</p>
              </div>

              <div className="p-3.5 rounded-xl bg-[var(--bg-canvas)]/60 border border-[var(--border-subtle)] space-y-0.5 col-span-2 sm:col-span-1">
                <p className="text-[11px] text-[var(--text-muted)] font-medium">Distance in Period</p>
                <p className="text-xl font-bold text-[var(--text-main)]">
                  {fmt(selectedVehicle.distancePeriodKm)} km
                </p>
              </div>
            </div>

            {/* 7-Pillar Breakdown List */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">
                7-Pillar Itemized Breakdown
              </h4>
              <div className="divide-y divide-white/5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/40 p-2 text-xs">
                <div className="flex justify-between py-2 px-2">
                  <span className="text-[var(--text-muted)]">1. Capital Depreciation / Lease Amortization</span>
                  <span className="font-mono font-bold text-indigo-300">
                    {fmtCurrency(selectedVehicle.depreciationCost)}
                  </span>
                </div>
                <div className="flex justify-between py-2 px-2">
                  <span className="text-[var(--text-muted)]">2. Fuel & Energy Spend</span>
                  <span className="font-mono font-bold text-amber-300">
                    {fmtCurrency(selectedVehicle.fuelCost)}
                  </span>
                </div>
                <div className="flex justify-between py-2 px-2">
                  <span className="text-[var(--text-muted)]">3. Maintenance & Workshop Repairs</span>
                  <span className="font-mono font-bold text-rose-300">
                    {fmtCurrency(selectedVehicle.maintenanceCost)}
                  </span>
                </div>
                <div className="flex justify-between py-2 px-2">
                  <span className="text-[var(--text-muted)]">4. Tires & Axle Wear</span>
                  <span className="font-mono font-bold text-orange-300">
                    {fmtCurrency(selectedVehicle.tiresCost)}
                  </span>
                </div>
                <div className="flex justify-between py-2 px-2">
                  <span className="text-[var(--text-muted)]">5. Insurance, Registration & Mulkiya</span>
                  <span className="font-mono font-bold text-emerald-300">
                    {fmtCurrency(selectedVehicle.insuranceCost)}
                  </span>
                </div>
                <div className="flex justify-between py-2 px-2">
                  <span className="text-[var(--text-muted)]">6. Traffic Fines & Road Tolls</span>
                  <span className="font-mono font-bold text-pink-300">
                    {fmtCurrency(selectedVehicle.finesCost)}
                  </span>
                </div>
                <div className="flex justify-between py-2 px-2">
                  <span className="text-[var(--text-muted)]">7. Operational Driver Labor Allocation</span>
                  <span className="font-mono font-bold text-violet-300">
                    {fmtCurrency(selectedVehicle.laborCost)}
                  </span>
                </div>
              </div>
            </div>

            {/* Disposition Advisory */}
            <div className="p-4 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] space-y-1">
              <p className="text-xs font-bold text-[var(--text-muted)]">Lifecycle Advisory:</p>
              <p className="text-xs text-[var(--text-muted)]">{selectedVehicle.dispositionReason}</p>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setSelectedVehicle(null)}
                className="px-4 py-2 rounded-xl bg-cyan-500 text-white font-bold text-xs hover:bg-cyan-400 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
