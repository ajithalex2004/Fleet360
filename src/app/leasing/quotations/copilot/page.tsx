'use client';

/**
 * AI Quotation Co-pilot — STS contracted differentiator.
 * Type a brief in EN or AR, get a structured quotation suggestion in seconds.
 */

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Sparkles, ChevronLeft, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface SuggestedVehicle {
  vehicleType: string;
  make: string;
  model: string;
  year: number;
  quantity: number;
  monthlyRate: number;
  rationale: string;
}

interface Suggestion {
  leaseType: string;
  durationMonths: number;
  vehicles: SuggestedVehicle[];
  mileageCapPerMonth: number;
  insuranceCost: number;
  maintenanceCost: number;
  driverCost: number;
  insuranceIncluded: boolean;
  maintenanceIncluded: boolean;
  driverIncluded: boolean;
  securityDeposit: number;
  pricingRationale: string;
  detectedLanguage: 'en' | 'ar' | 'mixed';
  confidence: 'low' | 'medium' | 'high';
  warnings: string[];
}

interface CopilotMeta {
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

const EXAMPLES = [
  {
    label: 'B2B fleet (EN)',
    brief:
      'We need 5 SUVs for an oil & gas client in Abu Dhabi for 36 months. Annual mileage cap of 40,000 km per vehicle. Insurance and maintenance bundled. No driver needed. Established corporate, low credit risk.',
  },
  {
    label: 'B2C individual (EN)',
    brief:
      'Personal lease for a Toyota Yaris or similar compact sedan, 12 months, around 25,000 km/year. UAE national, no insurance needed (already have own). Just the vehicle.',
  },
  {
    label: 'Mixed fleet (EN)',
    brief:
      '24-month lease: 2 luxury sedans for executives + 3 pickup trucks for site operations. 36,000 km/year cap each. All bundled (insurance + maintenance). Drivers for the executives only.',
  },
  {
    label: 'Corporate (AR)',
    brief:
      'نحتاج 4 سيارات دفع رباعي لمدة سنتين، 30,000 كيلومتر في السنة لكل سيارة، شركة كبيرة في دبي، شامل التأمين والصيانة، بدون سائق.',
  },
];

const VEHICLE_TYPE_COLORS: Record<string, string> = {
  SEDAN: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  COMPACT: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
  SUV: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  PICKUP: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  TRUCK: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
  VAN: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
  BUS: 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30',
  LUXURY: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30',
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  medium: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  low: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

export default function QuotationCopilotPage() {
  const router = useRouter();
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [meta, setMeta] = useState<CopilotMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (brief.trim().length < 10) {
      setError('Please describe the customer\'s needs in at least one sentence.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuggestion(null);
    setMeta(null);

    try {
      const res = await fetch('/api/leasing/quotations/copilot', {
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

  function applyToNewQuotation() {
    if (!suggestion) return;
    // Redirect to /leasing/quotations with the suggestion as a query-string-encoded
    // payload. The new-quotation form can read ?from=copilot&data=... and prefill.
    const payload = encodeURIComponent(JSON.stringify(suggestion));
    router.push(`/leasing/quotations?from=copilot&data=${payload}`);
  }

  const isRtl = suggestion?.detectedLanguage === 'ar';

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <Link
          href="/leasing/quotations"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-cyan-400"
        >
          <ChevronLeft className="h-3 w-3" /> Back to quotations
        </Link>
        <h1 className="text-3xl font-bold text-white mt-2 flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-violet-400" />
          AI Quotation Co-pilot
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Describe what the customer needs in plain English or Arabic. The co-pilot
          turns it into a structured quotation you can review and tweak.
        </p>
      </div>

      {/* Brief input */}
      <div className="bg-slate-800/50 border border-violet-500/20 rounded-2xl p-6 backdrop-blur-sm">
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Customer brief
        </label>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={5}
          placeholder='e.g. "3 Toyota SUVs for 24 months, ~30,000 km/year, corporate client, bundled insurance and maintenance, no driver."'
          className="w-full px-4 py-3 rounded-xl bg-slate-900/60 border border-slate-700 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none transition resize-none"
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
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            {busy ? 'Generating…' : 'Generate Quotation'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-900/30 border border-rose-700 p-4 text-rose-200 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Suggestion */}
      {suggestion && (
        <div className="space-y-4">
          {/* Header card */}
          <div className="bg-slate-800/50 border border-emerald-500/20 rounded-2xl p-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <span className="text-sm font-semibold text-emerald-300 uppercase tracking-wider">
                  Suggestion ready
                </span>
              </div>
              <div className="flex gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${CONFIDENCE_COLORS[suggestion.confidence]}`}>
                  {suggestion.confidence} confidence
                </span>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700 text-slate-300 border border-slate-600">
                  {suggestion.detectedLanguage.toUpperCase()}
                </span>
                {meta && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700/50 text-slate-400 border border-slate-700">
                    {meta.durationMs}ms · {meta.promptTokens + meta.completionTokens} tokens
                  </span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              <Stat label="Lease Type" value={suggestion.leaseType.replace('_', ' ')} />
              <Stat label="Duration" value={`${suggestion.durationMonths} months`} />
              <Stat label="Mileage Cap" value={`${suggestion.mileageCapPerMonth.toLocaleString()} km/mo`} />
              <Stat label="Security Deposit" value={`AED ${suggestion.securityDeposit.toLocaleString()}`} />
            </div>
          </div>

          {/* Vehicles */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
              Suggested vehicles ({suggestion.vehicles.length})
            </h3>
            <div className="space-y-3">
              {suggestion.vehicles.map((v, i) => (
                <div key={i} className="rounded-xl bg-slate-900/40 border border-slate-700 p-4">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${VEHICLE_TYPE_COLORS[v.vehicleType] ?? 'bg-slate-700 text-slate-300 border-slate-600'}`}>
                          {v.vehicleType}
                        </span>
                        <span className="font-semibold text-white">
                          {v.quantity} × {v.make} {v.model} ({v.year})
                        </span>
                      </div>
                      <p
                        dir={isRtl ? 'rtl' : 'ltr'}
                        className="text-sm text-slate-400 mt-2"
                      >
                        {v.rationale}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-400">Monthly rate</div>
                      <div className="text-lg font-bold text-white">
                        AED {v.monthlyRate.toLocaleString()}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        AED {(v.monthlyRate * v.quantity).toLocaleString()} total/mo
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bundled services */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
              Bundled services
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <BundleCard label="Insurance" included={suggestion.insuranceIncluded} cost={suggestion.insuranceCost} />
              <BundleCard label="Maintenance" included={suggestion.maintenanceIncluded} cost={suggestion.maintenanceCost} />
              <BundleCard label="Driver" included={suggestion.driverIncluded} cost={suggestion.driverCost} />
            </div>
          </div>

          {/* Pricing rationale */}
          <div className="bg-slate-800/50 border border-cyan-500/20 rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-cyan-300 uppercase tracking-wider mb-2">
              Pricing rationale
            </h3>
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

          {/* CTA */}
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => { setSuggestion(null); setMeta(null); }}
              className="px-4 py-2 rounded-xl bg-slate-700 text-slate-200 hover:bg-slate-600 text-sm"
            >
              Try another brief
            </button>
            <button
              onClick={applyToNewQuotation}
              className="px-6 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-medium hover:opacity-90"
            >
              Use this → Open new quotation form
            </button>
          </div>

          <p className="text-xs text-slate-500 italic">
            The Co-pilot suggests realistic UAE market rates as a starting point. Always
            review pricing against current vendor agreements and customer credit terms
            before sending.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="font-semibold text-white mt-0.5">{value}</div>
    </div>
  );
}

function BundleCard({ label, included, cost }: { label: string; included: boolean; cost: number }) {
  return (
    <div
      className={`p-4 rounded-xl border ${
        included
          ? 'bg-emerald-500/10 border-emerald-500/30'
          : 'bg-slate-700/30 border-slate-700'
      }`}
    >
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`font-semibold mt-0.5 ${included ? 'text-emerald-300' : 'text-slate-500'}`}>
        {included ? `AED ${cost.toLocaleString()}/mo` : 'Not included'}
      </div>
    </div>
  );
}
