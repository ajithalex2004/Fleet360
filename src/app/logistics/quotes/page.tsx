'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  combineMasterOptions,
  LogisticsMessage,
  masterLabel,
  masterValue,
  readLogisticsApiError,
  type LogisticsApiError,
  useLogisticsMasterData,
  type LogisticsMasterDataItem,
} from '@/components/logistics/master-data-fields';
import ContractedRateLookup from '@/components/logistics/ContractedRateLookup';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FreightCalc {
  baseFreight:      number;
  fuelSurcharge:    number;
  urgencySurcharge: number;
  hazmatSurcharge:  number;
  insuranceFee:     number;
  customsFee:       number;
  totalAED:         number;
  breakdown:        { label: string; amount: number }[];
}

interface Quote {
  id: string;
  quote_no: string;
  customer_name: string | null;
  customer_email: string | null;
  origin: string | null;
  destination: string | null;
  distance_km: number | null;
  weight_tonnes: number | null;
  shipment_type: string | null;
  total_aed: number | null;
  status: string;
  valid_days: number;
  booking_id: string | null;
  created_at: string;
}

const SHIPMENT_TYPES = ['FTL','LTL','FCL','LCL','REEFER','SPECIAL'];
const VEHICLE_TYPES  = [
  'Any Available', 'Small Van (< 1 ton)', 'Medium Van (1–3 ton)',
  'Light Truck (3–7 ton)', 'Heavy Truck (7–20 ton)',
  'Flatbed / Low-bed', 'Tanker', 'Reefer Truck',
];

const DEFAULT_VEHICLE_TYPE_OPTIONS: LogisticsMasterDataItem[] = VEHICLE_TYPES.map((label, index) => ({
  id: `quote-vehicle-type-${index}`,
  type: 'VEHICLE_TYPE',
  code: label.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
  label,
  status: 'ACTIVE',
}));

const STATUS_BADGE: Record<string, string> = {
  DRAFT:    'bg-slate-500/20 text-slate-400 border-slate-500/30',
  SENT:     'bg-blue-500/20 text-blue-400 border-blue-500/30',
  ACCEPTED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  REJECTED: 'bg-red-500/20 text-red-400 border-red-500/30',
  EXPIRED:  'bg-orange-500/20 text-orange-400 border-orange-500/30',
  BOOKED:   'bg-teal-500/20 text-teal-400 border-teal-500/30',
};

