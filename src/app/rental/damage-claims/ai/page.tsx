'use client';

/**
 * Damage AI Studio — drop a photo (or before+after pair), get a structured
 * damage assessment with UAE bodyshop cost estimates.
 *
 * Two modes:
 *   - Single photo: identify all visible damage
 *   - Before vs After: isolate only NEW damage (the dispute-killer)
 */

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Sparkles, ChevronLeft, AlertTriangle, CheckCircle2,
  ArrowRight, Image as ImageIcon, Camera,
} from 'lucide-react';

type Mode = 'single' | 'diff';

interface DamageItem {
  damageType: string;
  location: string;
  severity: 'MINOR' | 'MODERATE' | 'MAJOR' | 'TOTAL_LOSS';
  description: string;
  estimatedCostMin: number;
  estimatedCostMax: number;
  confidence: 'low' | 'medium' | 'high';
  origin: 'NEW' | 'PRE_EXISTING' | 'REPAIRED' | null;
}

interface Classification {
  mode: 'SINGLE' | 'DIFF';
  vehicleLooksRoadworthy: boolean;
  overallCondition: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'NON_DRIVEABLE';
  damages: DamageItem[];
  summaryEn: string;
  summaryAr: string;
  billableEstimateMin: number;
  billableEstimateMax: number;
  currency: string;
  warnings: string[];
}

