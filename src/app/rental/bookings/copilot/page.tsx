'use client';

/**
 * AI Rental Co-pilot — describe a rental in plain English or Arabic,
 * get a structured booking proposal with priced ancillaries.
 */

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Sparkles, ChevronLeft, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface Ancillary {
  code: string;
  description: string;
  quantity: number;
  unitCharge: number;
  isOneTime: boolean;
  totalCharge: number;
}

interface Suggestion {
  vehicleCategory: string;
  exampleVehicles: string[];
  pickupLocation: string;
  dropoffLocation: string;
  pickupDate: string;
  dropoffDate: string;
  totalDays: number;
  channel: string;
  baseDailyRate: number;
  appliedDailyRate: number;
  lorDiscountPct: number;
  baseRentalCharge: number;
  insuranceTier: string;
  insuranceCharge: number;
  ancillaries: Ancillary[];
  ancillariesTotal: number;
  subTotal: number;
  vatPct: number;
  vatAmount: number;
  totalAmount: number;
  securityDeposit: number;
  pricingRationale: string;
  detectedLanguage: 'en' | 'ar' | 'mixed';
  confidence: 'low' | 'medium' | 'high';
  warnings: string[];
}

interface Meta {
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

const EXAMPLES = [
  {
    label: 'Tourist family (EN)',
    brief:
      'Saudi tourist family, 2 adults + 3 kids, need a full-size SUV from DXB airport pickup this Saturday morning until next Friday evening. Add GPS, 2 child seats, full insurance, planning a trip to Oman.',
  },
  {
    label: 'Corporate weekly (EN)',
    brief:
      'Corporate client needs 3 mid-size sedans for visiting consultants, weekly rental Mon-Fri, pickup from Sharjah office, return to same. Standard insurance, no extras. Direct billing to company.',
  },
  {
    label: 'Quick weekend (EN)',
    brief:
      'Weekend self-drive, 2 days, compact car for a single driver under 25, Dubai City pickup, no airport. Just basic insurance.',
  },
  {
    label: 'Luxury trip (AR)',
    brief:
      'سيارة فاخرة لمدة 10 أيام، استلام من فندق في دبي، تأمين شامل، سائق إضافي.',
  },
];

const CATEGORY_COLORS: Record<string, string> = {
  ECONOMY: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  COMPACT: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  MID_SIZE_SEDAN: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  FULL_SIZE_SEDAN: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  COMPACT_SUV: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
  STANDARD_SUV: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
  FULL_SIZE_SUV: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  LUXURY_SEDAN: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  LUXURY_SUV: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  VAN: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40',
  PICKUP: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  MINI_BUS: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  medium: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  low: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

export default function RentalCopilotPage() {
  const router = useRouter();
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (brief.trim().length < 10) {
      setError("Please describe the customer's rental needs in at least one sentence.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuggestion(null);
    setMeta(null);

    try {
      const res = await fetch('/api/rental/bookings/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Server returned ${res.status}`);
        return;
      }
      setSuggestion(data.suggestion);
      setMeta(data.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  function applyToNewBooking() {
    if (!suggestion) return;
    const payload = encodeURIComponent(JSON.stringify(suggestion));
    router.push(`/rental/bookings?from=copilot&data=${payload}`);
  }

  const isRtl = suggestion?.detectedLanguage === 'ar';

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <Link
          href="/rental/bookings"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-cyan-400"
        >
          <ChevronLeft className="h-3 w-3" /> Back to bookings
        </Link>
        <h1 className="text-3xl font-bold text-white mt-2 flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-teal-400" />
          AI Rental Co-pilot
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Describe what the customer needs in plain English or Arabic. The
          co-pilot returns a structured rental proposal with priced ancillaries
          and length-of-rental discount applied automatically.
        </p>
      </div>

      {/* Brief input */}
      <div className="bg-slate-800/50 border border-teal-500/20 rounded-2xl p-6 backdrop-blur-sm">
        <label className="block text-sm font-medium text-slate-300 mb-2">Customer brief</label>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={5}
          placeholder='e.g. "1 SUV for a Saudi family from DXB Saturday to next Friday, GPS + 2 child seats, full insurance, going to Oman."'
          className="w-full px-4 py-3 rounded-xl bg-slate-900/60 border border-slate-700 text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none transition resize-none"
        />
        <div className="flex flex-wrap gap-2 mt-3">
          <span className="text-xs text-slate-500 self-center mr-1">Try an example:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              onClick={() => setBrief(ex.brief)}
              className="text-xs px-3 py-1 rounded-full bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 border border-slate-600 transition"
            >
              {ex.label}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Powered by GPT-4o · responses typically take 5–15 seconds
          </p>
          <button
            onClick={handleGenerate}
            disabled={busy || brief.trim().length < 10}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            {busy ? 'Generating…' : 'Generate Booking'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-900/30 border border-rose-700 p-4 text-rose-200 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {suggestion && (
        <div className="space-y-4">
          {/* Header card */}
          <div className="bg-slate-800/50 border border-emerald-500/20 rounded-2xl p-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <span className="text-sm font-semibold text-emerald-300 uppercase tracking-wider">
                  Booking proposal ready
                </span>
              </div>
              <div className="flex gap-2 flex-wrap">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${CATEGORY_COLORS[suggestion.vehicleCategory] ?? 'bg-slate-700 text-slate-300 border-slate-600'}`}>
                  {suggestion.vehicleCategory.replace(/_/g, ' ')}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${CONFIDENCE_COLORS[suggestion.confidence]}`}>
                  {suggestion.confidence} confidence
                </span>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700 text-slate-300 border border-slate-600">
                  {suggestion.detectedLanguage.toUpperCase()} · {suggestion.channel}
                </span>
                {meta && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700/50 text-slate-400 border border-slate-700">
                    {meta.durationMs}ms · {meta.promptTokens + meta.completionTokens} tokens
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              <Stat label="Pickup" value={`${suggestion.pickupLocation}`} sub={suggestion.pickupDate} />
              <Stat label="Drop-off" value={`${suggestion.dropoffLocation}`} sub={suggestion.dropoffDate} />
              <Stat label="Duration" value={`${suggestion.totalDays} day${suggestion.totalDays === 1 ? '' : 's'}`} />
              <Stat
                label="Daily Rate"
                value={`AED ${suggestion.appliedDailyRate.toLocaleString()}`}
                sub={
                  suggestion.lorDiscountPct > 0
                    ? `was ${suggestion.baseDailyRate.toLocaleString()} (-${suggestion.lorDiscountPct}% LoR)`
                    : undefined
                }
              />
            </div>

            <div className="mt-4 p-3 rounded-xl bg-slate-900/50 border border-slate-700">
              <div className="text-xs text-slate-400 mb-1">Example vehicles in this category:</div>
              <div className="flex flex-wrap gap-2">
                {suggestion.exampleVehicles.map((v) => (
                  <span key={v} className="text-xs px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-200">
                    {v}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Cost breakdown */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Cost breakdown</h3>
            <div className="space-y-2 text-sm">
              <Row label="Base rental" sub={`${suggestion.totalDays} × AED ${suggestion.appliedDailyRate.toLocaleString()}`} amount={suggestion.baseRentalCharge} />
              <Row label={`Insurance · ${suggestion.insuranceTier}`} amount={suggestion.insuranceCharge} />
              {suggestion.ancillaries.length > 0 && (
                <>
                  <div className="pt-2 mt-2 border-t border-slate-700 text-xs text-slate-400 uppercase tracking-wider">Ancillaries</div>
                  {suggestion.ancillaries.map((a, i) => (
                    <Row
                      key={i}
                      label={a.description}
                      sub={a.isOneTime ? `One-time × ${a.quantity}` : `AED ${a.unitCharge}/day × ${a.quantity} × ${suggestion.totalDays}d`}
                      amount={a.totalCharge}
                    />
                  ))}
                </>
              )}
              <Row label="Subtotal" amount={suggestion.subTotal} bold />
              <Row label={`VAT (${suggestion.vatPct}%)`} amount={suggestion.vatAmount} muted />
            </div>
            <div className="mt-3 p-3 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 flex items-center justify-between">
              <span className="text-white font-bold">Total</span>
              <span className="text-white text-xl font-bold">AED {suggestion.totalAmount.toLocaleString()}</span>
            </div>
            <div className="mt-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-xs text-amber-200">
              <span>Refundable security deposit (card pre-auth)</span>
              <span className="font-bold">AED {suggestion.securityDeposit.toLocaleString()}</span>
            </div>
          </div>

          {/* Pricing rationale */}
          <div className="bg-slate-800/50 border border-cyan-500/20 rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-cyan-300 uppercase tracking-wider mb-2">Pricing rationale</h3>
            <p
              dir={isRtl ? 'rtl' : 'ltr'}
              className="text-sm text-slate-300 leading-relaxed"
            >
              {suggestion.pricingRationale}
            </p>
          </div>

          {/* Warnings */}
          {suggestion.warnings.length > 0 && (
            <div className="bg-amber-900/20 border border-amber-500/30 rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-amber-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> Items to confirm with the customer
              </h3>
              <ul className="space-y-1">
                {suggestion.warnings.map((w, i) => (
                  <li key={i} className="text-sm text-amber-100">• {w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button
              onClick={() => { setSuggestion(null); setMeta(null); }}
              className="px-4 py-2 rounded-xl bg-slate-700 text-slate-200 hover:bg-slate-600 text-sm"
            >
              Try another brief
            </button>
            <button
              onClick={applyToNewBooking}
              className="px-6 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-medium hover:opacity-90"
            >
              Use this → Open new booking form
            </button>
          </div>

          <p className="text-xs text-slate-500 italic">
            Co-pilot suggests realistic UAE market rates as a starting point.
            Always verify against current fleet availability and corporate contracts before quoting.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="font-semibold text-white mt-0.5">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function Row({ label, sub, amount, bold, muted }: { label: string; sub?: string; amount: number; bold?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? 'pt-2 mt-2 border-t border-slate-700' : ''}`}>
      <div>
        <div className={`${bold ? 'font-semibold text-white' : muted ? 'text-slate-400' : 'text-slate-300'}`}>{label}</div>
        {sub && <div className="text-xs text-slate-500">{sub}</div>}
      </div>
      <div className={`${bold ? 'font-bold text-white' : muted ? 'text-slate-400' : 'text-slate-200'}`}>
        AED {amount.toLocaleString()}
      </div>
    </div>
  );
}
