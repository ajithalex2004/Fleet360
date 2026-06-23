/**
 * Live preview of accessorial charges that would auto-apply to a shipment.
 *
 * Pair with <ContractedRateLookup>: that one shows the base + fuel from
 * the contract; this one shows the extras — customs, multi-drop, weight
 * handling, hazmat, etc. — that the rule engine will tack on at booking.
 *
 * Why both: operators consistently underquote because they remember the
 * rate-card lane price but forget the surcharges. Showing them next to
 * each other on the form is the cheapest UX fix for that.
 *
 * The component is presentational: debounced POST to
 * /api/logistics/accessorials/preview, render the result. No state
 * outside the effect, no auth handling.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface AppliedAccessorial {
  catalogId: string;
  code: string;
  name: string;
  chargeType: string | null;
  amount: number;
  currency: string;
  taxable: boolean;
  reason: string;
}

interface PreviewResponse {
  applied: AppliedAccessorial[];
  subtotal: number;
  currency: string;
}

export interface AccessorialPreviewPanelProps {
  /** Pass these straight from the shipment-create form. */
  baseRate?: number | null;
  subtotal?: number | null;
  cargoValue?: number | null;
  distanceKm?: number | null;
  weightKg?: number | null;
  stopsCount?: number | null;
  vehicleType?: string | null;
  shipmentType?: string | null;
  isHazmat?: boolean;
  requiresCustoms?: boolean;
  originCountry?: string | null;
  destinationCountry?: string | null;
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch;
}

function fmt(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AccessorialPreviewPanel(props: AccessorialPreviewPanelProps) {
  const [result, setResult] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable key for the debounced effect — re-run only when an actual input changes.
  const inputKey = JSON.stringify({
    b: props.baseRate, s: props.subtotal, cv: props.cargoValue,
    d: props.distanceKm, w: props.weightKg, st: props.stopsCount,
    v: props.vehicleType, sht: props.shipmentType,
    h: props.isHazmat, c: props.requiresCustoms,
    oc: props.originCountry, dc: props.destinationCountry,
  });

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const f = props.fetchImpl ?? fetch;
        const res = await f('/api/logistics/accessorials/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseRate: props.baseRate ?? null,
            subtotal: props.subtotal ?? null,
            cargoValue: props.cargoValue ?? null,
            distanceKm: props.distanceKm ?? null,
            weightKg: props.weightKg ?? null,
            stopsCount: props.stopsCount ?? null,
            vehicleType: props.vehicleType ?? null,
            shipmentType: props.shipmentType ?? null,
            isHazmat: props.isHazmat ?? false,
            requiresCustoms: props.requiresCustoms ?? false,
            originCountry: props.originCountry ?? null,
            destinationCountry: props.destinationCountry ?? null,
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `HTTP ${res.status}`);
        }
        setResult(await res.json() as PreviewResponse);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Preview failed');
        setResult(null);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [inputKey, props.fetchImpl]);

  if (loading && !result) {
    return (
      <div className="rounded-xl border border-white/10 bg-slate-900/50 px-5 py-4 text-sm text-slate-400 animate-pulse">
        Computing accessorials…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-300">
        Accessorial preview failed: {error}
      </div>
    );
  }

  if (!result) return null;

  if (result.applied.length === 0) {
    return (
      <div className="rounded-xl border border-white/5 bg-slate-900/30 px-5 py-4 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-slate-300 font-medium">No auto-applied accessorials</div>
            <div className="text-slate-500 text-xs mt-0.5">
              The active catalog has no rules that fire on this shipment. Add or edit rules
              in <Link href="/logistics/accessorials" className="text-amber-300 hover:text-amber-200">Accessorials</Link>.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-5 py-4 text-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-sky-300/70">Auto-applied accessorials</div>
          <div className="text-sky-100 text-xs mt-0.5">
            {result.applied.length} rule{result.applied.length === 1 ? '' : 's'} will fire at booking
          </div>
        </div>
      </div>

      <ul className="space-y-1.5">
        {result.applied.map(a => (
          <li key={a.catalogId} className="flex items-start justify-between gap-3 text-sky-100">
            <div className="min-w-0">
              <div className="font-medium truncate">{a.name}</div>
              <div className="text-xs text-sky-300/70 truncate">
                {a.code}
                {a.chargeType && a.chargeType !== a.code ? ` · ${a.chargeType}` : ''}
                {' · '}{a.reason}
                {!a.taxable && ' · tax-exempt'}
              </div>
            </div>
            <span className="font-mono whitespace-nowrap">{fmt(a.amount, a.currency)}</span>
          </li>
        ))}
      </ul>

      <div className="flex justify-between pt-2 mt-3 border-t border-sky-500/20 font-semibold text-sky-100">
        <span>Accessorials subtotal</span>
        <span className="font-mono">{fmt(result.subtotal, result.currency)}</span>
      </div>
    </div>
  );
}