function fmt(n: number) { return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 0 })}`; }

// ── Quote Calculator ──────────────────────────────────────────────────────────

function QuoteCalculator({ onSaved }: { onSaved: () => void }) {
  const masterData = useLogisticsMasterData(['CUSTOMER', 'SHIPPER', 'PICKUP_LOCATION', 'AIRPORT', 'COUNTRY', 'SERVICE_TYPE', 'VEHICLE_TYPE']);
  const [form, setForm] = useState({
    customerName:       '',
    customerEmail:      '',
    customerPhone:      '',
    origin:             '',
    destination:        '',
    distanceKm:         '',
    weightTonnes:       '',
    shipmentType:       'FTL',
    vehicleType:        'Any Available',
    cargoDesc:          '',
    cargoValueAED:      '',
    isUrgent:           false,
    isHazmat:           false,
    requiresInsurance:  false,
    requiresCustoms:    false,
    validDays:          '7',
    notes:              '',
  });

  const [calc,   setCalc]   = useState<FreightCalc | null>(null);
  const [saving, setSaving] = useState(false);
  const [calcing, setCalcing] = useState(false);
  const [error,  setError]  = useState('');
  const [apiError, setApiError] = useState<LogisticsApiError | null>(null);
  const [saved,  setSaved]  = useState('');
  const customerOptions = combineMasterOptions(masterData.optionsFor('CUSTOMER'), masterData.optionsFor('SHIPPER'));
  const locationOptions = combineMasterOptions(masterData.optionsFor('PICKUP_LOCATION'), masterData.optionsFor('AIRPORT'), masterData.optionsFor('COUNTRY'));
  const serviceTypeOptions = masterData.optionsFor('SERVICE_TYPE');
  const vehicleTypeOptions = masterData.optionsFor('VEHICLE_TYPE').length
    ? masterData.optionsFor('VEHICLE_TYPE')
    : DEFAULT_VEHICLE_TYPE_OPTIONS;

  const set = (k: string, v: string | boolean) =>
    setForm(p => ({ ...p, [k]: v }));

  const handleCalculate = async () => {
    if (!form.distanceKm || !form.weightTonnes) {
      setError('Distance and weight are required'); return;
    }
    setCalcing(true); setError(''); setApiError(null); setCalc(null);
    try {
      const res = await fetch('/api/logistics/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'calculate',
          distanceKm:        parseFloat(form.distanceKm),
          weightTonnes:      parseFloat(form.weightTonnes),
          shipmentType:      form.shipmentType,
          vehicleType:       form.vehicleType,
          cargoValueAED:     form.cargoValueAED ? parseFloat(form.cargoValueAED) : 0,
          isUrgent:          form.isUrgent,
          isHazmat:          form.isHazmat,
          requiresInsurance: form.requiresInsurance,
          requiresCustoms:   form.requiresCustoms,
        }),
      });
      if (!res.ok) {
        const parsed = await readLogisticsApiError(res);
        setApiError(parsed);
        throw new Error(parsed.message);
      }
      setCalc(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Calculation failed');
    } finally { setCalcing(false); }
  };

  const handleSave = async () => {
    if (!calc) return;
    setSaving(true); setError(''); setApiError(null);
    try {
      const res = await fetch('/api/logistics/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          distanceKm:       parseFloat(form.distanceKm),
          weightTonnes:     parseFloat(form.weightTonnes),
          cargoValueAED:    form.cargoValueAED ? parseFloat(form.cargoValueAED) : 0,
          validDays:        parseInt(form.validDays),
        }),
      });
      if (!res.ok) {
        const parsed = await readLogisticsApiError(res);
        setApiError(parsed);
        throw new Error(parsed.message);
      }
      const data = await res.json();
      setSaved(data.quoteNo);
      setCalc(null);
      setForm(p => ({ ...p, customerName: '', customerEmail: '', origin: '', destination: '',
        distanceKm: '', weightTonnes: '', cargoDesc: '' }));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      {saved && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-5 py-3 text-emerald-400 text-sm flex items-center justify-between">
          <span>✅ Quote <span className="font-mono font-bold">{saved}</span> saved successfully</span>
          <button onClick={() => setSaved('')} className="text-emerald-600 hover:text-emerald-400">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Left: Input form ──── */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-white">Customer & Route</h2>
          <div className="hidden grid-cols-2 gap-3">
            {[
              { k: 'customerName',  l: 'Customer Name',   p: 'Company or contact name', span: true },
              { k: 'customerEmail', l: 'Email',           p: 'customer@company.com' },
              { k: 'customerPhone', l: 'Phone',           p: '+971 50 000 0000' },
              { k: 'origin',        l: 'Origin',          p: 'Pickup / warehouse', span: true },
              { k: 'destination',   l: 'Destination',     p: 'Delivery address',   span: true },
            ].map(f => (
              <div key={f.k} className={f.span ? 'col-span-2' : ''}>
                <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">{f.l}</label>
                <input value={form[f.k as keyof typeof form] as string}
                  onChange={e => set(f.k, e.target.value)} placeholder={f.p}
                  className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Customer / Shipper</label>
              <select value={form.customerName} onChange={e => set('customerName', e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40">
                <option value="">{masterData.loading ? 'Loading customers...' : 'Select customer / shipper'}</option>
                {customerOptions.map(item => <option key={`${item.type}-${item.code}`} value={masterValue(item)}>{masterLabel(item)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Email</label>
              <input value={form.customerEmail} onChange={e => set('customerEmail', e.target.value)} placeholder="customer@company.com"
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
            </div>
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Phone</label>
              <input value={form.customerPhone} onChange={e => set('customerPhone', e.target.value)} placeholder="+971 50 000 0000"
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
            </div>
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Origin</label>
              <select value={form.origin} onChange={e => set('origin', e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40">
                <option value="">Select origin</option>
                {locationOptions.map(item => <option key={`origin-${item.type}-${item.code}`} value={masterValue(item)}>{masterLabel(item)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Destination</label>
              <select value={form.destination} onChange={e => set('destination', e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40">
                <option value="">Select destination</option>
                {locationOptions.map(item => <option key={`destination-${item.type}-${item.code}`} value={masterValue(item)}>{masterLabel(item)}</option>)}
              </select>
            </div>
          </div>

          {/* Live contracted-rate preview — fires as soon as origin/destination are picked.
              Shown alongside the freeform calculator so operators can compare the
              ad-hoc quote against the contracted baseline before saving. */}
          <ContractedRateLookup
            origin={form.origin}
            destination={form.destination}
            vehicleType={form.vehicleType}
            serviceLevel={form.shipmentType}
          />

          <h2 className="text-sm font-semibold text-white pt-2">Shipment Details</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Distance (km) *</label>
              <input type="number" value={form.distanceKm} onChange={e => set('distanceKm', e.target.value)}
                placeholder="250"
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
            </div>
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Weight (tonnes) *</label>
              <input type="number" value={form.weightTonnes} onChange={e => set('weightTonnes', e.target.value)}
                placeholder="5.0" step="0.1"
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
            </div>
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Shipment Type *</label>
              <select value={form.shipmentType} onChange={e => set('shipmentType', e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40">
                {(serviceTypeOptions.length ? serviceTypeOptions : SHIPMENT_TYPES.map(code => ({ id: code, type: 'SERVICE_TYPE', code, label: code, status: 'ACTIVE' }))).map(item => (
                  <option key={`${item.type}-${item.code}`} value={item.code}>{masterLabel(item)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Vehicle Type</label>
              <select value={form.vehicleType} onChange={e => set('vehicleType', e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40">
                {vehicleTypeOptions.map(item => <option key={`${item.type}-${item.id}`} value={masterValue(item)}>{masterLabel(item)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Cargo Value (AED)</label>
              <input type="number" value={form.cargoValueAED} onChange={e => set('cargoValueAED', e.target.value)}
                placeholder="50000"
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
            </div>
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Valid (days)</label>
              <input type="number" value={form.validDays} onChange={e => set('validDays', e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40" />
            </div>
          </div>

          {/* Toggles */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { k: 'isUrgent',           l: '⚡ Urgent (+25%)' },
              { k: 'isHazmat',           l: '⚠️ Hazmat (+30%)' },
              { k: 'requiresInsurance',  l: '🛡️ Cargo Insurance' },
              { k: 'requiresCustoms',    l: '🛃 Customs Clearance' },
            ].map(t => (
              <label key={t.k}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-colors text-xs ${
                  form[t.k as keyof typeof form]
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    : 'border-white/10 text-slate-400 hover:border-white/20'
                }`}>
                <input type="checkbox" checked={!!form[t.k as keyof typeof form]}
                  onChange={e => set(t.k, e.target.checked)} className="sr-only" />
                <span className={`w-3 h-3 rounded border flex-shrink-0 flex items-center justify-center text-xs ${
                  form[t.k as keyof typeof form] ? 'border-amber-400 bg-amber-500' : 'border-slate-600'
                }`}>{form[t.k as keyof typeof form] ? '✓' : ''}</span>
                {t.l}
              </label>
            ))}
          </div>

          {masterData.error && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5 text-amber-200 text-xs">{masterData.error}</div>
          )}

          {apiError && (
            <LogisticsMessage
              type="error"
              title="Quote validation failed"
              message={apiError.message}
              issues={apiError.issues}
              warnings={apiError.warnings}
            />
          )}

          {!apiError && error && (
            <LogisticsMessage type="error" title="Quote action failed" message={error} />
          )}

          {false && error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5 text-red-400 text-xs">⚠️ {error}</div>
          )}

          <button onClick={handleCalculate} disabled={calcing}
            className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-bold text-sm transition-colors disabled:opacity-40">
            {calcing ? '⏳ Calculating…' : '🧮 Calculate Freight Cost'}
          </button>
        </div>

        {/* ── Right: Cost breakdown ──── */}
        <div>
          {!calc ? (
            <div className="h-full flex items-center justify-center border border-dashed border-white/10 rounded-2xl">
              <div className="text-center text-slate-600">
                <div className="text-5xl mb-3">💰</div>
                <p className="text-sm">Fill in shipment details and click Calculate</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Total */}
              <div className="bg-gradient-to-br from-amber-500/20 to-orange-500/10 border border-amber-500/30 rounded-2xl p-6 text-center">
                <p className="text-slate-400 text-xs uppercase tracking-wider mb-2">Total Freight Cost</p>
                <p className="text-4xl font-bold text-amber-400">{fmt(calc.totalAED)}</p>
                <p className="text-slate-500 text-xs mt-2">
                  {form.distanceKm} km · {form.weightTonnes} t · {form.shipmentType}
                </p>
              </div>

              {/* Breakdown */}
              <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 space-y-2">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Cost Breakdown</h3>
                {calc.breakdown.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className={`text-slate-300 ${i === calc.breakdown.length - 1 ? 'font-semibold text-white' : ''}`}>
                      {item.label}
                    </span>
                    <span className={`font-mono ${i === calc.breakdown.length - 1 ? 'text-amber-400 font-bold' : 'text-slate-400'}`}>
                      {fmt(item.amount)}
                    </span>
                  </div>
                ))}
                <div className="border-t border-white/10 pt-2 flex items-center justify-between text-sm font-bold">
                  <span className="text-white">Total</span>
                  <span className="text-amber-400 font-mono text-lg">{fmt(calc.totalAED)}</span>
                </div>
              </div>

              {/* Rate info */}
              <div className="bg-slate-800/40 border border-white/5 rounded-xl p-3 text-xs text-slate-500 space-y-1">
                <p>📏 Cost per km: <span className="text-slate-300">{fmt(Math.round(calc.totalAED / parseFloat(form.distanceKm || '1')))}</span></p>
                <p>⚖️ Cost per tonne: <span className="text-slate-300">{fmt(Math.round(calc.totalAED / parseFloat(form.weightTonnes || '1')))}</span></p>
                <p className="text-slate-600 mt-1">*Rates include 8% fuel surcharge. Final pricing subject to confirmation.</p>
              </div>

              {/* Save quote button */}
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setCalc(null)}
                  className="py-2.5 rounded-xl border border-white/10 text-slate-300 text-sm hover:bg-slate-800 transition-colors">
                  Recalculate
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold text-sm transition-colors disabled:opacity-40">
                  {saving ? 'Saving…' : '💾 Save Quote'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Quotes List ───────────────────────────────────────────────────────────────

function QuotesList({ quotes, loading }: { quotes: Quote[]; loading: boolean }) {
  if (loading) {
    return <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-slate-800/60 rounded-xl animate-pulse" />)}</div>;
  }
  if (!quotes.length) {
    return (
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-10 text-center">
        <div className="text-4xl mb-3">📋</div>
        <p className="text-slate-400 text-sm">No quotes yet — create your first quote above</p>
      </div>
    );
  }
  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm min-w-[700px]">
        <thead>
          <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
            <th className="text-left px-5 py-3">Quote No.</th>
            <th className="text-left px-4 py-3">Customer</th>
            <th className="text-left px-4 py-3">Route</th>
            <th className="text-left px-4 py-3">Type</th>
            <th className="text-right px-4 py-3">Total (AED)</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-left px-4 py-3">Date</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map(q => (
            <tr key={q.id} className="border-b border-white/5 last:border-0 hover:bg-slate-800/40 transition-colors">
              <td className="px-5 py-3 font-mono text-xs text-white">{q.quote_no}</td>
              <td className="px-4 py-3 text-slate-300 text-xs">{q.customer_name ?? '—'}</td>
              <td className="px-4 py-3 text-slate-400 text-xs truncate max-w-xs">
                {q.origin && q.destination ? `${q.origin} → ${q.destination}` : q.origin ?? q.destination ?? '—'}
              </td>
              <td className="px-4 py-3">
                {q.shipment_type && (
                  <span className="px-1.5 py-0.5 rounded text-xs font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20">
                    {q.shipment_type}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right font-mono text-sm text-amber-400 font-bold">
                {q.total_aed != null ? q.total_aed.toLocaleString('en-AE') : '—'}
              </td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[q.status] ?? STATUS_BADGE.DRAFT}`}>
                  {q.status}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-500 text-xs">
                {new Date(q.created_at).toLocaleDateString('en-AE')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LogisticsQuotesPage() {
  const [quotes,  setQuotes]  = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState<'calculator' | 'list'>('calculator');

  const loadQuotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/logistics/quotes', { cache: 'no-store' });
      if (res.ok) setQuotes(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadQuotes(); }, [loadQuotes]);

  const totalQuotedAED = quotes.reduce((s, q) => s + (q.total_aed ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Freight Quotes</h1>
          <p className="text-slate-400 text-sm mt-0.5">Calculate, save, and manage logistics freight quotations</p>
        </div>
        <div className="flex items-center gap-3">
          {quotes.length > 0 && (
            <div className="text-xs text-slate-400 bg-slate-800 border border-white/10 px-3 py-1.5 rounded-lg">
              {quotes.length} quotes · <span className="text-amber-400">{fmt(Math.round(totalQuotedAED))}</span> total
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {(['calculator', 'list'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
              tab === t
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                : 'text-slate-400 border-white/10 hover:border-white/20 hover:text-white'
            }`}>
            {t === 'calculator' ? '🧮 New Quote' : `📋 All Quotes (${quotes.length})`}
          </button>
        ))}
      </div>

      {tab === 'calculator' ? (
        <QuoteCalculator onSaved={() => { loadQuotes(); setTab('list'); }} />
      ) : (
        <QuotesList quotes={quotes} loading={loading} />
      )}
    </div>
  );
}
