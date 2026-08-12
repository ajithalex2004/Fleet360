'use client';

/**
 * Shipper Portal — new shipment request form.
 *
 * Three sections: Pickup, Delivery, Cargo. Plus a small "Other details"
 * section for priority + vehicle preference + special instructions. The
 * form is intentionally lean — shippers won't fill 30 fields. Operators
 * can enrich whatever's missing in dispatch.
 *
 * Cargo is multi-line: shippers regularly mix line items in one shipment.
 */

import { useState, useEffect, useRef, type ComponentType, type FormEvent, type ReactNode } from 'react';
import {
  ArrowLeft, ArrowRight, MapPin, Package, Plus, Trash2, Send, AlertCircle, Truck,
  Globe2, ShieldAlert,
} from 'lucide-react';
import Link from 'next/link';

// Customs section — only collected for cross-border haulage. HS Code, net/gross
// weights, INCOTERMS, customs value etc. let the operator file customs entry
// without chasing the shipper. Per UAE/GCC freight workflow.
interface CustomsSection {
  cargoType: string;           // FTL | LTL | FCL | LCL | Bulk | Reefer | Project
  hsCode: string;              // 6-10 digits, sometimes hyphenated
  netWeightKg: string;
  grossWeightKg: string;
  customsValue: string;
  customsCurrency: string;
  incoterms: string;           // EXW | FOB | CIF | DDP | …
  originCountry: string;       // country code (e.g. AE)
}
const EMPTY_CUSTOMS: CustomsSection = {
  cargoType: '', hsCode: '', netWeightKg: '', grossWeightKg: '',
  customsValue: '', customsCurrency: 'AED', incoterms: '', originCountry: '',
};

// Hazmat / regulated-goods declaration — INDEPENDENT of haulage (an inland
// chemical truck still legally needs UN Class + MSDS + emergency contact).
interface HazmatSection {
  unNumber: string;            // 4-digit (e.g. "1203" for petrol)
  unClass: string;             // 1..9
  packingGroup: string;        // I | II | III
  emergencyContactName: string;
  emergencyContactPhone: string;
}
const EMPTY_HAZMAT: HazmatSection = {
  unNumber: '', unClass: '', packingGroup: '',
  emergencyContactName: '', emergencyContactPhone: '',
};

type Haulage = 'INLAND' | 'CROSS_BORDER';

interface CargoLine {
  description: string;
  quantity: string;        // string so the input is controllable; converted on submit
  packageType: string;
  weightKg: string;
  isHazmat: boolean;
}

interface PartySection {
  name: string;
  address: string;
  city: string;
  country: string;
  contactName: string;
  contactPhone: string;
  windowFrom: string;      // ISO datetime-local string
  windowTo: string;
  instructions: string;
}

const EMPTY_CARGO: CargoLine = {
  description: '', quantity: '1', packageType: 'Pallet',
  weightKg: '', isHazmat: false,
};

const EMPTY_PARTY: PartySection = {
  name: '', address: '', city: '', country: 'AE',
  contactName: '', contactPhone: '',
  windowFrom: '', windowTo: '',
  instructions: '',
};

