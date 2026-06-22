/**
 * Live preview of the contracted rate for a lane.
 *
 * Drops into any form that captures origin / destination / vehicle type and
 * makes the operator see the matching rate-contract quote before they hit
 * save. The whole point is to surface margin breaches (operator about to
 * quote below contract) and "no contract" gaps (operator quoting an
 * unmanaged lane) at decision time, not in next quarter's audit.
 *
 * Mechanics:
 *   - debounced POST to /api/logistics/rates/quote when the four inputs
 *     change (300ms — enough to absorb keystrokes, fast enough to feel live)
 *   - renders the QuoteShipmentResult with a breakdown + an "apply this
 *     rate" button that calls onApply with the total
 *   - on miss: shows the reason + a link to /logistics/rate-contracts so
 *     the operator can fix the gap on the spot
 *
 * The component is presentational — no global state, no router knowledge
 * beyond the link, no auth handling (the API does that). Drop it anywhere.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface QuoteResult {
  matched: boolean;
  reason: 'matched' | 'no-lane-match' | 'no-active-contract' | 'no-vehicle-match';
  contractId: string | null;
  contractNo: string | null;
  currency: string;
  baseRate: number;
  fuelSurchargePct: number;
  fuelSurchargeAmount: number;
  minCharge: number;
  minChargeApplied: boolean;
  subtotal: number;
  total: number;
  alternates: Array<{ contractId: string; contractNo: string; score: number; why: string }>;
}

export interface ContractedRateLookupProps {
  origin: string;
  destination: string;
  vehicleType?: string | null;
  serviceLevel?: string | null;
  customerId?: string | null;
  carrierId?: string | null;
  shipmentDate?: string | null;
  /** Called when the operator clicks "Use this rate". Receives the total + currency. */
  onApply?: (args: { total: number; currency: string; contractId: string; contractNo: string }) => void;
  /** Optional fetch override — defaults to global fetch. Useful for tests. */
  fetchImpl?: typeof fetch;
}

const REASON_COPY: Record<QuoteResult['reason'], { title: string; detail: string }> = {
  'matched':             { title: '',                          detail: '' },
  'no-lane-match':       { title: 'No contract for this lane', detail: 'Add a rate contract or quote manually.' },
  'no-active-contract':  { title: 'No active contract',         detail: 'A contract exists for this lane but is outside its effective window.' },
  'no-vehicle-match':    { title: 'Vehicle type not covered',   detail: 'The lane has a contract but not for this vehicle type.' },
};

function fmt(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ContractedRateLookup(props: ContractedRateLookupProps) {
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Wait until both endpoints of the lane are present — partial input
    // produces noise, and shipperPortal/quotes already shows a placeholder.
    if (!props.origin?.trim() || !props.destination?.trim()) {
      setResult(null);
      setError(null);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const f = props.fetchImpl ?? fetch;
        const res = await f('/api/logistics/rates/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origin: props.origin,
            destination: props.destination,
            vehicleType: props.vehicleType ?? null,
            serviceLevel: props.serviceLevel ?? null,
            customerId: props.customerId ?? null,
            carrierId: props.carrierId ?? null,
            shipmentDate: props.shipmentDate ?? null,
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `HTTP ${res.status}`);
        }
        setResult(await res.json() as QuoteResult);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Quote lookup failed');
        setResult(null);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [
    props.origin, props.destination, props.vehicleType, props.serviceLevel,
    props.customerId, props.carrierId, props.shipmentDate, props.fetchImpl,
  ]);

  if (!props.origin?.trim() || !props.destination?.trim()) {
    return (
      <div className="rounded-xl border border-white/5 bg-slate-900/30 px-5 py-4 text-sm text-slate-500">
        Enter pickup and delivery locations to preview the contracted rate.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-slate-900/50 px-5 py-4 text-sm text-slate-400 animate-pulse">
        Looking up contracted rate…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-300">
        Couldn&apos;t fetch contracted rate: {error}
      </div>
    );
  }

  if (!result) return null;

  if (!result.matched) {
    const copy = REASON_COPY[result.reason];
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold text-amber-300">{copy.title}</div>
            <div className="text-amber-200/80 mt-0.5">{copy.detail}</div>
          </div>
          <Link
            href="/logistics/rate-contracts"
            className="text-xs font-medium text-amber-300 hover:text-amber-200 whitespace-nowrap"
          >
            Manage contracts →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-emerald-300/70">Contracted Rate</div>
          <div className="text-emerald-100 font-mono text-xs mt-0.5">
            {result.contractNo}
          </div>
        </div>
        {props.onApply && (
          <button
            type="button"
            onClick={() => props.onApply!({
              total: result.total,
              currency: result.currency,
              contractId: result.contractId!,
              contractNo: result.contractNo!,
            })}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 border border-emerald-500/40"
          >
            Use this rate
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <RateLine label="Base rate" amount={result.baseRate} currency={result.currency} />
        {result.fuelSurchargeAmount > 0 && (
          <RateLine
            label={`Fuel surcharge (${result.fuelSurchargePct}%)`}
            amount={result.fuelSurchargeAmount}
            currency={result.currency}
          />
        )}
        {result.minChargeApplied && (
          <div className="text-xs text-emerald-300/70 italic">
            Subtotal {fmt(result.subtotal, result.currency)} below min charge —
            applying {fmt(result.minCharge, result.currency)}.
          </div>
        )}
        <div className="flex justify-between pt-2 border-t border-emerald-500/20 font-semibold text-emerald-100">
          <span>Total</span>
          <span className="font-mono">{fmt(result.total, result.currency)}</span>
        </div>
      </div>

      {result.alternates.length > 0 && (
        <details className="mt-3 text-xs text-emerald-300/60">
          <summary className="cursor-pointer hover:text-emerald-300">
            {result.alternates.length} other contract{result.alternates.length === 1 ? '' : 's'} also match
          </summary>
          <ul className="mt-2 space-y-1">
            {result.alternates.map(a => (
              <li key={a.contractId} className="font-mono">
                {a.contractNo} <span className="text-emerald-300/40">— score {a.score} ({a.why})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function RateLine({ label, amount, currency }: { label: string; amount: number; currency: string }) {
  return (
    <div className="flex justify-between text-emerald-200/80">
      <span>{label}</span>
      <span className="font-mono">{fmt(amount, currency)}</span>
    </div>
  );
}
