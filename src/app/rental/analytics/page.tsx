'use client';
import React, { useState, useEffect, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────
interface Overview {
  total_revenue: number;
  total_bookings: number;
  avg_rental_days: number;
  total_inquiries: number;
  total_quotes: number;
  accepted_quotes: number;
  quote_conversion_rate: number;
}

interface BranchStat {
  branch_name: string;
  emirate: string;
  revenue: number;
  booking_count: number;
  inquiry_count: number;
  quote_count: number;
  accepted_quotes: number;
  conversion_rate: number;
}

interface MonthStat {
  month: string;
  revenue: number;
  bookings: number;
  inquiries: number;
}

interface VehicleTypeStat {
  vehicle_type: string;
  count: number;
  revenue: number;
  share_pct: number;
}

interface SourceStat {
  source: string;
  count: number;
  pct: number;
}

interface HandoverStats {
  total_pickups: number;
  total_returns: number;
  avg_condition_score: number;
  avg_fuel_at_return: number;
}

interface Pipeline {
  inquiries: number;
  quotations: number;
  accepted: number;
  bookings: number;
}

interface AnalyticsData {
  period: { start: string; end: string };
  overview: Overview;
  by_branch: BranchStat[];
  by_month: MonthStat[];
  by_vehicle_type: VehicleTypeStat[];
  by_source: SourceStat[];
  handover_stats: HandoverStats;
  quotations_pipeline: Pipeline;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const fmtAED = (n: number) => `AED ${fmt(n)}`;

const SOURCE_META: Record<string, { icon: string; color: string; label: string }> = {
  WALK_IN:  { icon: '🚶', color: 'bg-teal-500',   label: 'Walk-in' },
  PHONE:    { icon: '📞', color: 'bg-blue-500',   label: 'Phone' },
  WEBSITE:  { icon: '🌐', color: 'bg-purple-500', label: 'Website' },
  WHATSAPP: { icon: '💬', color: 'bg-green-500',  label: 'WhatsApp' },
  REFERRAL: { icon: '👥', color: 'bg-amber-500',  label: 'Referral' },
  ONLINE:   { icon: '💻', color: 'bg-indigo-500', label: 'Online' },
  APP:      { icon: '📱', color: 'bg-pink-500',   label: 'App' },
};

const VEHICLE_META: Record<string, { emoji: string }> = {
  Economy: { emoji: '🚗' },
  Sedan:   { emoji: '🚙' },
  SUV:     { emoji: '🚕' },
  Luxury:  { emoji: '🏎️' },
  Van:     { emoji: '🚐' },
  Bus:     { emoji: '🚌' },
  Other:   { emoji: '🚘' },
};

function StarRating({ score, max = 5 }: { score: number; max?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} className={i < Math.round(score) ? 'text-amber-400' : 'text-slate-600'}>
          ★
        </span>
      ))}
    </div>
  );
}

function FuelBar({ level }: { level: number }) {
  // level is 0–8 (fuel notches) or could be 0–100
  const pct = level > 10 ? level : level * 12.5; // normalize
  const color = pct >= 60 ? 'bg-green-500' : pct >= 30 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-slate-700 rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full ${color} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs text-slate-400 w-8 text-right">{Math.round(pct)}%</span>
    </div>
  );
}

function TrendBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return <span className="text-slate-500 text-xs">—</span>;
  if (previous === 0) return <span className="text-emerald-400 text-xs font-medium">▲ New</span>;
  const delta = ((current - previous) / previous) * 100;
  const up = delta >= 0;
  return (
    <span className={`text-xs font-medium ${up ? 'text-emerald-400' : 'text-red-400'}`}>
      {up ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function RentalAnalyticsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const ninetyAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(ninetyAgo);
  const [endDate,   setEndDate]   = useState(today);
  const [data,      setData]      = useState<AnalyticsData | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const runReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/rental/analytics?startDate=${startDate}&endDate=${endDate}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => { runReport(); }, [runReport]);

  const ov = data?.overview ?? {
    total_revenue: 0, total_bookings: 0, avg_rental_days: 0,
    total_inquiries: 0, total_quotes: 0, accepted_quotes: 0,
    quote_conversion_rate: 0,
  };
  const maxBranchRevenue = Math.max(...(data?.by_branch ?? []).map(b => b.revenue), 1);

  return (
    <div className="space-y-8">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>📈</span> Rental Analytics &amp; Performance
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            Branch-level insights, revenue tracking, and operational KPIs
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-slate-400">From</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <label className="text-xs text-slate-400">To</label>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <button
            onClick={runReport}
            disabled={loading}
            className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white text-sm font-medium transition-all disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Run Report'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* ── Section 1: Overview KPIs ───────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Revenue */}
        <div className="bg-gradient-to-br from-teal-900/50 to-teal-950 border border-teal-500/20 rounded-2xl p-5">
          <div className="text-2xl mb-2">💰</div>
          <p className="text-xs text-teal-400 font-medium uppercase tracking-wide">Total Revenue</p>
          <p className="text-2xl font-bold text-white mt-1">{fmtAED(ov.total_revenue)}</p>
          <p className="text-xs text-slate-500 mt-1">Across all branches</p>
        </div>
        {/* Bookings */}
        <div className="bg-gradient-to-br from-blue-900/50 to-blue-950 border border-blue-500/20 rounded-2xl p-5">
          <div className="text-2xl mb-2">📅</div>
          <p className="text-xs text-blue-400 font-medium uppercase tracking-wide">Total Bookings</p>
          <p className="text-2xl font-bold text-white mt-1">{fmt(ov.total_bookings)}</p>
          <p className="text-xs text-slate-500 mt-1">Avg {ov.avg_rental_days} days/rental</p>
        </div>
        {/* Conversion */}
        <div className="bg-gradient-to-br from-emerald-900/50 to-emerald-950 border border-emerald-500/20 rounded-2xl p-5">
          <div className="text-2xl mb-2">📊</div>
          <p className="text-xs text-emerald-400 font-medium uppercase tracking-wide">Quote Conversion</p>
          <p className="text-2xl font-bold text-white mt-1">{ov.quote_conversion_rate}%</p>
          <p className="text-xs text-slate-500 mt-1">{fmt(ov.accepted_quotes)} / {fmt(ov.total_quotes)} quotes</p>
        </div>
        {/* Inquiries */}
        <div className="bg-gradient-to-br from-amber-900/50 to-amber-950 border border-amber-500/20 rounded-2xl p-5">
          <div className="text-2xl mb-2">🔍</div>
          <p className="text-xs text-amber-400 font-medium uppercase tracking-wide">Total Inquiries</p>
          <p className="text-2xl font-bold text-white mt-1">{fmt(ov.total_inquiries)}</p>
          <p className="text-xs text-slate-500 mt-1">Lead pipeline entries</p>
        </div>
      </div>

      {/* ── Section 2: Revenue by Branch ──────────────────────────────── */}
      <div className="bg-slate-900 border border-white/5 rounded-2xl p-6">
        <h2 className="text-base font-semibold text-white mb-5 flex items-center gap-2">
          <span>🏢</span> Revenue by Branch
        </h2>
        {(data?.by_branch ?? []).length === 0 ? (
          <div className="text-center py-10 text-slate-500">
            <div className="text-3xl mb-2">🏙️</div>
            <p className="text-sm">No branch data available — add branches and bookings to see analytics</p>
          </div>
        ) : (
          <div className="space-y-4">
            {(data?.by_branch ?? []).map((branch) => {
              const pct = maxBranchRevenue > 0
                ? Math.round((branch.revenue / maxBranchRevenue) * 100)
                : 0;
              return (
                <div key={branch.branch_name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base flex-shrink-0">
                        {branch.emirate === 'DUBAI' ? '🇦🇪' :
                         branch.emirate === 'ABU DHABI' ? '🏛️' :
                         branch.emirate === 'SHARJAH' ? '🕌' : '📍'}
                      </span>
                      <span className="text-white font-medium truncate">{branch.branch_name}</span>
                      <span className="text-xs text-slate-500 hidden md:inline">{branch.emirate}</span>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0 text-xs text-slate-400">
                      <span>{branch.booking_count} bookings</span>
                      <span className="text-teal-400 font-semibold">{fmtAED(branch.revenue)}</span>
                    </div>
                  </div>
                  <div className="bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-teal-500 to-cyan-400 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Section 3 + 4: Inquiry Sources + Vehicle Types ────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Inquiry Sources */}
        <div className="bg-slate-900 border border-white/5 rounded-2xl p-6">
          <h2 className="text-base font-semibold text-white mb-5 flex items-center gap-2">
            <span>📡</span> Inquiry Sources
          </h2>
          {(data?.by_source ?? []).length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <div className="text-2xl mb-2">📭</div>
              <p className="text-sm">No inquiry source data available</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(data?.by_source ?? []).map((src) => {
                const meta = SOURCE_META[src.source] ?? {
                  icon: '📌',
                  color: 'bg-slate-500',
                  label: src.source,
                };
                return (
                  <div key={src.source} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-slate-300">
                        <span>{meta.icon}</span>
                        <span>{meta.label}</span>
                      </span>
                      <span className="text-xs font-medium text-slate-400">
                        {src.count} ({src.pct}%)
                      </span>
                    </div>
                    <div className="bg-slate-800 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-2 rounded-full ${meta.color} transition-all`}
                        style={{ width: `${src.pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Vehicle Type Popularity */}
        <div className="bg-slate-900 border border-white/5 rounded-2xl p-6">
          <h2 className="text-base font-semibold text-white mb-5 flex items-center gap-2">
            <span>🚗</span> Vehicle Type Popularity
          </h2>
          {(data?.by_vehicle_type ?? []).length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <div className="text-2xl mb-2">🅿️</div>
              <p className="text-sm">No vehicle type data available</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {(data?.by_vehicle_type ?? []).map((vt) => {
                const meta = VEHICLE_META[vt.vehicle_type] ?? { emoji: '🚘' };
                return (
                  <div
                    key={vt.vehicle_type}
                    className="bg-slate-800/60 rounded-xl p-4 border border-white/5 relative overflow-hidden"
                  >
                    {/* Donut-style fill indicator */}
                    <div
                      className="absolute inset-0 bg-teal-500/5 transition-all"
                      style={{ height: `${vt.share_pct}%`, bottom: 0, top: 'auto' }}
                    />
                    <div className="relative">
                      <div className="text-xl mb-1">{meta.emoji}</div>
                      <p className="text-xs text-slate-400 font-medium">{vt.vehicle_type}</p>
                      <p className="text-lg font-bold text-white">{fmt(vt.count)}</p>
                      <p className="text-xs text-teal-400">{fmtAED(vt.revenue)}</p>
                      <div className="mt-2 text-xs text-slate-500">{vt.share_pct}% share</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Section 5: Monthly Trend ───────────────────────────────────── */}
      <div className="bg-slate-900 border border-white/5 rounded-2xl p-6">
        <h2 className="text-base font-semibold text-white mb-5 flex items-center gap-2">
          <span>📅</span> Monthly Trend
        </h2>
        {(data?.by_month ?? []).length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <div className="text-2xl mb-2">📆</div>
            <p className="text-sm">No monthly data available for this period</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-xs text-slate-500 uppercase tracking-wide">
                  <th className="text-left py-2 pr-4">Month</th>
                  <th className="text-right py-2 px-4">Revenue (AED)</th>
                  <th className="text-right py-2 px-4">Bookings</th>
                  <th className="text-right py-2 px-4">Inquiries</th>
                  <th className="text-right py-2 pl-4">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {(data?.by_month ?? []).map((mo, idx, arr) => {
                  const prev = arr[idx - 1];
                  return (
                    <tr key={mo.month} className="hover:bg-white/2 transition-colors">
                      <td className="py-3 pr-4 font-medium text-white">
                        {new Date(mo.month + '-01').toLocaleDateString('en-AE', {
                          month: 'short', year: 'numeric',
                        })}
                      </td>
                      <td className="py-3 px-4 text-right text-teal-400 font-semibold">
                        {fmtAED(mo.revenue)}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-300">
                        {fmt(mo.bookings)}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-300">
                        {fmt(mo.inquiries)}
                      </td>
                      <td className="py-3 pl-4 text-right">
                        {prev ? (
                          <TrendBadge current={mo.revenue} previous={prev.revenue} />
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Section 6: Handover Stats ──────────────────────────────────── */}
      <div className="bg-slate-900 border border-white/5 rounded-2xl p-6">
        <h2 className="text-base font-semibold text-white mb-5 flex items-center gap-2">
          <span>🔑</span> Handover Statistics
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-800/60 rounded-xl p-4 border border-white/5 text-center">
            <div className="text-2xl mb-1">📤</div>
            <p className="text-xs text-slate-400 mb-1">Total Pickups</p>
            <p className="text-2xl font-bold text-white">
              {fmt(data?.handover_stats.total_pickups ?? 0)}
            </p>
          </div>
          <div className="bg-slate-800/60 rounded-xl p-4 border border-white/5 text-center">
            <div className="text-2xl mb-1">📥</div>
            <p className="text-xs text-slate-400 mb-1">Total Returns</p>
            <p className="text-2xl font-bold text-white">
              {fmt(data?.handover_stats.total_returns ?? 0)}
            </p>
          </div>
          <div className="bg-slate-800/60 rounded-xl p-4 border border-white/5">
            <div className="text-2xl mb-1">⭐</div>
            <p className="text-xs text-slate-400 mb-2">Avg Condition Score</p>
            <p className="text-xl font-bold text-white mb-1">
              {(data?.handover_stats.avg_condition_score ?? 0).toFixed(1)} / 5
            </p>
            <StarRating score={data?.handover_stats.avg_condition_score ?? 0} />
          </div>
          <div className="bg-slate-800/60 rounded-xl p-4 border border-white/5">
            <div className="text-2xl mb-1">⛽</div>
            <p className="text-xs text-slate-400 mb-2">Avg Fuel at Return</p>
            <p className="text-xl font-bold text-white mb-2">
              {(data?.handover_stats.avg_fuel_at_return ?? 0).toFixed(1)} / 8
            </p>
            <FuelBar level={data?.handover_stats.avg_fuel_at_return ?? 0} />
          </div>
        </div>
      </div>

      {/* ── Section 7: Quotations Pipeline ────────────────────────────── */}
      <div className="bg-slate-900 border border-white/5 rounded-2xl p-6">
        <h2 className="text-base font-semibold text-white mb-5 flex items-center gap-2">
          <span>🔀</span> Quotations Pipeline
        </h2>
        {(() => {
          const pipe = data?.quotations_pipeline ?? {
            inquiries: 0, quotations: 0, accepted: 0, bookings: 0,
          };
          const stages = [
            { label: 'Inquiries',   value: pipe.inquiries,  icon: '🔍', color: 'from-amber-600 to-amber-500' },
            { label: 'Quotations',  value: pipe.quotations, icon: '📋', color: 'from-blue-600 to-blue-500' },
            { label: 'Accepted',    value: pipe.accepted,   icon: '✅', color: 'from-emerald-600 to-emerald-500' },
            { label: 'Bookings',    value: pipe.bookings,   icon: '📅', color: 'from-teal-600 to-teal-500' },
          ];
          const maxVal = Math.max(...stages.map(s => s.value), 1);

          return (
            <div className="flex items-end gap-3 md:gap-6">
              {stages.map((stage, idx) => {
                const prev = stages[idx - 1];
                const convPct = prev && prev.value > 0
                  ? Math.round((stage.value / prev.value) * 100)
                  : null;
                const barH = Math.max(Math.round((stage.value / maxVal) * 120), 4);

                return (
                  <React.Fragment key={stage.label}>
                    {idx > 0 && (
                      <div className="flex flex-col items-center gap-1 pb-8">
                        <span className="text-slate-600 text-lg">→</span>
                        {convPct !== null && (
                          <span className="text-xs text-slate-500">{convPct}%</span>
                        )}
                      </div>
                    )}
                    <div className="flex flex-col items-center gap-2 flex-1">
                      <p className="text-lg font-bold text-white">{fmt(stage.value)}</p>
                      <div
                        className={`w-full rounded-t-xl bg-gradient-to-t ${stage.color} transition-all`}
                        style={{ height: `${barH}px`, minHeight: '4px' }}
                      />
                      <div className="text-center">
                        <div className="text-lg">{stage.icon}</div>
                        <p className="text-xs text-slate-400 font-medium">{stage.label}</p>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          );
        })()}
      </div>

    </div>
  );
}