export default function NewShipmentPage() {
  const [pickup,   setPickup]   = useState<PartySection>({ ...EMPTY_PARTY });
  const [delivery, setDelivery] = useState<PartySection>({ ...EMPTY_PARTY });
  const [cargoLines, setCargoLines] = useState<CargoLine[]>([{ ...EMPTY_CARGO }]);

  const [priority, setPriority] = useState<'Low' | 'Medium' | 'High'>('Medium');
  const [vehiclePref, setVehiclePref] = useState('');
  const [special, setSpecial] = useState('');

  // Haulage drives the customs section. Default Inland (the SMB-domestic
  // submitter sees no extra fields). HS Code + customs value etc. only
  // activate when the shipper picks Cross-Border.
  const [haulage, setHaulage] = useState<Haulage>('INLAND');
  const [customs, setCustoms] = useState<CustomsSection>({ ...EMPTY_CUSTOMS });
  // Hazmat is its own toggle — even inland hazmat moves need the declaration.
  const [hazmatOn, setHazmatOn] = useState(false);
  const [hazmat, setHazmat] = useState<HazmatSection>({ ...EMPTY_HAZMAT });

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ mode: 'review' | 'book'; requestNo?: string | null; shipmentId?: string | null; shipmentNo?: string | null } | null>(null);
  const [master, setMaster] = useState<Array<{ type: string; code: string; label: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/shipper-portal/master-data');
        if (!cancelled && res.ok) { const d = await res.json(); setMaster(d.data ?? []); }
      } catch { /* governed dropdowns fall back to free text */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const updateCargo = (i: number, p: Partial<CargoLine>) => {
    setCargoLines(prev => prev.map((c, idx) => idx === i ? { ...c, ...p } : c));
  };
  const addCargoLine = () => setCargoLines(prev => [...prev, { ...EMPTY_CARGO }]);
  const removeCargoLine = (i: number) => setCargoLines(prev => prev.filter((_, idx) => idx !== i));

  const totalWeightKg = cargoLines.reduce((sum, line) => {
    const qty = Number(line.quantity || 1);
    const weight = Number(line.weightKg || 0);
    return sum + (Number.isFinite(qty) && Number.isFinite(weight) ? qty * weight : 0);
  }, 0);
  const hasRealCargoWeight = cargoLines.some(c => c.description.trim() !== '' && Number(c.weightKg) > 0);

  // Real rate engine — debounced call to /api/shipper-portal/rates/quote when
  // the inputs that change the price (lane + vehicle + weight) settle. Replaces
  // the old `Math.max(250, weight*1.25)` placeholder; the result is contract-
  // aware and surfaces the spot-market fallback when no contract matches.
  interface RateQuote {
    matched: boolean;
    reason: string;
    estimate?: boolean;
    contractNo: string | null;
    currency: string;
    subtotal: number;
    total: number;
    minChargeApplied: boolean;
  }
  const [rateQuote, setRateQuote]     = useState<RateQuote | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Anchor the lane+vehicle on the request. Origin/destination fall back to
  // city when the location-name picker is empty so the engine can still attempt
  // a lane match (rate contracts are usually keyed off a normalised location).
  const rateOrigin      = pickup.name || pickup.city || '';
  const rateDestination = delivery.name || delivery.city || '';
  const rateVehicle     = vehiclePref;
  const canQuote        = rateOrigin.trim() !== '' && rateDestination.trim() !== '';

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!canQuote) { setRateQuote(null); setRateLoading(false); return; }
    setRateLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/shipper-portal/rates/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origin: rateOrigin,
            destination: rateDestination,
            vehicleType: rateVehicle || null,
            shipmentDate: pickup.windowFrom || null,
            totalWeightKg: totalWeightKg > 0 ? totalWeightKg : null,
          }),
        });
        if (!res.ok) { setRateQuote(null); return; }
        const body = await res.json() as RateQuote;
        setRateQuote(body);
      } catch {
        setRateQuote(null);  // silent fall-through — UI shows "operator will price your load"
      } finally {
        setRateLoading(false);
      }
    }, 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [rateOrigin, rateDestination, rateVehicle, totalWeightKg, pickup.windowFrom, canQuote]);

  // Visible only when there's a useful answer to show. The "matched" path is
  // a real contract; "spot-estimate" is a labelled non-contract estimate.
  const showQuote = canQuote && (rateLoading || rateQuote != null);
  const quoteIsContract = rateQuote?.matched === true && rateQuote?.estimate !== true;
  const quoteIsEstimate = rateQuote?.matched === false || rateQuote?.estimate === true;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErr(null);
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent = submitter?.value === 'book' ? 'book' : 'review';

    if (!pickup.name && !pickup.address) { setErr('Pickup location is required.'); return; }
    if (!delivery.name && !delivery.address) { setErr('Delivery location is required.'); return; }
    if (!cargoLines[0]?.description) { setErr('At least one cargo line with a description is required.'); return; }
    // Cross-Border requires the three customs-clearance gating fields. Inland
    // shipments may still fill them but submission is not blocked.
    if (haulage === 'CROSS_BORDER') {
      if (!customs.hsCode.trim())             { setErr('HS Code is required for cross-border shipments.'); return; }
      if (!customs.incoterms)                 { setErr('INCOTERMS is required for cross-border shipments.'); return; }
      if (customs.customsValue.trim() === '') { setErr('Customs Value is required for cross-border shipments.'); return; }
    }

    // Date-window sanity. datetime-local strings (YYYY-MM-DDTHH:mm) compare
    // lexicographically, so we don't need Date() parsing here. We check all
    // three pairs that can be violated independently.
    if (pickup.windowFrom && pickup.windowTo && pickup.windowTo < pickup.windowFrom) {
      setErr('Pickup window "To" must be on or after "From".'); return;
    }
    if (delivery.windowFrom && delivery.windowTo && delivery.windowTo < delivery.windowFrom) {
      setErr('Delivery window "To" must be on or after "From".'); return;
    }
    if (pickup.windowFrom && delivery.windowFrom && delivery.windowFrom < pickup.windowFrom) {
      setErr('Delivery window cannot start before the pickup window.'); return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/shipper-portal/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickup: {
            name: pickup.name || null,
            address: pickup.address || null,
            city: pickup.city || null,
            country: pickup.country || null,
            contactName: pickup.contactName || null,
            contactPhone: pickup.contactPhone || null,
            windowFrom: pickup.windowFrom || null,
            windowTo: pickup.windowTo || null,
            instructions: pickup.instructions || null,
          },
          delivery: {
            name: delivery.name || null,
            address: delivery.address || null,
            city: delivery.city || null,
            country: delivery.country || null,
            contactName: delivery.contactName || null,
            contactPhone: delivery.contactPhone || null,
            windowFrom: delivery.windowFrom || null,
            windowTo: delivery.windowTo || null,
            instructions: delivery.instructions || null,
          },
          cargoLines: cargoLines.filter(c => c.description.trim()).map(c => ({
            description: c.description.trim(),
            quantity: c.quantity === '' ? null : Number(c.quantity),
            packageType: c.packageType || null,
            weightKg: c.weightKg === '' ? null : Number(c.weightKg),
            isHazmat: c.isHazmat,
          })),
          priority,
          requestedVehicleType: vehiclePref || null,
          specialInstructions: special || null,
          bookingMode: intent,
          // The "Book now" path is currently removed — intent is always 'review'.
          // If it's ever re-introduced, we book at the contracted rate engine's
          // total (NOT a placeholder) so the shipper commits to a real number.
          acceptedQuoteAmount: intent === 'book' ? (quoteIsContract ? rateQuote!.total : null) : null,
          // Haulage + (conditional) customs section. Server stores these on
          // metadata so the operator sees them at review time.
          haulage,
          // Send the cargo-classification object for both Inland and Cross-
          // Border (shipper may fill cargoType/weights/country for Inland too).
          // Cross-Border-gating fields (HS Code, INCOTERMS, Customs Value) are
          // validated above the fetch; for Inland they're just optional.
          customs: {
            cargoType:        customs.cargoType || null,
            hsCode:           customs.hsCode.trim() || null,
            netWeightKg:      customs.netWeightKg === '' ? null : Number(customs.netWeightKg),
            grossWeightKg:    customs.grossWeightKg === '' ? null : Number(customs.grossWeightKg),
            customsValue:     customs.customsValue === '' ? null : Number(customs.customsValue),
            customsCurrency:  customs.customsCurrency || null,
            incoterms:        customs.incoterms || null,
            originCountry:    customs.originCountry || null,
          },
          hazmat: hazmatOn ? {
            unNumber:               hazmat.unNumber.trim() || null,
            unClass:                hazmat.unClass || null,
            packingGroup:           hazmat.packingGroup || null,
            emergencyContactName:   hazmat.emergencyContactName || null,
            emergencyContactPhone:  hazmat.emergencyContactPhone || null,
          } : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data?.error ?? 'Failed to submit'); return; }
      setSubmitted(intent === 'book'
        ? { mode: 'book', shipmentId: data.shipment?.id ?? null, shipmentNo: data.shipment?.shipmentNo ?? null }
        : { mode: 'review', requestNo: data.request?.requestNo ?? null });
    } finally {
      setSubmitting(false);
    }
  };

  const locationOptions = master.filter(m => ['PICKUP_LOCATION', 'COUNTRY', 'AIRPORT'].includes(m.type)).map(m => m.label);
  const vehicleOptions = master.filter(m => m.type === 'VEHICLE_TYPE').map(m => m.label);

  if (submitted) {
    return (
      <div className="max-w-xl mx-auto text-center py-12 space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 mx-auto flex items-center justify-center">
          <Send className="w-7 h-7 text-emerald-300" />
        </div>
        <h1 className="text-xl font-bold text-white">{submitted.mode === 'book' ? 'Shipment booked' : 'Request submitted'}</h1>
        <p className="text-sm text-slate-400">
          {submitted.mode === 'book' ? (
            <>Your shipment{submitted.shipmentNo ? <> <span className="font-mono text-slate-300">{submitted.shipmentNo}</span></> : ''} is now available for tracking.</>
          ) : (
            <>Your shipping request{submitted.requestNo ? <> <span className="font-mono text-slate-300">{submitted.requestNo}</span></> : ''} has been sent to our team for review. Once it is accepted and scheduled, it will appear in your shipments with live status.</>
          )}
        </p>
        <div className="flex items-center justify-center gap-2 pt-2">
          {submitted.mode === 'book' && submitted.shipmentId ? (
            <Link href={`/shipper-portal/shipments/${submitted.shipmentId}`} className="rounded-xl bg-emerald-600 text-white font-medium px-4 py-2.5 text-sm hover:bg-emerald-500">
              Track shipment
            </Link>
          ) : (
            <Link href="/shipper-portal/shipments" className="rounded-xl bg-emerald-600 text-white font-medium px-4 py-2.5 text-sm hover:bg-emerald-500">
              Back to shipments
            </Link>
          )}
          <button type="button" onClick={() => { setSubmitted(null); setPickup({ ...EMPTY_PARTY }); setDelivery({ ...EMPTY_PARTY }); setCargoLines([{ ...EMPTY_CARGO }]); setSpecial(''); setVehiclePref(''); }}
            className="rounded-xl border border-white/10 text-slate-300 px-4 py-2.5 text-sm hover:bg-white/5">
            Submit another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Link href="/shipper-portal/shipments"
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-white">New Shipment Request</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Get a quick quote, book immediately, or send the load for operator review.
          </p>
        </div>
      </div>

      {err && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2.5 text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {err}
        </div>
      )}

      {/* Haulage — drives the customs section below */}
      <Section title="Haulage" icon={Globe2} accent="blue">
        <div className="flex flex-wrap gap-2">
          {([
            { v: 'INLAND',       label: 'Inland',       hint: 'Stays within the country — no customs.' },
            { v: 'CROSS_BORDER', label: 'Cross-Border', hint: 'Crosses a national border — customs clearance required.' },
          ] as const).map(opt => {
            const on = haulage === opt.v;
            return (
              <button key={opt.v} type="button" onClick={() => setHaulage(opt.v)}
                className={`flex-1 min-w-[180px] text-left rounded-lg border px-3 py-2.5 transition-colors ${on
                  ? 'border-blue-500/50 bg-blue-500/10 ring-1 ring-blue-500/30'
                  : 'border-white/10 bg-slate-800/40 hover:bg-slate-800/60'}`}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <span className={`w-3 h-3 rounded-full border ${on ? 'border-blue-400 bg-blue-400' : 'border-slate-500'}`} />
                  {opt.label}
                </div>
                <p className="text-[11px] text-slate-400 mt-1 ml-5">{opt.hint}</p>
              </button>
            );
          })}
        </div>

        {/* Cargo classification — shown for BOTH Inland and Cross-Border.
            HS Code, INCOTERMS and Customs Value are marked required only when
            Cross-Border (those are the customs-clearance gating fields). All
            other fields stay optional regardless of haulage. */}
        <div className="mt-3 rounded-lg border border-blue-500/20 bg-blue-500/[0.04] p-3 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Cargo type">
                <select value={customs.cargoType} onChange={e => setCustoms({ ...customs, cargoType: e.target.value })}
                  className={inputClass()}>
                  <option value="">Select…</option>
                  <option>FTL — Full Truck Load</option>
                  <option>LTL — Less than Truck Load</option>
                  <option>FCL — Full Container Load</option>
                  <option>LCL — Less than Container Load</option>
                  <option>Bulk</option>
                  <option>Reefer</option>
                  <option>Project / Heavy lift</option>
                </select>
              </Field>
              <Field label="HS Code" hint="Customs tariff code, e.g. 8517.12" required={haulage === 'CROSS_BORDER'}>
                <input value={customs.hsCode}
                  onChange={e => setCustoms({ ...customs, hsCode: e.target.value })}
                  placeholder="e.g. 8517.12"
                  className={inputClass()} />
              </Field>
              <Field label="Country of origin">
                <select value={customs.originCountry}
                  onChange={e => setCustoms({ ...customs, originCountry: e.target.value })}
                  className={inputClass()}>
                  <option value="">Select…</option>
                  <option value="AE">United Arab Emirates</option>
                  <option value="SA">Saudi Arabia</option>
                  <option value="OM">Oman</option>
                  <option value="QA">Qatar</option>
                  <option value="BH">Bahrain</option>
                  <option value="KW">Kuwait</option>
                  <option value="IN">India</option>
                  <option value="CN">China</option>
                  <option value="US">United States</option>
                  <option value="GB">United Kingdom</option>
                  <option value="DE">Germany</option>
                </select>
              </Field>
              <Field label="Net weight (kg)" hint="Cargo only — used for duty calculation">
                <input type="number" min={0} step={0.01} value={customs.netWeightKg}
                  onChange={e => setCustoms({ ...customs, netWeightKg: e.target.value })}
                  className={inputClass()} />
              </Field>
              <Field label="Gross weight (kg)" hint="Cargo + packaging — used for freight cost">
                <input type="number" min={0} step={0.01} value={customs.grossWeightKg}
                  onChange={e => setCustoms({ ...customs, grossWeightKg: e.target.value })}
                  className={inputClass()} />
              </Field>
              <Field label="INCOTERMS" required={haulage === 'CROSS_BORDER'}>
                <select value={customs.incoterms}
                  onChange={e => setCustoms({ ...customs, incoterms: e.target.value })}
                  className={inputClass()}>
                  <option value="">Select…</option>
                  <option>EXW — Ex Works</option>
                  <option>FCA — Free Carrier</option>
                  <option>FOB — Free On Board</option>
                  <option>CIF — Cost, Insurance & Freight</option>
                  <option>CIP — Carriage & Insurance Paid To</option>
                  <option>DAP — Delivered At Place</option>
                  <option>DPU — Delivered at Place Unloaded</option>
                  <option>DDP — Delivered Duty Paid</option>
                </select>
              </Field>
              <Field label="Customs value" required={haulage === 'CROSS_BORDER'}>
                <input type="number" min={0} step={0.01} value={customs.customsValue}
                  onChange={e => setCustoms({ ...customs, customsValue: e.target.value })}
                  className={inputClass()} />
              </Field>
              <Field label="Currency">
                <select value={customs.customsCurrency}
                  onChange={e => setCustoms({ ...customs, customsCurrency: e.target.value })}
                  className={inputClass()}>
                  <option>AED</option>
                  <option>USD</option>
                  <option>EUR</option>
                  <option>GBP</option>
                  <option>INR</option>
                  <option>SAR</option>
                </select>
              </Field>
            </div>
            {haulage === 'CROSS_BORDER' && (
              <p className="text-[11px] text-slate-500 italic">
                Customs documents (Commercial Invoice, Packing List, Certificate of Origin) can be attached after submission from your Shipments page.
              </p>
            )}
          </div>
      </Section>

      {/* Cargo */}
      <Section title="Cargo" icon={Package} accent="amber">
        <div className="space-y-2">
          {cargoLines.map((c, i) => (
            <div key={i} className="bg-slate-800/50 border border-white/10 rounded-lg p-3 space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_100px_120px_100px_auto] gap-2 items-end">
                <Field label="Description" required>
                  <input value={c.description}
                    onChange={e => updateCargo(i, { description: e.target.value })}
                    placeholder="e.g. Electronics, dry goods"
                    className={inputClass()} />
                </Field>
                <Field label="Qty">
                  <input type="number" min={1} step={1} value={c.quantity}
                    onChange={e => updateCargo(i, { quantity: e.target.value })}
                    className={inputClass()} />
                </Field>
                <Field label="Package">
                  <select value={c.packageType}
                    onChange={e => updateCargo(i, { packageType: e.target.value })}
                    className={inputClass()}>
                    <option>Pallet</option>
                    <option>Carton</option>
                    <option>Drum</option>
                    <option>Crate</option>
                    <option>Container</option>
                    <option>Bag</option>
                    <option>Other</option>
                  </select>
                </Field>
                <Field label="Weight/unit (kg)">
                  <input type="number" min={0} step={0.5} value={c.weightKg}
                    onChange={e => updateCargo(i, { weightKg: e.target.value })}
                    placeholder="0"
                    className={inputClass()} />
                </Field>
                <button type="button" onClick={() => removeCargoLine(i)} disabled={cargoLines.length === 1}
                  className="p-2 rounded-lg text-rose-300 hover:bg-rose-500/10 disabled:opacity-30 disabled:cursor-not-allowed self-end">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input type="checkbox" checked={c.isHazmat}
                  onChange={e => updateCargo(i, { isHazmat: e.target.checked })}
                  className="w-3.5 h-3.5 accent-amber-500 rounded" />
                Hazmat cargo (operator may apply surcharge)
              </label>
            </div>
          ))}
          <button type="button" onClick={addCargoLine}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-200 text-xs">
            <Plus className="w-3.5 h-3.5" /> Add cargo line
          </button>
        </div>
      </Section>

      {/* Hazardous / regulated goods — INDEPENDENT of haulage. Inland DG moves still need this. */}
      <Section title="Hazardous or regulated goods" icon={ShieldAlert} accent="amber">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={hazmatOn}
            onChange={e => setHazmatOn(e.target.checked)}
            className="w-4 h-4 accent-amber-500 rounded" />
          <span className="text-sm text-slate-200">This shipment includes hazardous or regulated cargo</span>
        </label>

        {hazmatOn && (
          <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="UN Number" hint="4-digit code, e.g. 1203 (petrol)">
                <input value={hazmat.unNumber}
                  onChange={e => setHazmat({ ...hazmat, unNumber: e.target.value })}
                  placeholder="e.g. 1203"
                  className={inputClass()} />
              </Field>
              <Field label="UN Class">
                <select value={hazmat.unClass}
                  onChange={e => setHazmat({ ...hazmat, unClass: e.target.value })}
                  className={inputClass()}>
                  <option value="">Select…</option>
                  <option value="1">Class 1 — Explosives</option>
                  <option value="2">Class 2 — Gases</option>
                  <option value="3">Class 3 — Flammable liquids</option>
                  <option value="4">Class 4 — Flammable solids</option>
                  <option value="5">Class 5 — Oxidising substances</option>
                  <option value="6">Class 6 — Toxic / infectious</option>
                  <option value="7">Class 7 — Radioactive</option>
                  <option value="8">Class 8 — Corrosives</option>
                  <option value="9">Class 9 — Miscellaneous</option>
                </select>
              </Field>
              <Field label="Packing group">
                <select value={hazmat.packingGroup}
                  onChange={e => setHazmat({ ...hazmat, packingGroup: e.target.value })}
                  className={inputClass()}>
                  <option value="">Select…</option>
                  <option value="I">I — High danger</option>
                  <option value="II">II — Medium danger</option>
                  <option value="III">III — Low danger</option>
                </select>
              </Field>
              <Field label="Emergency contact name">
                <input value={hazmat.emergencyContactName}
                  onChange={e => setHazmat({ ...hazmat, emergencyContactName: e.target.value })}
                  className={inputClass()} />
              </Field>
              <Field label="Emergency contact phone">
                <input type="tel" value={hazmat.emergencyContactPhone}
                  onChange={e => setHazmat({ ...hazmat, emergencyContactPhone: e.target.value })}
                  placeholder="+971 50 …"
                  className={inputClass()} />
              </Field>
            </div>
            <p className="text-[11px] text-slate-500 italic">
              MSDS, Dangerous Goods Declaration and any regulator permits (MOH, Dubai Municipality, ESMA) can be attached after submission from your Shipments page.
            </p>
          </div>
        )}
      </Section>

      {/* Pickup */}
      <Section title="Pickup" icon={MapPin} accent="emerald">
        <PartyFields prefix="Pickup" value={pickup} onChange={setPickup} locations={locationOptions} />
      </Section>

      {/* Delivery */}
      <Section title="Delivery" icon={MapPin} accent="blue">
        <PartyFields prefix="Delivery" value={delivery} onChange={setDelivery} locations={locationOptions} />
      </Section>

      {/* Other */}
      <Section title="Other Details" icon={Truck} accent="violet">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Priority">
            <select value={priority} onChange={e => setPriority(e.target.value as typeof priority)}
              className={inputClass()}>
              <option>Low</option>
              <option>Medium</option>
              <option>High</option>
            </select>
          </Field>
          <Field label="Vehicle preference" hint="Optional — operator may override">
            {vehicleOptions.length > 0 ? (
              <select value={vehiclePref} onChange={e => setVehiclePref(e.target.value)} className={inputClass()}>
                <option value="">Any</option>
                {vehicleOptions.map(v => <option key={v} value={v}>{v}</option>)}
                {vehiclePref && !vehicleOptions.includes(vehiclePref) && <option value={vehiclePref}>{vehiclePref}</option>}
              </select>
            ) : (
              <input value={vehiclePref} onChange={e => setVehiclePref(e.target.value)}
                placeholder="e.g. Closed truck, refrigerated"
                className={inputClass()} />
            )}
          </Field>
        </div>
        <Field label="Special instructions" hint="Anything the operator should know — gate codes, equipment, timing">
          <textarea value={special} onChange={e => setSpecial(e.target.value)} rows={2}
            className={inputClass()}
            placeholder="e.g. Tail-lift required, weekend delivery, sensitive cargo…" />
        </Field>
      </Section>

      {/* Submit */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        {showQuote ? (
          <div className={`rounded-xl border px-3 py-2 ${quoteIsContract
            ? 'border-emerald-500/30 bg-emerald-500/10'
            : 'border-slate-500/25 bg-slate-500/10'}`}>
            <p className={`text-[10px] uppercase tracking-wide ${quoteIsContract ? 'text-emerald-300/80' : 'text-slate-300/70'}`}>
              {quoteIsContract ? `Contracted rate · ${rateQuote!.contractNo ?? ''}` : 'Estimate'}
              {rateLoading && <span className="ml-1 italic opacity-70">updating…</span>}
            </p>
            {rateLoading && !rateQuote ? (
              <p className="text-sm font-semibold text-white">Calculating…</p>
            ) : rateQuote && (rateQuote.total > 0 || quoteIsContract) ? (
              <p className="text-sm font-semibold text-white">
                {rateQuote.currency} {rateQuote.total.toLocaleString('en-AE', { maximumFractionDigits: 2 })}
                {rateQuote.minChargeApplied && <span className="ml-1 text-[10px] font-normal text-amber-300/80">min charge applied</span>}
              </p>
            ) : (
              <p className="text-sm font-semibold text-white">Operator will price your load.</p>
            )}
            <p className="text-[10px] text-slate-400 mt-0.5 italic">
              {quoteIsContract ? 'From your active rate contract — subject to final operator confirmation.'
                : quoteIsEstimate && rateQuote?.reason === 'spot-estimate' ? 'Indicative spot estimate — no contract for this lane.'
                : 'No contract matched yet — operator will price your load.'}
            </p>
          </div>
        ) : <span />}
        <div className="flex items-center justify-end gap-2">
        <Link href="/shipper-portal/shipments"
          className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</Link>
        {/* Single submit path — "Book now" was removed to avoid committing
            the shipper to the placeholder rate. The operator prices the
            load on the review side; the shipper sees the actual rate then. */}
        <button type="submit" value="review" disabled={submitting}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          <Send className="w-4 h-4" /> {submitting ? 'Submitting...' : 'Send for review'}
          {!submitting && <ArrowRight className="w-3.5 h-3.5" />}
        </button>
        </div>
      </div>
    </form>
  );
}

