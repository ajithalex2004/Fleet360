'use client';

/**
 * RAC Ancillary Catalogue — manage the master list of add-ons that can
 * attach to a booking (GPS, child seat, cross-border permits, Salik tag,
 * additional driver, fuel options, etc.). The yield co-pilot pulls
 * from this catalogue when proposing a booking.
 */

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react';
import ActionDialog from '@/components/ui/ActionDialog';
import { useRentalMasterData } from '@/hooks/useRentalMasterData';

interface Ancillary {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  description: string | null;
  category: string | null;
  pricingType: 'PER_DAY' | 'ONE_TIME';
  unitPrice: number;
  currency: string;
  applicableCategories: string | null;
  isActive: boolean | null;
  sortOrder: number | null;
}

const PRESETS = [
  { code: 'GPS',                  nameEn: 'GPS / SatNav',           nameAr: 'نظام ملاحة GPS',         category: 'ACCESSORY', pricingType: 'PER_DAY',  unitPrice: 25  },
  { code: 'CHILD_SEAT',           nameEn: 'Child seat (4-7 yrs)',   nameAr: 'مقعد أطفال',             category: 'ACCESSORY', pricingType: 'PER_DAY',  unitPrice: 30  },
  { code: 'BOOSTER_SEAT',         nameEn: 'Booster seat (7-12 yrs)', nameAr: 'مقعد مرتفع',           category: 'ACCESSORY', pricingType: 'PER_DAY',  unitPrice: 25  },
  { code: 'ADDITIONAL_DRIVER',    nameEn: 'Additional driver',      nameAr: 'سائق إضافي',             category: 'DRIVER',    pricingType: 'PER_DAY',  unitPrice: 50  },
  { code: 'YOUNG_DRIVER',         nameEn: 'Young driver surcharge', nameAr: 'رسم سائق صغير السن',     category: 'DRIVER',    pricingType: 'PER_DAY',  unitPrice: 70  },
  { code: 'CROSS_BORDER_OMAN',    nameEn: 'Cross-border permit — Oman',  nameAr: 'تصريح عبور — عُمان', category: 'PERMIT', pricingType: 'ONE_TIME', unitPrice: 200 },
  { code: 'CROSS_BORDER_SAUDI',   nameEn: 'Cross-border permit — Saudi', nameAr: 'تصريح عبور — السعودية', category: 'PERMIT', pricingType: 'ONE_TIME', unitPrice: 350 },
  { code: 'CROSS_BORDER_QATAR',   nameEn: 'Cross-border permit — Qatar', nameAr: 'تصريح عبور — قطر',  category: 'PERMIT', pricingType: 'ONE_TIME', unitPrice: 350 },
  { code: 'SALIK_TAG',            nameEn: 'Salik tag rental',       nameAr: 'إيجار جهاز سالك',        category: 'ACCESSORY', pricingType: 'PER_DAY',  unitPrice: 15  },
  { code: 'AIRPORT_FEE',          nameEn: 'Airport pickup / drop fee', nameAr: 'رسم الاستلام من المطار', category: 'OTHER', pricingType: 'ONE_TIME', unitPrice: 75  },
  { code: 'DELIVERY_PICKUP',      nameEn: 'Delivery / pickup (per leg)', nameAr: 'توصيل واستلام',     category: 'OTHER',     pricingType: 'ONE_TIME', unitPrice: 150 },
  { code: 'EXTRA_KM_PACK',        nameEn: 'Extra km pack (200/day)', nameAr: 'حزمة كيلومترات إضافية', category: 'OTHER',     pricingType: 'PER_DAY',  unitPrice: 50  },
  { code: 'FUEL_PRE_PAID',        nameEn: 'Pre-paid full tank',     nameAr: 'وقود مدفوع مسبقاً',       category: 'FUEL',      pricingType: 'ONE_TIME', unitPrice: 300 },
  { code: 'WIFI_HOTSPOT',         nameEn: 'Wi-Fi hotspot',          nameAr: 'نقطة واي فاي',           category: 'ACCESSORY', pricingType: 'PER_DAY',  unitPrice: 35  },
  { code: 'CDW',                  nameEn: 'Collision Damage Waiver', nameAr: 'تنازل عن أضرار التصادم', category: 'INSURANCE', pricingType: 'PER_DAY',  unitPrice: 40  },
  { code: 'LDW',                  nameEn: 'Loss Damage Waiver',     nameAr: 'تنازل عن خسارة الأضرار', category: 'INSURANCE', pricingType: 'PER_DAY',  unitPrice: 55  },
  { code: 'SUPER_CDW',            nameEn: 'Super CDW (zero excess)', nameAr: 'تنازل شامل', category: 'INSURANCE', pricingType: 'PER_DAY', unitPrice: 110 },
  { code: 'PAI',                  nameEn: 'Personal Accident Insurance', nameAr: 'تأمين الحوادث الشخصية', category: 'INSURANCE', pricingType: 'PER_DAY', unitPrice: 25  },
];

