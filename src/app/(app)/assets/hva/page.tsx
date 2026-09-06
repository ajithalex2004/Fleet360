'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface HVA {
  id: string;
  asset_no: string;
  name: string;
  domain: string;
  serial_number?: string;
  custodian_name?: string;
  custodian_department?: string;
  condition?: string;
  calibration_due_date?: string;
  insurance_expiry?: string;
  current_value_aed?: number;
  status?: string;
  oem_part_number?: string;
  manufacturer?: string;
  model?: string;
  year?: number;
  category?: string;
  purchase_date?: string;
  purchase_cost_aed?: number;
  notes?: string;
  assigned_entity_type?: string;
  assigned_vehicle_id?: string;
  custody_start_date?: string;
  insurance_policy_no?: string;
  insurance_provider?: string;
  insurance_premium_aed?: number;
  last_calibration_date?: string;
  calibration_interval_days?: number;
  calibration_provider?: string;
  calibration_cert_no?: string;
  warranty_expiry?: string;
  ble_tag_id?: string;
  location_zone?: string;
  last_lat?: number;
  last_lng?: number;
}

const CONDITIONS = ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'CONDEMNED'];
const DOMAINS = ['FLEET', 'AMBULANCE', 'SCHOOL_BUS', 'RAC', 'LOGISTICS', 'FIELD_SERVICE', 'GENERAL'];

function daysDiff(dateStr?: string) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function CalibBadge({ date }: { date?: string }) {
  const d = daysDiff(date);
  if (d === null) return <span className="text-[var(--text-faint)]">—</span>;
  if (d < 0) return <span className="bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full text-xs">OVERDUE</span>;
  if (d <= 30) return <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full text-xs">{d}d</span>;
  return <span className="text-[var(--text-muted)] text-xs">{new Date(date!).toLocaleDateString()}</span>;
}

const EMPTY_FORM: Partial<HVA> = {
  name: '', serial_number: '', oem_part_number: '', manufacturer: '', model: '', year: undefined,
  domain: 'GENERAL', category: '', purchase_date: '', purchase_cost_aed: 0, current_value_aed: 0,
  condition: 'GOOD', notes: '', custodian_name: '', custodian_department: '',
  assigned_entity_type: '', assigned_vehicle_id: '', custody_start_date: '',
  insurance_policy_no: '', insurance_provider: '', insurance_expiry: '', insurance_premium_aed: 0,
  calibration_due_date: '', last_calibration_date: '', calibration_interval_days: 365,
  calibration_provider: '', calibration_cert_no: '', warranty_expiry: '',
  ble_tag_id: '', location_zone: '', last_lat: undefined, last_lng: undefined,
};

const TABS = ['Asset Details', 'Custody', 'Compliance', 'BLE'];

