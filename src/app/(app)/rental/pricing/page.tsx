'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface PricingRule {
  id: string;
  vehicleCategory: string;
  baseDailyRate: number;
  baseKmRate?: number;
  weeklyRate?: number;
  monthlyRate?: number;
  multiplier?: number;
  seasonFrom?: string;
  seasonTo?: string;
  currency?: string;
  isActive?: boolean;
  createdAt?: string;
}

/** Synced with Fleet VEHICLE_SEGMENTS */
const VEHICLE_CATEGORIES = [
  { value: 'ECONOMY',       label: 'Economy'            },
  { value: 'COMPACT',       label: 'Compact'            },
  { value: 'MID_SIZE',      label: 'Mid-size'           },
  { value: 'FULL_SIZE',     label: 'Full-size'          },
  { value: 'COMPACT_SUV',   label: 'SUV – Compact'      },
  { value: 'MID_SIZE_SUV',  label: 'SUV – Mid-size'     },
  { value: 'FULL_SIZE_SUV', label: 'SUV – Full-size'    },
  { value: 'LUXURY',        label: 'Luxury'             },
  { value: 'PREMIUM',       label: 'Premium'            },
  { value: 'SPORTS',        label: 'Sports'             },
  { value: 'VAN',           label: 'Van / People Mover' },
  { value: 'PICKUP',        label: 'Pickup / Commercial'},
  { value: 'BUS',           label: 'Bus'                },
  { value: 'SPECIAL',       label: 'Special / Heavy'    },
];