const CATEGORY_COLORS: Record<string, string> = {
  ACCESSORY: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
  INSURANCE: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
  PERMIT:    'bg-amber-500/10 text-amber-300 border-amber-500/30',
  DRIVER:    'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  FUEL:      'bg-orange-500/10 text-orange-300 border-orange-500/30',
  OTHER:     'bg-slate-500/10 text-slate-300 border-slate-500/30',
};

const blank = {
  code: '', nameEn: '', nameAr: '', description: '',
  category: 'ACCESSORY', pricingType: 'PER_DAY' as 'PER_DAY' | 'ONE_TIME',
  unitPrice: 0, currency: 'AED', applicableCategories: '',
  isActive: true, sortOrder: 0, notes: '',
};

export default function AncillariesPage() {
  const { masterData } = useRentalMasterData();
  const [items, setItems] = useState<Ancillary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<null | {
    mode: 'delete' | 'seed';
    ancillary?: Ancillary;
  }>(null);
  const presets = masterData.ancillaryPresets.length ? masterData.ancillaryPresets : PRESETS;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rental/ancillaries');
      const data = res.ok ? await res.json() : [];
      setItems(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/rental/ancillaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Server returned ${res.status}`);
        return;
      }
      setShowForm(false);
      setForm(blank);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/rental/ancillaries/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setConfirmState(null);
      load();
    }
  }

  async function seedAll() {
    setSeedBusy(true);
    try {
      for (const p of presets) {
        await fetch('/api/rental/ancillaries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p),
        });
      }
      setConfirmState(null);
      load();
    } finally {
      setSeedBusy(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/rental" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-cyan-400">
            <ChevronLeft className="h-3 w-3" /> Back to dashboard
          </Link>
          <h1 className="text-3xl font-bold text-white mt-2">Ancillary Catalogue</h1>
          <p className="text-sm text-slate-400 mt-1">
            Master list of add-ons attachable to bookings. The AI co-pilot suggests
            from this catalogue. Per-day vs one-time, applicable categories,
            insurance / permit / accessory / fuel / driver categorisation.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setConfirmState({ mode: 'seed' })}
            disabled={seedBusy || items.length > 0}
            className="px-4 py-2 rounded-xl bg-slate-700 border border-slate-600 text-slate-200 text-sm hover:bg-slate-600 disabled:opacity-40"
            title={items.length > 0 ? 'Catalogue already populated' : 'One-click seed UAE-standard ancillaries'}
          >
            {seedBusy ? 'Seeding…' : '+ Seed UAE Standards'}
          </button>
          <button
            onClick={() => { setForm(blank); setShowForm(true); }}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-medium hover:opacity-90 flex items-center gap-2"
          >
            <Plus className="h-4 w-4" /> New Ancillary
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-900/30 border border-rose-700 p-4 text-rose-200 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="text-slate-500 text-center py-12">Loading…</div>
      ) : items.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-slate-400">
          No ancillaries yet. Click <strong className="text-cyan-300">+ Seed UAE Standards</strong> for an
          18-item kickstart, or add custom ones with <strong className="text-cyan-300">+ New Ancillary</strong>.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60">
              <tr className="text-left text-xs text-slate-400">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name (EN / AR)</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Pricing</th>
                <th className="px-4 py-3 text-right">Unit Price</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                  <td className="px-4 py-3 font-mono text-xs text-cyan-300">{a.code}</td>
                  <td className="px-4 py-3">
                    <div className="text-white">{a.nameEn}</div>
                    {a.nameAr && <div className="text-xs text-slate-400" dir="rtl">{a.nameAr}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {a.category && (
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[a.category] ?? CATEGORY_COLORS.OTHER}`}>
                        {a.category}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-300">
                    {a.pricingType === 'PER_DAY' ? 'Per day' : 'One-time'}
                  </td>
                  <td className="px-4 py-3 text-right text-white font-medium">
                    {a.currency} {Number(a.unitPrice).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    <span className="text-xs text-slate-500 ml-1">{a.pricingType === 'PER_DAY' ? '/day' : ''}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${a.isActive ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-700 text-slate-400 border-slate-600'}`}>
                      {a.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setConfirmState({ mode: 'delete', ancillary: a })} className="text-rose-400 hover:text-rose-300" title="Soft-delete">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-slate-800 border border-slate-700 rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">New Ancillary</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white">×</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code *" mono value={form.code}
                onChange={(v) => setForm({ ...form, code: v.toUpperCase().replace(/\s+/g, '_') })} placeholder="GPS" />
              <Field label="Category" type="select" options={['ACCESSORY','INSURANCE','PERMIT','DRIVER','FUEL','OTHER']}
                value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
              <Field label="Name (EN) *" value={form.nameEn} onChange={(v) => setForm({ ...form, nameEn: v })} placeholder="GPS / SatNav" />
              <Field label="Name (AR)" value={form.nameAr} onChange={(v) => setForm({ ...form, nameAr: v })} placeholder="نظام ملاحة" rtl />
              <Field label="Pricing type *" type="select" options={['PER_DAY','ONE_TIME']}
                value={form.pricingType} onChange={(v) => setForm({ ...form, pricingType: v as 'PER_DAY' | 'ONE_TIME' })} />
              <Field label="Unit price (AED) *" type="number" value={String(form.unitPrice)}
                onChange={(v) => setForm({ ...form, unitPrice: parseFloat(v) || 0 })} placeholder="25" />
              <Field className="col-span-2" label="Applicable categories (CSV, blank = ALL)" mono
                value={form.applicableCategories} onChange={(v) => setForm({ ...form, applicableCategories: v })}
                placeholder="LUXURY_SEDAN,LUXURY_SUV" />
              <Field className="col-span-2" label="Description" value={form.description}
                onChange={(v) => setForm({ ...form, description: v })} />
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 text-sm">
                Cancel
              </button>
              <button
                onClick={save}
                disabled={busy || !form.code || !form.nameEn || !form.unitPrice}
                className="px-6 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-40"
              >
                {busy ? 'Saving…' : 'Save Ancillary'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ActionDialog
        open={!!confirmState}
        title={confirmState?.mode === 'seed' ? 'Seed UAE ancillary standards' : 'Soft-delete ancillary'}
        description={
          confirmState?.mode === 'seed'
            ? 'This will add the standard UAE ancillary catalogue to the current tenant.'
            : 'This ancillary will be soft-deleted and removed from active booking recommendations.'
        }
        details={confirmState?.mode === 'seed'
          ? [`${presets.length} standard ancillary templates will be created.`]
          : confirmState?.ancillary
            ? [
                `Code: ${confirmState.ancillary.code}`,
                `Name: ${confirmState.ancillary.nameEn}`,
                `Pricing: ${confirmState.ancillary.currency} ${Number(confirmState.ancillary.unitPrice).toFixed(2)}`,
              ]
            : undefined}
        tone={confirmState?.mode === 'seed' ? 'warning' : 'danger'}
        confirmLabel={confirmState?.mode === 'seed' ? 'Seed catalogue' : 'Delete ancillary'}
        busy={confirmState?.mode === 'seed' ? seedBusy : false}
        onClose={() => !(confirmState?.mode === 'seed' && seedBusy) && setConfirmState(null)}
        onConfirm={confirmState
          ? () => confirmState.mode === 'seed'
            ? seedAll()
            : confirmState.ancillary
              ? remove(confirmState.ancillary.id)
              : undefined
          : undefined}
      />
    </div>
  );
}

function Field({
  label, value, onChange, type = 'text', options, placeholder, mono, rtl, className,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: 'text' | 'number' | 'select';
  options?: string[]; placeholder?: string; mono?: boolean; rtl?: boolean; className?: string;
}) {
  const baseClass = `w-full mt-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm ${mono ? 'font-mono' : ''}`;
  return (
    <div className={className}>
      <label className="text-xs text-slate-400">{label}</label>
      {type === 'select' && options ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={baseClass}>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          dir={rtl ? 'rtl' : undefined}
          className={baseClass}
        />
      )}
    </div>
  );
}
