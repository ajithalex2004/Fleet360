/**
 * Rate-contract coverage panel for the logistics dashboard.
 *
 * Answers two questions leadership has every quarter:
 *   1. What fraction of recent shipments were priced from a contract?
 *      (If it's 30%, the contracts we negotiated last quarter aren't being
 *      used. If it's 95%, dispatch is honouring the rate cards.)
 *   2. Which lanes are we doing without a contract? Those are the gaps
 *      the rate team should close next.
 *
 * Reads from /api/logistics/rates/coverage. 30-day rolling window. The
 * panel is read-only — when an operator clicks an uncontracted lane they
 * deep-link to /logistics/rate-contracts where they can add one.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TrendingUp, FileText, AlertTriangle } from 'lucide-react';
import { Panel } from '@/components/ui/page-theme';

interface CoverageResponse {
  period: { days: number; from: string; to: string };
  totals: { total: number; withContract: number; withoutContract: number; percentage: number };
  byContract: Array<{ contractId: string; contractNo: string; count: number; totalRevenue: number; currency: string }>;
  uncontractedLanes: Array<{ origin: string; destination: string; count: number }>;
}

export default function RateCoveragePanel() {
  const [data, setData] = useState<CoverageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/logistics/rates/coverage?period=30', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as CoverageResponse;
        if (!cancelled) { setData(json); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'fetch failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="h-44 rounded-2xl bg-slate-800/60 animate-pulse" />;
  }

  if (error || !data) {
    return null; // Fail-silent: dashboard remains useful even if this tile breaks.
  }

  const { totals, byContract, uncontractedLanes, period } = data;
  const pct = totals.percentage;
  const accent = pct >= 80 ? 'emerald' : pct >= 50 ? 'amber' : 'rose';
  const accentText = pct >= 80 ? 'text-emerald-300' : pct >= 50 ? 'text-amber-300' : 'text-rose-300';

  return (
    <Panel
      title={`Rate-contract coverage · last ${period.days} days`}
      icon={TrendingUp}
      accent={accent}
      actions={
        <Link href="/logistics/rate-contracts" className="text-sm text-amber-300 hover:text-amber-200">
          Manage contracts →
        </Link>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── Headline ───────────────────────────────────────────────── */}
        <div className="flex flex-col items-start gap-2">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Quoted from contract</div>
          <div className={`text-5xl font-bold ${accentText}`}>{pct}%</div>
          <div className="text-xs text-slate-400">
            {totals.withContract.toLocaleString()} of {totals.total.toLocaleString()} shipments
          </div>
          {totals.withoutContract > 0 && (
            <div className="text-xs text-slate-500">
              {totals.withoutContract.toLocaleString()} priced manually
            </div>
          )}
        </div>

        {/* ── Top contracts in use ──────────────────────────────────── */}
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Most-used contracts
          </div>
          {byContract.length === 0 ? (
            <div className="text-xs text-slate-500 italic">
              No shipments priced from a contract this period.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {byContract.slice(0, 5).map(c => (
                <li key={c.contractId} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-300 truncate mr-2">{c.contractNo}</span>
                  <span className="text-slate-400 whitespace-nowrap">
                    {c.count}× · {c.currency} {c.totalRevenue.toLocaleString('en-AE')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Uncontracted lanes (the actionable list) ──────────────── */}
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            Uncontracted lanes
          </div>
          {uncontractedLanes.length === 0 ? (
            <div className="text-xs text-emerald-400 italic">
              ✓ Every shipped lane has a contract.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {uncontractedLanes.slice(0, 5).map(lane => (
                <li key={`${lane.origin}-${lane.destination}`} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 truncate mr-2">
                    {lane.origin} → {lane.destination}
                  </span>
                  <span className="text-amber-400 whitespace-nowrap font-medium">
                    {lane.count}×
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}