export default function PricingPage() {
  const [rules, setRules]           = useState<PricingRule[]>([]);
  const [showModal, setShowModal]   = useState(false);
  const [editRule, setEditRule]     = useState<PricingRule | null>(null);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  const emptyForm = { vehicleCategory:'', baseDailyRate:'', baseKmRate:'', weeklyRate:'', monthlyRate:'', multiplier:'1', seasonFrom:'', seasonTo:'', currency:'AED', isActive:true };
  const [formData, setFormData] = useState(emptyForm);

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/rental/pricing');
      const data = await res.json();
      setRules(Array.isArray(data) ? data : []);
    } catch {
      setError('Failed to load pricing rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRules(); }, [loadRules]);

  const openNew = () => { setEditRule(null); setFormData(emptyForm); setShowModal(true); };

  const openEdit = (r: PricingRule) => {
    setEditRule(r);
    setFormData({
      vehicleCategory: r.vehicleCategory,
      baseDailyRate:   String(r.baseDailyRate),
      baseKmRate:      r.baseKmRate  ? String(r.baseKmRate)  : '',
      weeklyRate:      r.weeklyRate  ? String(r.weeklyRate)  : '',
      monthlyRate:     r.monthlyRate ? String(r.monthlyRate) : '',
      multiplier:      r.multiplier  ? String(r.multiplier)  : '1',
      seasonFrom:      r.seasonFrom  ? r.seasonFrom.slice(0,10) : '',
      seasonTo:        r.seasonTo    ? r.seasonTo.slice(0,10)   : '',
      currency:        r.currency ?? 'AED',
      isActive:        r.isActive ?? true,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: any = {
        vehicleCategory: formData.vehicleCategory,
        baseDailyRate:   parseFloat(formData.baseDailyRate),
        baseKmRate:      formData.baseKmRate  ? parseFloat(formData.baseKmRate)  : null,
        weeklyRate:      formData.weeklyRate  ? parseFloat(formData.weeklyRate)  : null,
        monthlyRate:     formData.monthlyRate ? parseFloat(formData.monthlyRate) : null,
        multiplier:      parseFloat(formData.multiplier) || 1,
        currency:        formData.currency,
        isActive:        formData.isActive,
        seasonFrom:      formData.seasonFrom ? new Date(formData.seasonFrom).toISOString() : null,
        seasonTo:        formData.seasonTo   ? new Date(formData.seasonTo).toISOString()   : null,
      };
      const url    = editRule ? `/api/rental/pricing/${editRule.id}` : '/api/rental/pricing';
      const method = editRule ? 'PATCH' : 'POST';
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error('Failed');
      setShowModal(false);
      loadRules();
    } catch {
      setError('Failed to save pricing rule');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (r: PricingRule) => {
    try {
      await fetch(`/api/rental/pricing/${r.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !r.isActive }),
      });
      loadRules();
    } catch { setError('Failed to update'); }
  };

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-[var(--text-muted)] animate-pulse">Loading...</div></div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mb-2">Pricing Rules</h1>
          <p className="text-xs text-[var(--text-muted)]">{rules.filter(r => r.isActive).length} active / {rules.length} total rules</p>
        </div>
        <button onClick={openNew} className="rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90">
          + New Rule
        </button>
      </div>

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">{error}</div>}

      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {rules.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] py-12">No pricing rules configured</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Category</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Daily Rate</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Weekly Rate</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Monthly Rate</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Per KM</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Season</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Multiplier</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Status</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors">
                  <td className="px-4 py-4 text-sm font-medium text-[var(--text-main)]">
                    {VEHICLE_CATEGORIES.find(c => c.value === r.vehicleCategory)?.label ?? r.vehicleCategory}
                  </td>
                  <td className="px-4 py-4 text-sm font-medium text-amber-400">{r.currency ?? 'AED'} {Number(r.baseDailyRate).toLocaleString()}</td>
                  <td className="px-4 py-4 text-sm text-[var(--text-main)]">{r.weeklyRate  ? `${r.currency ?? 'AED'} ${Number(r.weeklyRate).toLocaleString()}`  : '-'}</td>
                  <td className="px-4 py-4 text-sm text-[var(--text-main)]">{r.monthlyRate ? `${r.currency ?? 'AED'} ${Number(r.monthlyRate).toLocaleString()}` : '-'}</td>
                  <td className="px-4 py-4 text-sm text-[var(--text-main)]">{r.baseKmRate  ? `${r.currency ?? 'AED'} ${Number(r.baseKmRate).toFixed(2)}`         : '-'}</td>
                  <td className="px-4 py-4 text-sm text-[var(--text-main)]">
                    {r.seasonFrom && r.seasonTo
                      ? `${new Date(r.seasonFrom).toLocaleDateString()} — ${new Date(r.seasonTo).toLocaleDateString()}`
                      : 'Year-round'}
                  </td>
                  <td className="px-4 py-4 text-sm text-[var(--text-main)]">{Number(r.multiplier ?? 1).toFixed(2)}x</td>
                  <td className="px-4 py-4">
                    {r.isActive
                      ? <span className="px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Active</span>
                      : <span className="px-3 py-1 rounded-full text-xs font-medium bg-slate-500/20 text-[var(--text-main)] border border-slate-500/30">Inactive</span>}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(r)} className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30">Edit</button>
                      <button onClick={() => toggleActive(r)} className="text-xs px-2 py-1 rounded bg-[var(--bg-surface-hover)] text-[var(--text-main)] border border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]">
                        {r.isActive ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[var(--bg-surface)]/95 border border-[var(--border-subtle)] rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-[var(--text-main)]">{editRule ? 'Edit Pricing Rule' : 'New Pricing Rule'}</h2>
              <button onClick={() => setShowModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)]">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Vehicle Category *</label>
                  <select value={formData.vehicleCategory} onChange={e => setFormData(p => ({...p, vehicleCategory: e.target.value}))} required
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-amber-500 focus:outline-none">
                    <option value="">Select category</option>
                    {VEHICLE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Currency</label>
                  <select value={formData.currency} onChange={e => setFormData(p => ({...p, currency: e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-amber-500 focus:outline-none">
                    <option value="AED">AED</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
                {[
                  { label:'Base Daily Rate *', key:'baseDailyRate', placeholder:'150', required:true },
                  { label:'Weekly Rate', key:'weeklyRate', placeholder:'900' },
                  { label:'Monthly Rate', key:'monthlyRate', placeholder:'3500' },
                  { label:'Per KM Rate', key:'baseKmRate', placeholder:'0.50' },
                  { label:'Multiplier', key:'multiplier', placeholder:'1.0' },
                ].map(({ label, key, placeholder, required }) => (
                  <div key={key}>
                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">{label}</label>
                    <input type="number" value={(formData as any)[key]} onChange={e => setFormData(p => ({...p, [key]: e.target.value}))}
                      placeholder={placeholder} required={required} min="0" step="0.01"
                      className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-amber-500 focus:outline-none" />
                  </div>
                ))}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Season From</label>
                  <input type="date" value={formData.seasonFrom} onChange={e => setFormData(p => ({...p, seasonFrom: e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-amber-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Season To</label>
                  <input type="date" value={formData.seasonTo} onChange={e => setFormData(p => ({...p, seasonTo: e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-amber-500 focus:outline-none" />
                </div>
                <div className="flex items-center gap-3 col-span-2">
                  <input type="checkbox" id="isActive" checked={formData.isActive as boolean} onChange={e => setFormData(p => ({...p, isActive: e.target.checked}))} className="w-4 h-4 accent-amber-500 text-[var(--text-main)]" />
                  <label htmlFor="isActive" className="text-sm text-[var(--text-main)]">Active Rule</label>
                </div>
              </div>
              <div className="flex gap-4 justify-end pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="px-6 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]">Cancel</button>
                <button type="submit" disabled={saving} className="px-6 py-2 rounded-lg bg-gradient-to-r from-amber-600 to-orange-600 text-white hover:opacity-90 disabled:opacity-50">
                  {saving ? 'Saving...' : editRule ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
