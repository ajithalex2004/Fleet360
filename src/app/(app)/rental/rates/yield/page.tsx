'use client';

/**
 * Yield Analyzer — RAC dynamic pricing explorer.
 * Pick a category + dates + channel, watch the engine apply 7 layers
 * (BASE → LOR → WEEKEND → LEAD_TIME → UTILIZATION → EVENT → CHANNEL)
 * and explain each adjustment.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Sparkles, ArrowDown, AlertTriangle } from 'lucide-react';

type Channel = 'DIRECT' | 'CORPORATE' | 'AGENCY' | 'ONLINE';

interface YieldLayer {
  layer: 'BASE' | 'LOR' | 'WEEKEND' | 'LEAD_TIME' | 'UTILIZATION' | 'EVENT' | 'CHANNEL';
  label: string;
  multiplier: number;
  dailyRateBefore: number;
  dailyRateAfter: number;
  rationale: string;
  metadata?: Record<string, unknown>;
}

interface YieldResult {
  vehicleCategory: string;
  channel: string;
  totalDays: number;
  appliedRuleId: string | null;
  ruleName: string;
  baseDailyRate: number;
  finalDailyRate: number;
  baseRentalCharge: number;
  trace: YieldLayer[];
  totalAdjustmentPct: number;
  asOf: string;
}

interface Diagnostics {
  rulesConsidered: number;
  eventsConsidered: number;
  utilizationPctUsed?: number;
  utilizationAuto: boolean;
}

const CATEGORIES = [
  'ECONOMY', 'COMPACT', 'MID_SIZE_SEDAN', 'FULL_SIZE_SEDAN',
  'COMPACT_SUV', 'STANDARD_SUV', 'FULL_SIZE_SUV', 'LUXURY_SEDAN', 'LUXURY_SUV',
  'VAN', 'PICKUP', 'MINI_BUS',
];

const LAYER_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  BASE:        { bg: 'bg-slate-700/40',   border: 'border-slate-600',     text: 'text-slate-200' },
  LOR:         { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/30',   text: 'text-cyan-200' },
  WEEKEND:     { bg: 'bg-violet-500/10',  border: 'border-violet-500/30', text: 'text-violet-200' },
  LEAD_TIME:   { bg: 'bg-blue-500/10',    border: 'border-blue-500/30',   text: 'text-blue-200' },
  UTILIZATION: { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',  text: 'text-amber-200' },
  EVENT:       { bg: 'bg-rose-500/10',    border: 'border-rose-500/30',   text: 'text-rose-200' },
  CHANNEL:     { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-200' },
};

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function YieldAnalyzerPage() {
  const [category, setCategory] = useState('STANDARD_SUV');
  const [pickupDate, setPickupDate] = useState(todayPlus(7));
  const [dropoffDate, setDropoffDate] = useState(todayPlus(14));
  const [channel, setChannel] = useState<Channel>('DIRECT');
  const [utilOverride, setUtilOverride] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<YieldResult | null>(null);
  const [diag, setDiag] = useState<Diagnostics | null>(null);

  async function calculate() {
    setBusy(true);
    setError(null);
    try {
      const body: any = {
        vehicleCategory: category,
        pickupDate: new Date(pickupDate).toISOString(),
        dropoffDate: new Date(dropoffDate).toISOString(),
        channel,
      };
      if (utilOverride.trim() !== '') {
        const n = parseFloat(utilOverride);
        if (!Number.isNaN(n)) body.fleetUtilizationPct = Math.max(0, Math.min(100, n));
      }
      const res = await fetch('/api/rental/rates/yield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Server returned ${res.status}`);
        return;
      }
      setResult(data.result);
      setDiag(data.diagnostics);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Calculation failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <Link href="/rental/rates" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-cyan-400">
          <ChevronLeft className="h-3 w-3" /> Back to rates
        </Link>
        <h1 className="text-3xl font-bold text-white mt-2 flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-teal-400" />
          Yield Analyzer
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Layered dynamic-pricing explorer. Each layer adjusts the daily rate
          and explains why — so the operator knows exactly how the price was set.
        </p>
      </div>

      {/* Inputs */}
      <div className="bg-slate-800/50 border border-teal-500/20 rounded-2xl p-6">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Vehicle category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700 text-white text-sm"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Pickup date</label>
            <input
              type="date"
              value={pickupDate}
              onChange={(e) => setPickupDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700 text-white text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Drop-off date</label>
            <input
              type="date"
              value={dropoffDate}
              onChange={(e) => setDropoffDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700 text-white text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Channel</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as Channel)}
              className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700 text-white text-sm"
            >
              <option value="DIRECT">Direct (counter)</option>
              <option value="CORPORATE">Corporate</option>
              <option value="AGENCY">Agency / OTA</option>
              <option value="ONLINE">Online (own website)</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-slate-400 block mb-1">
              Override utilization % (blank = auto-calc from active bookings)
            </label>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              placeholder="auto"
              value={utilOverride}
              onChange={(e) => setUtilOverride(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700 text-white text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <button
            onClick={calculate}
            disabled={busy}
            className="px-6 py-2 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            {busy ? 'Calculating…' : 'Run Yield Calculation'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-900/30 border border-rose-700 p-4 text-rose-200 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && diag && (
        <div className="space-y-3">
          {/* Summary */}
          <div className="bg-slate-800/50 border border-emerald-500/30 rounded-2xl p-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-xs text-slate-400 uppercase tracking-wider">Final daily rate</div>
                <div className="text-3xl font-bold text-white mt-1">
                  AED {result.finalDailyRate.toLocaleString()}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  was AED {result.baseDailyRate.toLocaleString()} · {result.totalAdjustmentPct >= 0 ? '+' : ''}
                  {result.totalAdjustmentPct.toFixed(1)}% net adjustment
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-400 uppercase tracking-wider">Total for {result.totalDays} days</div>
                <div className="text-2xl font-bold text-emerald-300 mt-1">
                  AED {result.baseRentalCharge.toLocaleString()}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Excludes ancillaries, insurance, VAT
                </div>
              </div>
            </div>
            <div className="mt-3 flex gap-3 text-xs text-slate-400 flex-wrap">
              <span>Rule: <strong className="text-slate-200">{result.ruleName}</strong></span>
              <span>·</span>
              <span>Channel: <strong className="text-slate-200">{result.channel}</strong></span>
              <span>·</span>
              <span>{diag.rulesConsidered} rule(s) considered</span>
              <span>·</span>
              <span>{diag.eventsConsidered} event(s) overlap</span>
              {diag.utilizationPctUsed != null && (
                <>
                  <span>·</span>
                  <span>Utilization: <strong className="text-slate-200">{diag.utilizationPctUsed}%</strong>{diag.utilizationAuto ? ' (auto)' : ' (override)'}</span>
                </>
              )}
            </div>
          </div>

          {/* Layered trace */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              How the price was calculated
            </h3>
            {result.trace.map((layer, i) => {
              const c = LAYER_COLORS[layer.layer] ?? LAYER_COLORS.BASE;
              const delta = layer.dailyRateAfter - layer.dailyRateBefore;
              const pct = (layer.multiplier - 1) * 100;
              return (
                <React.Fragment key={i}>
                  {i > 0 && (
                    <div className="flex justify-center">
                      <ArrowDown className="h-4 w-4 text-slate-600" />
                    </div>
                  )}
                  <div className={`rounded-xl border ${c.bg} ${c.border} p-4`}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3">
                        <span className={`text-[10px] uppercase tracking-wider font-bold ${c.text} px-2 py-0.5 rounded ${c.bg} border ${c.border}`}>
                          {layer.layer.replace('_', ' ')}
                        </span>
                        <span className="font-semibold text-white">{layer.label}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-slate-400">
                          AED {layer.dailyRateBefore.toLocaleString()}
                          {layer.dailyRateAfter !== layer.dailyRateBefore && (
                            <>
                              {' → '}
                              <strong className={delta >= 0 ? 'text-rose-300' : 'text-emerald-300'}>
                                AED {layer.dailyRateAfter.toLocaleString()}
                              </strong>
                            </>
                          )}
                        </div>
                        {pct !== 0 && (
                          <div className={`text-xs ${pct > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-slate-400 mt-2">{layer.rationale}</p>
                  </div>
                </React.Fragment>
              );
            })}
          </div>

          <p className="text-xs text-slate-500 italic">
            Yield engine layers, in order: BASE → LOR (length-of-rental) → WEEKEND
            uplift → LEAD_TIME (early-bird vs last-minute) → UTILIZATION surge/discount
            → EVENT calendar (festivals, F1, DSF) → CHANNEL (per-channel adjustment).
            Each layer's multiplier compounds.
          </p>
        </div>
      )}
    </div>
  );
}
