/**
 * Lane profitability panel for the logistics dashboard.
 *
 * Answers the questions ops leadership asks during weekly review:
 *   1. Which lanes make us the most money?
 *   2. Which lanes are LOSING money? (carrier cost > customer rate)
 *   3. Are the high-volume lanes also the high-margin ones?
 *
 * Reads from /api/logistics/analytics/lanes. The margin numbers became
 * trustworthy when the rate-engine work started auto-populating
 * customer_rate_amount + margin_amount on every shipment — before that
 * this panel would have shown garbage.
 */

'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Route as RouteIcon } from 'lucide-react';
import { Panel } from '@/components/ui/page-theme';

interface LaneSummary {
  origin: string;
  destination: string;
  margin: number;
  shipments: number;
}

interface LanesResponse {
  period: { days: number; from: string; to: string };
  totals: {
    lanes: number;
    shipments: number;
    revenue: number;
    carrierCost: number;
    margin: number;
    marginPct: number;
  };
  topByMargin: LaneSummary[];
  topLossMakers: LaneSummary[];
}

function fmt(n: number) {
  return `AED ${Math.round(n).toLocaleString('en-AE')}`;
}

export default function LaneProfitabilityPanel() {
  const [data, setData] = useState<LanesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/logistics/analytics/lanes?period=90&limit=50', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as LanesResponse;
        if (!cancelled) { setData(json); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'fetch failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="h-44 rounded-2xl bg-slate-800/60 animate-pulse" />;
  if (error || !data) return null; // Fail-silent

  const { totals, topByMargin, topLossMakers, period } = data;
  const noData = totals.shipments === 0;
  const marginPctAccent = totals.marginPct >= 20 ? 'emerald' : totals.marginPct >= 10 ? 'amber' : 'rose';
  const marginPctText  = totals.marginPct >= 20 ? 'text-emerald-300' : totals.marginPct >= 10 ? 'text-amber-300' : 'text-rose-300';

  return (
    <Panel
      title={`Lane profitability · last ${period.days} days`}
      icon={RouteIcon}
      accent={marginPctAccent}
    >
      {noData ? (
        <div className="text-sm text-slate-500 italic py-4">
          No priced shipments in this period yet. The rate engine populates
          customer_rate_amount + margin_amount on each new shipment — once
          you have a handful, this panel fills in.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* ── Headline totals ─────────────────────────────────────────── */}
          <div className="flex flex-col gap-2">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Overall margin</div>
            <div className={`text-5xl font-bold ${marginPctText}`}>{totals.marginPct}%</div>
            <div className="text-xs text-slate-400">
              {fmt(totals.margin)} margin on {fmt(totals.revenue)} revenue
            </div>
            <div className="text-xs text-slate-500">
              {totals.shipments.toLocaleString()} shipments across {totals.lanes} lane{totals.lanes === 1 ? '' : 's'}
            </div>
          </div>

          {/* ── Top earning lanes ──────────────────────────────────────── */}
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              Top earning lanes
            </div>
            {topByMargin.length === 0 ? (
              <div className="text-xs text-slate-500 italic">No positive-margin lanes yet.</div>
            ) : (
              <ul className="space-y-1.5">
                {topByMargin.map(l => (
                  <li key={`${l.origin}-${l.destination}`} className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 truncate mr-2">
                      {l.origin} → {l.destination}
                    </span>
                    <span className="text-emerald-300 whitespace-nowrap font-medium">
                      {fmt(l.margin)} · {l.shipments}×
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Loss-making lanes ──────────────────────────────────────── */}
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
              <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
              Loss-making lanes
            </div>
            {topLossMakers.length === 0 ? (
              <div className="text-xs text-emerald-400 italic">
                ✓ No lanes losing money in the last {period.days} days.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {topLossMakers.map(l => (
                  <li key={`${l.origin}-${l.destination}`} className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 truncate mr-2">
                      {l.origin} → {l.destination}
                    </span>
                    <span className="text-rose-300 whitespace-nowrap font-medium">
                      {fmt(l.margin)} · {l.shipments}×
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