// ── Re-usable bits ─────────────────────────────────────────────────────

function Section({
  title, icon: Icon, accent, children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  accent: 'emerald' | 'blue' | 'amber' | 'violet';
  children: ReactNode;
}) {
  const tone = {
    emerald: 'text-emerald-300',
    blue:    'text-blue-300',
    amber:   'text-amber-300',
    violet:  'text-violet-300',
  }[accent];
  return (
    <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${tone}`} />
        <h2 className="text-sm font-bold text-white">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Field({
  label, hint, required, children,
}: {
  label: string; hint?: string; required?: boolean; children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1">
        {label}{required && <span className="text-rose-400">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}

function inputClass(): string {
  return 'w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';
}

function PartyFields({
  prefix, value, onChange, locations,
}: {
  prefix: string;
  value: PartySection;
  onChange: (v: PartySection) => void;
  locations: string[];
}) {
  const update = (p: Partial<PartySection>) => onChange({ ...value, ...p });

  // datetime-local strings (YYYY-MM-DDTHH:mm) are lexicographically ordered, so
  // a plain string compare is correct — no Date() parsing needed. We surface
  // the error inline so the user catches it the moment they pick a bad time,
  // not at submit; submit-time validation in the parent is the hard gate.
  const windowError =
    value.windowFrom && value.windowTo && value.windowTo < value.windowFrom
      ? `${prefix} window "To" must be on or after "From".`
      : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label={`${prefix} location name`} required>
          {locations.length > 0 ? (
            <select value={value.name} onChange={e => update({ name: e.target.value })} className={inputClass()}>
              <option value="">Select…</option>
              {locations.map(l => <option key={l} value={l}>{l}</option>)}
              {value.name && !locations.includes(value.name) && <option value={value.name}>{value.name}</option>}
            </select>
          ) : (
            <input value={value.name} onChange={e => update({ name: e.target.value })}
              placeholder="e.g. Dubai Port Terminal 3"
              className={inputClass()} />
          )}
        </Field>
        <Field label="Address">
          <input value={value.address} onChange={e => update({ address: e.target.value })}
            placeholder="Full address"
            className={inputClass()} />
        </Field>
        <Field label="City">
          <input value={value.city} onChange={e => update({ city: e.target.value })}
            placeholder="Dubai"
            className={inputClass()} />
        </Field>
        <Field label="Country">
          <select value={value.country} onChange={e => update({ country: e.target.value })}
            className={inputClass()}>
            <option value="AE">United Arab Emirates</option>
            <option value="SA">Saudi Arabia</option>
            <option value="OM">Oman</option>
            <option value="QA">Qatar</option>
            <option value="BH">Bahrain</option>
            <option value="KW">Kuwait</option>
          </select>
        </Field>
        <Field label="Contact name">
          <input value={value.contactName} onChange={e => update({ contactName: e.target.value })}
            className={inputClass()} />
        </Field>
        <Field label="Contact phone">
          <input type="tel" value={value.contactPhone} onChange={e => update({ contactPhone: e.target.value })}
            placeholder="+971 50 …"
            className={inputClass()} />
        </Field>
        <Field label={`${prefix} window — from`}>
          <input type="datetime-local" value={value.windowFrom}
            onChange={e => update({ windowFrom: e.target.value })}
            className={inputClass()} />
        </Field>
        <Field label="To">
          <input type="datetime-local" value={value.windowTo}
            onChange={e => update({ windowTo: e.target.value })}
            min={value.windowFrom || undefined}
            aria-invalid={windowError ? 'true' : 'false'}
            className={`${inputClass()} ${windowError ? 'border-rose-500 focus:ring-rose-500' : ''}`} />
        </Field>
      </div>
      {windowError && (
        <p className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1">
          {windowError}
        </p>
      )}
      <Field label="Instructions" hint="Specific to this stop">
        <textarea value={value.instructions} onChange={e => update({ instructions: e.target.value })}
          rows={2} className={inputClass()} />
      </Field>
    </div>
  );
}