export default function HVAPage() {
  const [items, setItems] = useState<HVA[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<HVA | null>(null);
  const [form, setForm] = useState<Partial<HVA>>({ ...EMPTY_FORM });
  const [tab, setTab] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/assets/hva?tenantId=default');
      const d = await r.json();
      setItems(Array.isArray(d) ? d : d.data ?? []);
    } catch { setError('Failed to load HVA records'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditItem(null); setForm({ ...EMPTY_FORM }); setTab(0); setShowModal(true); };
  const openEdit = (h: HVA) => { setEditItem(h); setForm({ ...h }); setTab(0); setShowModal(true); };

  const F = (key: keyof HVA, label: string, type = 'text') => (
    <div>
      <label className="block text-xs text-[var(--text-muted)] mb-1">{label}</label>
      <input
        type={type}
        value={(form[key] as string | number) ?? ''}
        onChange={e => setForm(p => ({ ...p, [key]: type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))}
        className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)]"
      />
    </div>
  );

  const submit = async () => {
    setSubmitting(true);
    try {
      let res;
      if (editItem) {
        res = await fetch(`/api/assets/hva/${editItem.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, tenantId: 'default' }) });
      } else {
        res = await fetch('/api/assets/hva?tenantId=default', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, tenantId: 'default' }) });
      }
      if (!res.ok) throw new Error();
      showToast(editItem ? 'HVA updated!' : 'HVA created!');
      setShowModal(false); load();
    } catch { showToast('Error saving HVA'); }
    setSubmitting(false);
  };

  if (loading) return (
    <div className="p-8 space-y-4">
      <div className="h-8 bg-[var(--bg-surface)] rounded w-48 animate-pulse" />
      {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-[var(--bg-surface)] rounded animate-pulse" />)}
    </div>
  );

  return (
    <div className="p-8 space-y-5">
      {toast && <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">{toast}</div>}

      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-[var(--text-main)]">High Value Assets</h1><p className="text-[var(--text-muted)] text-sm">Critical asset tracking with compliance monitoring</p></div>
        <button onClick={openAdd} className="bg-yellow-400 hover:bg-yellow-300 text-white font-semibold px-4 py-2 rounded-lg text-sm">+ Add HVA</button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>}

      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-surface)]/50 border-b border-[var(--border-subtle)]">
              <tr className="text-[var(--text-muted)] text-xs uppercase">
                {['Asset No', 'Name', 'Domain', 'Serial #', 'Custodian', 'Condition', 'Calibration Due', 'Insurance Expiry', 'Value AED', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {items.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-[var(--text-faint)]">
                  <div className="text-4xl mb-2">💎</div><p>No high value assets registered yet.</p>
                </td></tr>
              ) : items.map(h => {
                const condBad = h.condition === 'POOR' || h.condition === 'CONDEMNED';
                const insurDays = daysDiff(h.insurance_expiry);
                return (
                  <tr key={h.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="px-4 py-3 text-yellow-300 font-mono text-xs">{h.asset_no}</td>
                    <td className="px-4 py-3 text-[var(--text-main)] font-medium">{h.name}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{h.domain}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)] font-mono text-xs">{h.serial_number ?? '—'}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{h.custodian_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${condBad ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>{h.condition ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3"><CalibBadge date={h.calibration_due_date} /></td>
                    <td className="px-4 py-3">
                      {h.insurance_expiry ? (
                        insurDays !== null && insurDays <= 30
                          ? <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full text-xs">{insurDays}d</span>
                          : <span className="text-[var(--text-muted)] text-xs">{new Date(h.insurance_expiry).toLocaleDateString()}</span>
                      ) : <span className="text-[var(--text-faint)]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-yellow-300 font-medium">{h.current_value_aed?.toLocaleString() ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${h.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border-[var(--border-strong)]'}`}>
                        {h.status ?? 'ACTIVE'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => openEdit(h)} className="text-xs bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] px-2 py-1 rounded">Edit</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)] flex-shrink-0">
              <h2 className="text-[var(--text-main)] font-semibold">{editItem ? 'Edit HVA' : 'Add High Value Asset'}</h2>
              <button onClick={() => setShowModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl">✕</button>
            </div>
            <div className="flex border-b border-[var(--border-subtle)] flex-shrink-0">
              {TABS.map((t, i) => (
                <button key={t} onClick={() => setTab(i)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === i ? 'border-yellow-400 text-yellow-300' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>{t}</button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {tab === 0 && (
                <div className="grid grid-cols-2 gap-4">
                  {F('name', 'Name*')} {F('serial_number', 'Serial Number')}
                  {F('oem_part_number', 'OEM Part #')} {F('manufacturer', 'Manufacturer')}
                  {F('model', 'Model')} {F('year', 'Year', 'number')}
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Domain</label>
                    <select value={form.domain ?? 'GENERAL'} onChange={e => setForm(p => ({ ...p, domain: e.target.value }))} className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)]">
                      {DOMAINS.map(d => <option key={d}>{d}</option>)}
                    </select>
                  </div>
                  {F('category', 'Category')}
                  {F('purchase_date', 'Purchase Date', 'date')} {F('purchase_cost_aed', 'Purchase Cost AED', 'number')}
                  {F('current_value_aed', 'Current Value AED', 'number')}
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">Condition</label>
                    <select value={form.condition ?? 'GOOD'} onChange={e => setForm(p => ({ ...p, condition: e.target.value }))} className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)]">
                      {CONDITIONS.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">{F('notes', 'Notes')}</div>
                </div>
              )}
              {tab === 1 && (
                <div className="grid grid-cols-2 gap-4">
                  {F('custodian_name', 'Custodian Name')} {F('custodian_department', 'Department')}
                  {F('assigned_entity_type', 'Entity Type')} {F('assigned_vehicle_id', 'Vehicle ID')}
                  {F('custody_start_date', 'Custody Start Date', 'date')}
                </div>
              )}
              {tab === 2 && (
                <div className="grid grid-cols-2 gap-4">
                  {F('insurance_policy_no', 'Policy No')} {F('insurance_provider', 'Provider')}
                  {F('insurance_expiry', 'Insurance Expiry', 'date')} {F('insurance_premium_aed', 'Premium AED', 'number')}
                  {F('calibration_due_date', 'Calibration Due', 'date')} {F('last_calibration_date', 'Last Calibrated', 'date')}
                  {F('calibration_interval_days', 'Calibration Interval (days)', 'number')} {F('calibration_provider', 'Calibration Provider')}
                  {F('calibration_cert_no', 'Cert No')} {F('warranty_expiry', 'Warranty Expiry', 'date')}
                </div>
              )}
              {tab === 3 && (
                <div className="grid grid-cols-2 gap-4">
                  {F('ble_tag_id', 'BLE Tag ID')} {F('location_zone', 'Location Zone')}
                  {F('last_lat', 'Last Latitude', 'number')} {F('last_lng', 'Last Longitude', 'number')}
                </div>
              )}
            </div>
            <div className="flex gap-3 justify-end p-5 border-t border-[var(--border-subtle)] flex-shrink-0">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-main)]">Cancel</button>
              <button onClick={submit} disabled={submitting} className="bg-yellow-400 hover:bg-yellow-300 text-white font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50">
                {submitting ? 'Saving...' : editItem ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