const SEVERITY_COLORS: Record<string, string> = {
  MINOR: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  MODERATE: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  MAJOR: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  TOTAL_LOSS: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
};
const ORIGIN_COLORS: Record<string, string> = {
  NEW: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  PRE_EXISTING: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
  REPAIRED: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
};
const CONDITION_COLORS: Record<string, string> = {
  EXCELLENT: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  GOOD: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  FAIR: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  POOR: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  NON_DRIVEABLE: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

export default function DamageAIPage() {
  const [mode, setMode] = useState<Mode>('single');
  const [singlePhoto, setSinglePhoto] = useState<File | null>(null);
  const [beforePhoto, setBeforePhoto] = useState<File | null>(null);
  const [afterPhoto, setAfterPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Classification | null>(null);

  const canRun = mode === 'single'
    ? singlePhoto !== null
    : beforePhoto !== null && afterPhoto !== null;

  async function classify() {
    if (!canRun) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      if (mode === 'single' && singlePhoto) {
        fd.append('photo', singlePhoto);
      } else if (mode === 'diff' && beforePhoto && afterPhoto) {
        fd.append('beforePhoto', beforePhoto);
        fd.append('afterPhoto', afterPhoto);
      }
      const res = await fetch('/api/rental/damage-claims/classify', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Server returned ${res.status}`);
        return;
      }
      setResult(data.classification);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setSinglePhoto(null);
    setBeforePhoto(null);
    setAfterPhoto(null);
    setResult(null);
    setError(null);
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <Link href="/rental/damage-claims" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-cyan-400">
          <ChevronLeft className="h-3 w-3" /> Back to damage claims
        </Link>
        <h1 className="text-3xl font-bold text-white mt-2 flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-rose-400" />
          Damage AI Studio
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          gpt-4o vision identifies damage on a vehicle photo and estimates
          repair cost from the UAE bodyshop price index. Diff mode isolates
          new damage from pre-existing — closes the #1 customer-dispute area.
        </p>
      </div>

      {/* Mode picker */}
      <div className="flex gap-2 p-1 bg-slate-900/60 rounded-xl border border-slate-700">
        <button
          onClick={() => { setMode('single'); reset(); }}
          className={`flex-1 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
            mode === 'single'
              ? 'bg-rose-600 text-white shadow-lg'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <div className="font-semibold flex items-center justify-center gap-2">
            <Camera className="h-4 w-4" /> Single photo
          </div>
          <div className="text-xs opacity-75 mt-0.5">Identify all visible damage</div>
        </button>
        <button
          onClick={() => { setMode('diff'); reset(); }}
          className={`flex-1 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
            mode === 'diff'
              ? 'bg-rose-600 text-white shadow-lg'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <div className="font-semibold flex items-center justify-center gap-2">
            <ImageIcon className="h-4 w-4" /> Before vs After
          </div>
          <div className="text-xs opacity-75 mt-0.5">Isolate NEW damage only</div>
        </button>
      </div>

      {/* File pickers */}
      <div className="bg-slate-800/50 border border-rose-500/20 rounded-2xl p-6">
        {mode === 'single' ? (
          <div>
            <label className="text-xs text-slate-400 block mb-2">Vehicle photo *</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setSinglePhoto(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-rose-700 file:text-white hover:file:bg-rose-600"
            />
            {singlePhoto && (
              <p className="mt-1 text-xs text-slate-400">
                {singlePhoto.name} ({(singlePhoto.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400 block mb-2">
                <span className="font-semibold text-emerald-300">BEFORE</span> handover photo *
              </label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setBeforePhoto(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-emerald-700 file:text-white hover:file:bg-emerald-600"
              />
              {beforePhoto && (
                <p className="mt-1 text-xs text-slate-400">
                  {beforePhoto.name} ({(beforePhoto.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-2">
                <span className="font-semibold text-rose-300">AFTER</span> return photo *
              </label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setAfterPhoto(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-rose-700 file:text-white hover:file:bg-rose-600"
              />
              {afterPhoto && (
                <p className="mt-1 text-xs text-slate-400">
                  {afterPhoto.name} ({(afterPhoto.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            onClick={classify}
            disabled={!canRun || busy}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            {busy ? 'Analysing…' : `Run ${mode === 'single' ? 'Damage' : 'Diff'} Analysis`}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-900/30 border border-rose-700 p-4 text-rose-200 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Summary card */}
          <div className="bg-slate-800/50 border border-emerald-500/20 rounded-2xl p-6">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <span className="text-sm font-semibold text-emerald-300 uppercase tracking-wider">
                  Analysis complete
                </span>
              </div>
              <div className="flex gap-2 flex-wrap">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${CONDITION_COLORS[result.overallCondition]}`}>
                  {result.overallCondition}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${result.vehicleLooksRoadworthy ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-rose-500/20 text-rose-300 border-rose-500/40'}`}>
                  {result.vehicleLooksRoadworthy ? 'Roadworthy' : 'NOT roadworthy'}
                </span>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700 text-slate-300 border border-slate-600">
                  {result.mode} mode
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
              <Stat label="Damages found" value={result.damages.length.toString()} />
              <Stat
                label={mode === 'diff' ? 'NEW damages' : 'All damages'}
                value={result.damages.filter(d => mode === 'diff' ? d.origin === 'NEW' : true).length.toString()}
              />
              <Stat
                label="Billable estimate"
                value={`AED ${result.billableEstimateMin.toLocaleString()}–${result.billableEstimateMax.toLocaleString()}`}
                tone="rose"
              />
            </div>

            {/* Bilingual summary */}
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-700">
                <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Summary (EN)</div>
                <p className="text-slate-200 leading-relaxed">{result.summaryEn}</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-700" dir="rtl" lang="ar">
                <div className="text-xs text-slate-500 uppercase tracking-wider mb-1" dir="ltr">Summary (AR)</div>
                <p className="text-slate-200 leading-relaxed">{result.summaryAr}</p>
              </div>
            </div>
          </div>

          {/* Per-damage cards */}
          {result.damages.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                Detected damages ({result.damages.length})
              </h3>
              {result.damages.map((d, i) => (
                <div
                  key={i}
                  className={`rounded-xl border p-4 ${
                    d.origin === 'NEW' ? 'bg-rose-900/20 border-rose-700/50'
                    : d.origin === 'PRE_EXISTING' ? 'bg-slate-800/40 border-slate-700'
                    : d.origin === 'REPAIRED' ? 'bg-emerald-900/20 border-emerald-700/50'
                    : 'bg-slate-800/40 border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-cyan-300">{d.damageType}</span>
                        <span className="text-slate-500">·</span>
                        <span className="text-sm font-semibold text-white">
                          {d.location.replace(/_/g, ' ')}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${SEVERITY_COLORS[d.severity]}`}>
                          {d.severity}
                        </span>
                        {d.origin && (
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${ORIGIN_COLORS[d.origin]}`}>
                            {d.origin === 'NEW' ? '⚠ NEW' : d.origin === 'PRE_EXISTING' ? '◇ Pre-existing' : '✓ Repaired'}
                          </span>
                        )}
                        <span className="text-[10px] text-slate-500 uppercase">
                          {d.confidence} conf.
                        </span>
                      </div>
                      <p className="text-sm text-slate-300 mt-2">{d.description}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-400">Repair estimate</div>
                      <div className="text-lg font-bold text-white">
                        AED {d.estimatedCostMin.toLocaleString()}–{d.estimatedCostMax.toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 rounded-xl bg-emerald-900/20 border border-emerald-700/40 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-emerald-200">No damage detected. Vehicle returned in clean condition.</p>
            </div>
          )}

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div className="bg-amber-900/20 border border-amber-500/30 rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-amber-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> Image quality / accuracy notes
              </h3>
              <ul className="space-y-1">
                {result.warnings.map((w, i) => (
                  <li key={i} className="text-sm text-amber-100">• {w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* CTA */}
          <div className="flex gap-3 justify-end">
            <button
              onClick={reset}
              className="px-4 py-2 rounded-xl bg-slate-700 text-slate-200 hover:bg-slate-600 text-sm"
            >
              Analyse another vehicle
            </button>
            <Link
              href="/rental/damage-claims"
              className="px-6 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 text-white text-sm font-medium hover:opacity-90 flex items-center gap-2"
            >
              Create Damage Claim <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <p className="text-xs text-slate-500 italic">
            AI estimates use the UAE bodyshop reference index. Final invoice amount
            should reflect actual repair quote from the bodyshop. Photos are not
            persisted by the classifier — keep originals for the damage claim record.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'rose' }) {
  return (
    <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-700">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${tone === 'rose' ? 'text-rose-300' : 'text-white'}`}>
        {value}
      </div>
    </div>
  );
}
