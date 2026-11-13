'use client';

/**
 * RAC Ancillary Catalogue — manage the master list of add-ons that can
 * attach to a booking (GPS, child seat, cross-border permits, Salik tag,
 * additional driver, fuel options, etc.). The yield co-pilot pulls
 * from this catalogue when proposing a booking.
 */

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ChevronLeft, Plus, Pencil, Power, Trash2, ShieldAlert } from 'lucide-react';
import { BACK_BUTTON } from '@/lib/ui/toggle';

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
  OTHER:     'bg-slate-500/10 text-[var(--text-muted)] border-slate-500/30',
};

const blank = {
  code: '', nameEn: '', nameAr: '', description: '',
  category: 'ACCESSORY', pricingType: 'PER_DAY' as 'PER_DAY' | 'ONE_TIME',
  unitPrice: 0, currency: 'AED', applicableCategories: '',
  isActive: true, sortOrder: 0, notes: '',
};

export default function AncillariesPage() {
  const [items, setItems] = useState<Ancillary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<Ancillary | null>(null);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rbacError, setRbacError] = useState<string | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rental/ancillaries', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setRbacError(data?.error ?? 'Requires permission to view ancillaries.');
        setItems([]);
        return;
      }
      if (!res.ok) {
        setError(data?.error ?? `Failed to load ancillaries (${res.status})`);
        setItems([]);
        return;
      }
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data?.ancillaries)
            ? data.ancillaries
            : [];
      setItems(list);
    } catch {
      setError('Failed to load ancillaries');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditingItem(null);
    setForm(blank);
    setError(null);
    setShowForm(true);
  }

  function openEdit(a: Ancillary) {
    setEditingItem(a);
    setError(null);
    setForm({
      code: a.code ?? '',
      nameEn: a.nameEn ?? '',
      nameAr: a.nameAr ?? '',
      description: a.description ?? '',
      category: a.category ?? 'ACCESSORY',
      pricingType: a.pricingType ?? 'PER_DAY',
      unitPrice: Number(a.unitPrice) || 0,
      currency: a.currency ?? 'AED',
      applicableCategories: a.applicableCategories ?? '',
      isActive: a.isActive ?? true,
      sortOrder: a.sortOrder ?? 0,
      notes: '',
    });
    setShowForm(true);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setRbacError(null);
    try {
      const url = editingItem
        ? `/api/rental/ancillaries/${encodeURIComponent(editingItem.id)}`
        : '/api/rental/ancillaries';
      const method = editingItem ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        const msg = data.error ?? 'Requires RAC Manager permission to manage ancillaries.';
        setRbacError(msg);
        setError(`Requires RAC Manager Permission (403): ${msg}`);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? `Server returned ${res.status}`);
        return;
      }
      setShowForm(false);
      setEditingItem(null);
      setForm(blank);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(a: Ancillary) {
    setRowBusyId(a.id);
    setError(null);
    setRbacError(null);
    try {
      const nextActive = !(a.isActive ?? true);
      const res = await fetch(`/api/rental/ancillaries/${encodeURIComponent(a.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: nextActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setRbacError(data.error ?? 'Requires RAC Manager permission to update ancillaries.');
        return;
      }
      if (!res.ok) {
        setError(data.error ?? `Failed to update ancillary (${res.status})`);
        return;
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update ancillary');
    } finally {
      setRowBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!confirm('Soft-delete this ancillary?')) return;
    setRowBusyId(id);
    setError(null);
    setRbacError(null);
    try {
      const res = await fetch(`/api/rental/ancillaries/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setRbacError(data.error ?? 'Requires RAC Manager permission to delete ancillaries.');
        return;
      }
      if (!res.ok) {
        setError(data.error ?? `Failed to delete ancillary (${res.status})`);
        return;
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete ancillary');
    } finally {
      setRowBusyId(null);
    }
  }

  async function seedAll() {
    if (!confirm(`Seed ${PRESETS.length} standard ancillaries (UAE market)?`)) return;
    setSeedBusy(true);
    setError(null);
    setRbacError(null);
    try {
      let firstError: string | null = null;
      for (const p of PRESETS) {
        const res = await fetch('/api/rental/ancillaries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p),
        });
        if (res.status === 403) {
          const data = await res.json().catch(() => ({}));
          setRbacError(
            data.error ?? 'Requires RAC Manager permission to seed ancillary catalogue.',
          );
          return;
        }
        if (!res.ok && !firstError) {
          const data = await res.json().catch(() => ({}));
          firstError = data.error ?? `Seed failed with status ${res.status}`;
        }
      }
      if (firstError) setError(firstError);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to seed ancillaries');
    } finally {
      setSeedBusy(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/rental" className={BACK_BUTTON}>
            <ChevronLeft className="h-3 w-3" /> Back to dashboard
          </Link>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mt-2">Ancillary Catalogue</h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Master list of add-ons attachable to bookings. The AI co-pilot suggests
            from this catalogue. Per-day vs one-time, applicable categories,
            insurance / permit / accessory / fuel / driver categorisation.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={seedAll}
            disabled={seedBusy || items.length > 0}
            className="px-4 py-2 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] text-[var(--text-main)] text-sm hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
            title={items.length > 0 ? 'Catalogue already populated' : 'One-click seed UAE-standard ancillaries'}
          >
            {seedBusy ? 'Seeding…' : '+ Seed UAE Standards'}
          </button>
          <button
            onClick={openNew}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-medium hover:opacity-90 flex items-center gap-2"
          >
            <Plus className="h-4 w-4" /> New Ancillary
          </button>
        </div>
      </div>

      {rbacError && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-300">Requires RAC Manager Permission (403)</p>
              <p className="text-xs text-amber-200/80 mt-0.5">{rbacError}</p>
            </div>
          </div>
          <button onClick={() => setRbacError(null)} className="text-amber-300/70 hover:text-amber-200 text-sm">✕</button>
        </div>
      )}

      {error && !rbacError && (
        <div className="rounded-xl bg-rose-900/30 border border-rose-700 p-4 text-rose-200 text-sm flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-200/80 hover:text-white text-xs">✕</button>
        </div>
      )}

      {loading ? (
        <div className="text-[var(--text-faint)] text-center py-12">Loading…</div>
      ) : items.length === 0 ? (
        <div className="p-8 rounded-xl bg-[var(--bg-surface)]/40 border border-[var(--border-subtle)] text-center text-[var(--text-muted)]">
          No ancillaries yet. Click <strong className="text-cyan-300">+ Seed UAE Standards</strong> for an
          18-item kickstart, or add custom ones with <strong className="text-cyan-300">+ New Ancillary</strong>.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-surface)]/60">
              <tr className="text-left text-xs text-[var(--text-muted)]">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name (EN / AR)</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Pricing</th>
                <th className="px-4 py-3 text-right">Unit Price</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const isRowBusy = rowBusyId === a.id;
                const active = Boolean(a.isActive);
                return (
                  <tr key={a.id} className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-surface)]/30">
                    <td className="px-4 py-3 font-mono text-xs text-cyan-300">{a.code}</td>
                    <td className="px-4 py-3">
                      <div className="text-[var(--text-main)]">{a.nameEn}</div>
                      {a.nameAr && <div className="text-xs text-[var(--text-muted)]" dir="rtl">{a.nameAr}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {a.category && (
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[a.category] ?? CATEGORY_COLORS.OTHER}`}>
                          {a.category}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                      {a.pricingType === 'PER_DAY' ? 'Per day' : 'One-time'}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--text-main)] font-medium">
                      {a.currency} {Number(a.unitPrice).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      <span className="text-xs text-[var(--text-faint)] ml-1">{a.pricingType === 'PER_DAY' ? '/day' : ''}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${active ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border-[var(--border-strong)]'}`}>
                        {active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(a)}
                          disabled={isRowBusy}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 text-xs font-medium transition-colors disabled:opacity-40"
                          title="Edit ancillary"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          onClick={() => toggleActive(a)}
                          disabled={isRowBusy}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors disabled:opacity-40 ${
                            active
                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25'
                              : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
                          }`}
                          title={active ? 'Deactivate ancillary' : 'Activate ancillary'}
                        >
                          <Power className="h-3.5 w-3.5" />
                          {active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          onClick={() => remove(a.id)}
                          disabled={isRowBusy}
                          className="text-rose-400 hover:text-rose-300 p-1 disabled:opacity-40"
                          title="Soft-delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-[var(--text-main)]">
                {editingItem ? 'Edit Ancillary' : 'New Ancillary'}
              </h2>
              <button
                onClick={() => { setShowForm(false); setEditingItem(null); }}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                ×
              </button>
            </div>
            {error && (
              <div className="mb-4 rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-300">
                {error}
              </div>
            )}
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
                placeholder="LUXURY,FULL_SIZE_SUV" />
              <Field className="col-span-2" label="Description" value={form.description}
                onChange={(v) => setForm({ ...form, description: v })} />
              <div className="col-span-2 flex items-center gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="ancillaryIsActive"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="w-4 h-4 accent-teal-500 rounded"
                />
                <label htmlFor="ancillaryIsActive" className="text-xs text-[var(--text-main)]">
                  Active (available for counter &amp; online bookings)
                </label>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button
                onClick={() => { setShowForm(false); setEditingItem(null); }}
                className="px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] text-sm"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={busy || !form.code || !form.nameEn || form.unitPrice <= 0}
                className="px-6 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-40"
              >
                {busy ? 'Saving…' : editingItem ? 'Update Ancillary' : 'Save Ancillary'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label, value, onChange, type = 'text', options, placeholder, mono, rtl, className,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: 'text' | 'number' | 'select';
  options?: string[]; placeholder?: string; mono?: boolean; rtl?: boolean; className?: string;
}) {
  const baseClass = `w-full mt-1 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm ${mono ? 'font-mono' : ''}`;
  return (
    <div className={className}>
      <label className="text-xs text-[var(--text-muted)]">{label}</label>
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
