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

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, ArrowRight, MapPin, Package, Plus, Trash2, Send, AlertCircle, Truck,
} from 'lucide-react';
import Link from 'next/link';

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
  const router = useRouter();

  const [pickup,   setPickup]   = useState<PartySection>({ ...EMPTY_PARTY });
  const [delivery, setDelivery] = useState<PartySection>({ ...EMPTY_PARTY });
  const [cargoLines, setCargoLines] = useState<CargoLine[]>([{ ...EMPTY_CARGO }]);

  const [priority, setPriority] = useState<'Low' | 'Medium' | 'High'>('Medium');
  const [vehiclePref, setVehiclePref] = useState('');
  const [special, setSpecial] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const updateCargo = (i: number, p: Partial<CargoLine>) => {
    setCargoLines(prev => prev.map((c, idx) => idx === i ? { ...c, ...p } : c));
  };
  const addCargoLine = () => setCargoLines(prev => [...prev, { ...EMPTY_CARGO }]);
  const removeCargoLine = (i: number) => setCargoLines(prev => prev.filter((_, idx) => idx !== i));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    if (!pickup.name && !pickup.address) { setErr('Pickup location is required.'); return; }
    if (!delivery.name && !delivery.address) { setErr('Delivery location is required.'); return; }
    if (!cargoLines[0]?.description) { setErr('At least one cargo line with a description is required.'); return; }

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
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data?.error ?? 'Failed to submit'); return; }
      // Redirect to the detail page of the newly-created shipment.
      router.replace(`/shipper-portal/shipments/${data.shipment.id}`);
    } finally {
      setSubmitting(false);
    }
  };

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
            Your operator will acknowledge and assign a carrier.
          </p>
        </div>
      </div>

      {err && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2.5 text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {err}
        </div>
      )}

      {/* Pickup */}
      <Section title="Pickup" icon={MapPin} accent="emerald">
        <PartyFields prefix="Pickup" value={pickup} onChange={setPickup} />
      </Section>

      {/* Delivery */}
      <Section title="Delivery" icon={MapPin} accent="blue">
        <PartyFields prefix="Delivery" value={delivery} onChange={setDelivery} />
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
            <input value={vehiclePref} onChange={e => setVehiclePref(e.target.value)}
              placeholder="e.g. Closed truck, refrigerated"
              className={inputClass()} />
          </Field>
        </div>
        <Field label="Special instructions" hint="Anything the operator should know — gate codes, equipment, timing">
          <textarea value={special} onChange={e => setSpecial(e.target.value)} rows={2}
            className={inputClass()}
            placeholder="e.g. Tail-lift required, weekend delivery, sensitive cargo…" />
        </Field>
      </Section>

      {/* Submit */}
      <div className="flex items-center justify-end gap-2 pt-2">
        <Link href="/shipper-portal/shipments"
          className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</Link>
        <button type="submit" disabled={submitting}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          <Send className="w-4 h-4" /> {submitting ? 'Submitting…' : 'Submit Request'}
          {!submitting && <ArrowRight className="w-3.5 h-3.5" />}
        </button>
      </div>
    </form>
  );
}

// ── Re-usable bits ─────────────────────────────────────────────────────

function Section({
  title, icon: Icon, accent, children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: 'emerald' | 'blue' | 'amber' | 'violet';
  children: React.ReactNode;
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
  label: string; hint?: string; required?: boolean; children: React.ReactNode;
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
  prefix, value, onChange,
}: {
  prefix: string;
  value: PartySection;
  onChange: (v: PartySection) => void;
}) {
  const update = (p: Partial<PartySection>) => onChange({ ...value, ...p });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label={`${prefix} location name`} required>
          <input value={value.name} onChange={e => update({ name: e.target.value })}
            placeholder="e.g. Dubai Port Terminal 3"
            className={inputClass()} />
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
            className={inputClass()} />
        </Field>
      </div>
      <Field label="Instructions" hint="Specific to this stop">
        <textarea value={value.instructions} onChange={e => update({ instructions: e.target.value })}
          rows={2} className={inputClass()} />
      </Field>
    </div>
  );
}
