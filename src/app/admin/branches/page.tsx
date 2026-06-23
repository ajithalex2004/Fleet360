'use client';
import React, { useState, useEffect, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────
interface Branch {
  id: string;
  tenant_id: string;
  tenant_name?: string;
  tenant_code?: string;
  tenant_trn?: string;
  branch_name: string;
  emirate: string;
  trade_license_no?: string;
  trade_license_authority?: string;
  trade_license_expiry?: string;
  billing_address?: string;
  billing_city?: string;
  billing_po_box?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  cost_center_code?: string;
  is_default: boolean;
  is_active: boolean;
  invoice_count: number;
  vehicle_count: number;
  notes?: string;
}

interface Tenant {
  id: string;
  name: string;
  code?: string;
  trn?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const EMIRATES = [
  { value: 'ABU_DHABI',      label: 'Abu Dhabi',      flag: '🏛️', authorities: ['ADDED', 'ADCCI', 'ADGM', 'twofour54'] },
  { value: 'DUBAI',          label: 'Dubai',           flag: '🏙️', authorities: ['DED Dubai', 'DIFC', 'JAFZA', 'DAFZA', 'DMCC'] },
  { value: 'SHARJAH',        label: 'Sharjah',         flag: '🕌', authorities: ['Sharjah DED', 'SHAMS', 'SAIF Zone'] },
  { value: 'AJMAN',          label: 'Ajman',           flag: '⛵', authorities: ['Ajman DED', 'Ajman Free Zone'] },
  { value: 'UMM_AL_QUWAIN', label: 'Umm Al Quwain',  flag: '🌿', authorities: ['UAQ DED', 'UAQ Free Trade Zone'] },
  { value: 'RAS_AL_KHAIMAH', label: 'Ras Al Khaimah', flag: '⛰️', authorities: ['RAKEZ', 'RAK DED'] },
  { value: 'FUJAIRAH',       label: 'Fujairah',        flag: '🌊', authorities: ['Fujairah DED', 'FFZA'] },
];
const EMIRATE_MAP = Object.fromEntries(EMIRATES.map(e => [e.value, e]));

const EMPTY_FORM = {
  tenantId: '', branchName: '', emirate: 'DUBAI',
  tradeLicenseNo: '', tradeLicenseAuthority: 'DED Dubai', tradeLicenseExpiry: '',
  billingAddress: '', billingCity: '', billingPoBox: '',
  contactName: '', contactEmail: '', contactPhone: '',
  costCenterCode: '', isDefault: false, notes: '',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function daysUntilExpiry(dateStr?: string): number | null {
  if (!dateStr) return null;
  return Math.floor((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function ExpiryBadge({ dateStr }: { dateStr?: string }) {
  const days = daysUntilExpiry(dateStr);
  if (days === null) return <span className="text-slate-600 text-xs">—</span>;
  if (days < 0) return <span className="text-xs bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">Expired {Math.abs(days)}d ago</span>;
  if (days < 30) return <span className="text-xs bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">Expires in {days}d</span>;
  if (days < 90) return <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">Expires in {days}d</span>;
  return <span className="text-xs text-slate-400">{new Date(dateStr ?? '').toLocaleDateString('en-AE')}</span>;
}

// ── Reusable field — defined OUTSIDE modal so it never gets recreated on render
function Field({ label, name, type = 'text', placeholder = '', required = false, value, onChange, children }: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  value?: string;
  onChange?: (name: string, value: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-slate-300 text-xs font-medium mb-1.5">{label}{required && ' *'}</label>
      {children ?? (
        <input
          type={type}
          value={value ?? ''}
          placeholder={placeholder}
          onChange={e => onChange?.(name, e.target.value)}
          className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
        />
      )}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function BranchModal({
  branch, tenants, onClose, onSaved
}: {
  branch: Branch | null;
  tenants: Tenant[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!branch;
  const [form, setForm] = useState(isEdit ? {
    tenantId: branch.tenant_id,
    branchName: branch.branch_name,
    emirate: branch.emirate,
    tradeLicenseNo: branch.trade_license_no ?? '',
    tradeLicenseAuthority: branch.trade_license_authority ?? '',
    tradeLicenseExpiry: branch.trade_license_expiry ?? '',
    billingAddress: branch.billing_address ?? '',
    billingCity: branch.billing_city ?? '',
    billingPoBox: branch.billing_po_box ?? '',
    contactName: branch.contact_name ?? '',
    contactEmail: branch.contact_email ?? '',
    contactPhone: branch.contact_phone ?? '',
    costCenterCode: branch.cost_center_code ?? '',
    isDefault: branch.is_default,
    notes: branch.notes ?? '',
  } : { ...EMPTY_FORM });

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const emirateAuthorities = EMIRATE_MAP[form.emirate]?.authorities ?? [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.tenantId)   return setError('Please select a tenant');
    if (!form.branchName) return setError('Branch name is required');
    setSaving(true);
    try {
      const url  = '/api/tenant-branches';
      const method = isEdit ? 'PATCH' : 'POST';
      const body = isEdit ? { ...form, id: branch!.id } : form;
      const res  = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? d.detail ?? `Server error (${res.status}) — please try again`);
      } else {
        onSaved();
        onClose();
      }
    } catch { setError('Network error'); }
    finally { setSaving(false); }
  };

  const handleField = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="text-white font-bold text-lg">{isEdit ? 'Edit Branch' : 'Add New Branch'}</h2>
            <p className="text-slate-400 text-xs mt-0.5">Multi-emirate branch under a single TRN</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl transition-colors">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-300 text-sm">{error}</div>
          )}

          {/* Tenant */}
          <div>
            <label className="block text-slate-300 text-xs font-medium mb-1.5">Tenant *</label>
            <select
              value={form.tenantId}
              onChange={e => setForm(f => ({ ...f, tenantId: e.target.value }))}
              disabled={isEdit}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500/50 disabled:opacity-60"
            >
              <option value="">Select a tenant…</option>
              {tenants.map(t => (
                <option key={t.id} value={t.id}>{t.name}{t.code ? ` (${t.code})` : ''}</option>
              ))}
            </select>
            {form.tenantId && (
              <p className="text-slate-600 text-xs mt-1">
                TRN: {tenants.find(t => t.id === form.tenantId)?.trn ?? '—'} · Shared across all branches
              </p>
            )}
          </div>

          {/* Branch name + emirate */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Branch Name" name="branchName" placeholder="Abu Dhabi Branch" required value={form.branchName} onChange={handleField} />
            <div>
              <label className="block text-slate-300 text-xs font-medium mb-1.5">Emirate *</label>
              <select
                value={form.emirate}
                onChange={e => setForm(f => ({ ...f, emirate: e.target.value, tradeLicenseAuthority: EMIRATE_MAP[e.target.value]?.authorities[0] ?? '' }))}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500/50"
              >
                {EMIRATES.map(em => (
                  <option key={em.value} value={em.value}>{em.flag} {em.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Trade License section */}
          <div className="bg-slate-800/40 border border-amber-500/10 rounded-xl p-4 space-y-4">
            <p className="text-amber-400 text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5">
              📜 Trade License (Emirate-specific)
            </p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Trade License Number" name="tradeLicenseNo" placeholder="CN-1234567" value={form.tradeLicenseNo} onChange={handleField} />
              <div>
                <label className="block text-slate-300 text-xs font-medium mb-1.5">Issuing Authority</label>
                <select
                  value={form.tradeLicenseAuthority}
                  onChange={e => setForm(f => ({ ...f, tradeLicenseAuthority: e.target.value }))}
                  className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                >
                  {emirateAuthorities.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <Field label="Trade License Expiry" name="tradeLicenseExpiry" type="date" value={form.tradeLicenseExpiry} onChange={handleField} />
              <Field label="Cost Center Code" name="costCenterCode" placeholder="CC-AUH / CC-DXB" value={form.costCenterCode} onChange={handleField} />
            </div>
          </div>

          {/* Billing address */}
          <div className="space-y-3">
            <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide">Billing Address (appears on invoices)</p>
            <Field label="Street Address" name="billingAddress" placeholder="Al Khalidiyah Street" value={form.billingAddress} onChange={handleField} />
            <div className="grid grid-cols-2 gap-4">
              <Field label="City" name="billingCity" placeholder="Abu Dhabi" value={form.billingCity} onChange={handleField} />
              <Field label="P.O. Box" name="billingPoBox" placeholder="12345" value={form.billingPoBox} onChange={handleField} />
            </div>
          </div>

          {/* Contact */}
          <div className="space-y-3">
            <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide">Branch Contact</p>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Contact Name" name="contactName" placeholder="Branch Manager" value={form.contactName} onChange={handleField} />
              <Field label="Email" name="contactEmail" type="email" placeholder="ops@branch.ae" value={form.contactEmail} onChange={handleField} />
              <Field label="Phone" name="contactPhone" placeholder="+971 2 XXX XXXX" value={form.contactPhone} onChange={handleField} />
            </div>
          </div>

          {/* Flags */}
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))}
                className="w-4 h-4 rounded accent-emerald-500"
              />
              <span className="text-slate-300 text-sm">Set as head-office / default branch</span>
            </label>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-slate-300 text-xs font-medium mb-1.5">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder="Any internal notes about this branch…"
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500/50 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/10">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-slate-300 text-sm hover:text-white transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors disabled:opacity-60">
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Branch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Delete Confirmation Modal ─────────────────────────────────────────────────
function DeleteConfirmModal({
  branch, onCancel, onConfirm, deleting, error,
}: {
  branch: Branch;
  onCancel: () => void;
  onConfirm: () => void;
  deleting: boolean;
  error?: string;
}) {
  const em = EMIRATE_MAP[branch.emirate];
  const hasLinkedData = (branch.invoice_count ?? 0) > 0 || (branch.vehicle_count ?? 0) > 0;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-red-500/30 rounded-2xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-white/10">
          <div className="w-10 h-10 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center flex-shrink-0">
            <span className="text-lg">⚠️</span>
          </div>
          <div>
            <h2 className="text-white font-bold text-base">Delete Branch</h2>
            <p className="text-slate-400 text-xs mt-0.5">This action cannot be undone</p>
          </div>
        </div>

        {/* Branch summary */}
        <div className="px-6 py-5 space-y-4">
          <div className="bg-slate-800/60 border border-white/10 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-2xl">{em?.flag ?? '🏢'}</span>
            <div>
              <p className="text-white font-semibold text-sm">{branch.branch_name}</p>
              <p className="text-slate-400 text-xs">{branch.tenant_name} · {em?.label ?? branch.emirate}</p>
              {branch.trade_license_no && (
                <p className="text-slate-500 text-xs font-mono mt-0.5">TL: {branch.trade_license_no}</p>
              )}
            </div>
          </div>

          {/* Impact warning */}
          {hasLinkedData ? (
            <div className="bg-amber-500/8 border border-amber-500/25 rounded-xl px-4 py-3 space-y-2">
              <p className="text-amber-300 text-xs font-semibold flex items-center gap-1.5">
                🔗 Linked records will be affected
              </p>
              <ul className="text-slate-400 text-xs space-y-1 ml-1">
                {(branch.invoice_count ?? 0) > 0 && (
                  <li>• {branch.invoice_count} invoice{branch.invoice_count !== 1 ? 's' : ''} linked to this branch</li>
                )}
                {(branch.vehicle_count ?? 0) > 0 && (
                  <li>• {branch.vehicle_count} vehicle{branch.vehicle_count !== 1 ? 's' : ''} assigned to this branch</li>
                )}
                <li className="text-slate-500 pt-0.5">These records will remain but lose their branch association.</li>
              </ul>
            </div>
          ) : (
            <div className="bg-slate-800/40 border border-white/8 rounded-xl px-4 py-3">
              <p className="text-slate-400 text-xs">No invoices or vehicles are linked to this branch.</p>
            </div>
          )}

          <p className="text-slate-400 text-sm">
            Are you sure you want to permanently delete{' '}
            <span className="text-white font-medium">{branch.branch_name}</span>?
          </p>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-300 text-sm">
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="px-5 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-slate-300 text-sm hover:text-white transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {deleting ? (
              <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> Deleting…</>
            ) : (
              '🗑️ Delete Branch'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BranchesPage() {
  const [branches,  setBranches]  = useState<Branch[]>([]);
  const [tenants,   setTenants]   = useState<Tenant[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter,    setFilter]    = useState({ tenantId: '', emirate: '', search: '' });
  const [modal,     setModal]     = useState<{ open: boolean; branch: Branch | null }>({ open: false, branch: null });
  const [deleting,     setDeleting]     = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null);
  const [deleteError,  setDeleteError]  = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams();
      if (filter.tenantId) params.set('tenantId', filter.tenantId);
      if (filter.emirate)  params.set('emirate',  filter.emirate);
      params.set('includeInactive', 'true');

      const [bRes, tRes] = await Promise.all([
        fetch(`/api/tenant-branches?${params}`, { cache: 'no-store' }),
        fetch('/api/admin/tenants?limit=200',   { cache: 'no-store' }),
      ]);
      const [bData, tData] = await Promise.all([bRes.json(), tRes.json()]);
      if (!bRes.ok) throw new Error(bData.error ?? bData.detail ?? `Failed to load branches (${bRes.status})`);
      if (!tRes.ok) throw new Error(tData.error ?? tData.detail ?? `Failed to load tenants (${tRes.status})`);
      setBranches(bData.data ?? []);
      setTenants(Array.isArray(tData) ? tData : (tData.data ?? []));
    } catch (err) {
      setBranches([]);
      setLoadError(err instanceof Error ? err.message : 'Failed to load branches');
    }
    finally { setLoading(false); }
  }, [filter.tenantId, filter.emirate]);

  useEffect(() => { load(); }, [load]);

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(deleteTarget.id);
    setDeleteError('');
    try {
      const res = await fetch('/api/tenant-branches', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteTarget.id }),
        cache: 'no-store',
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setDeleteError(d.error ?? d.detail ?? `Delete failed (${res.status})`);
        return;
      }
      // Remove instantly from local state — no waiting for refetch
      setBranches(prev => prev.filter(b => b.id !== deleteTarget.id));
      setDeleteTarget(null);
      // Then background-refresh to get updated counts etc.
      load();
    } catch {
      setDeleteError('Network error — please try again');
    } finally {
      setDeleting(null);
    }
  };

  const filtered = branches.filter(b => {
    if (!filter.search) return true;
    const q = filter.search.toLowerCase();
    return (
      b.branch_name.toLowerCase().includes(q) ||
      (b.tenant_name ?? '').toLowerCase().includes(q) ||
      (b.trade_license_no ?? '').toLowerCase().includes(q) ||
      (b.emirate ?? '').toLowerCase().includes(q)
    );
  });

  // Summary stats
  const statsByEmirate = EMIRATES.map(em => ({
    ...em,
    count: branches.filter(b => b.emirate === em.value && b.is_active).length,
  })).filter(e => e.count > 0);

  const expiringSoon = branches.filter(b => {
    const d = daysUntilExpiry(b.trade_license_expiry);
    return d !== null && d >= 0 && d < 90;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Branch Management</h1>
          <p className="text-slate-400 text-sm mt-1">
            Multi-emirate branches per tenant · Separate trade licenses · Single TRN per company
          </p>
        </div>
        <button
          onClick={() => setModal({ open: true, branch: null })}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
        >
          + Add Branch
        </button>
      </div>

      {/* UAE TRN explanation */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
        <span className="text-xl flex-shrink-0">🇦🇪</span>
        <div>
          <p className="text-amber-300 font-medium text-sm">UAE Multi-Branch Architecture</p>
          <p className="text-slate-400 text-xs mt-1 leading-relaxed">
            The <strong className="text-white">TRN</strong> (Tax Registration Number) is a single federal number issued by FTA — shared across all emirates.
            Each emirate has its own <strong className="text-white">Trade License</strong> (DED Dubai, ADDED Abu Dhabi, etc.).
            Invoices display the branch trade license and address, while VAT is consolidated under the single TRN for FTA filing.
          </p>
        </div>
      </div>

      {/* Expiry alerts */}
      {expiringSoon.length > 0 && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4">
          <p className="text-red-400 font-semibold text-sm mb-3 flex items-center gap-2">
            ⚠️ Trade License Alerts ({expiringSoon.length})
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {expiringSoon.map(b => (
              <div key={b.id} className="flex items-center justify-between bg-slate-900/60 border border-red-500/10 rounded-xl px-4 py-2">
                <div>
                  <p className="text-white text-sm font-medium">{b.branch_name}</p>
                  <p className="text-slate-500 text-xs">{b.tenant_name} · {b.trade_license_authority}</p>
                </div>
                <ExpiryBadge dateStr={b.trade_license_expiry} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats by emirate */}
      {statsByEmirate.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {statsByEmirate.map(em => (
            <div key={em.value} className="flex items-center gap-2 bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5">
              <span className="text-lg">{em.flag}</span>
              <div>
                <p className="text-white text-sm font-semibold">{em.label}</p>
                <p className="text-slate-500 text-xs">{em.count} branch{em.count !== 1 ? 'es' : ''}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      {loadError && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {loadError}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <input
          type="text"
          placeholder="Search branches, tenants, license…"
          value={filter.search}
          onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
          className="flex-1 min-w-48 bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500/40"
        />
        <select
          value={filter.tenantId}
          onChange={e => setFilter(f => ({ ...f, tenantId: e.target.value }))}
          className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none"
        >
          <option value="">All Tenants</option>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select
          value={filter.emirate}
          onChange={e => setFilter(f => ({ ...f, emirate: e.target.value }))}
          className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none"
        >
          <option value="">All Emirates</option>
          {EMIRATES.map(em => <option key={em.value} value={em.value}>{em.flag} {em.label}</option>)}
        </select>
        {(filter.tenantId || filter.emirate || filter.search) && (
          <button
            onClick={() => setFilter({ tenantId: '', emirate: '', search: '' })}
            className="text-slate-400 hover:text-white text-sm px-3 py-2 rounded-xl bg-slate-800 border border-white/10 transition-colors whitespace-nowrap"
          >
            ✕ Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-white font-semibold">
            All Branches <span className="text-slate-500 font-normal ml-2 text-sm">({filtered.length})</span>
          </h2>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500 text-sm">Loading branches…</div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center">
            <p className="text-4xl mb-3">🏢</p>
            {(filter.tenantId || filter.emirate || filter.search) ? (
              <>
                <p className="text-white font-medium">No branches match your filters</p>
                <p className="text-slate-500 text-sm mt-1">Try changing the emirate or tenant filter, or clear all filters</p>
                <button onClick={() => setFilter({ tenantId: '', emirate: '', search: '' })} className="mt-4 text-emerald-400 text-sm hover:text-emerald-300 transition-colors">✕ Clear filters →</button>
              </>
            ) : (
              <>
                <p className="text-white font-medium">No branches yet</p>
                <p className="text-slate-500 text-sm mt-1">Add your first branch to get started</p>
                <button onClick={() => setModal({ open: true, branch: null })} className="mt-4 text-emerald-400 text-sm hover:text-emerald-300 transition-colors">+ Add Branch →</button>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/50 text-xs text-slate-400">
                  <th className="text-left px-6 py-3">Branch</th>
                  <th className="text-left px-4 py-3">Tenant / TRN</th>
                  <th className="text-left px-4 py-3">Emirate</th>
                  <th className="text-left px-4 py-3">Trade License</th>
                  <th className="text-left px-4 py-3">Expiry</th>
                  <th className="text-left px-4 py-3">Cost Center</th>
                  <th className="text-right px-4 py-3">Invoices</th>
                  <th className="text-right px-4 py-3">Vehicles</th>
                  <th className="text-center px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map(b => {
                  const em = EMIRATE_MAP[b.emirate];
                  return (
                    <tr key={b.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2.5">
                          <span className="text-lg">{em?.flag ?? '🏢'}</span>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <p className="text-white font-medium">{b.branch_name}</p>
                              {b.is_default && (
                                <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded-full">HQ</span>
                              )}
                            </div>
                            {b.contact_email && <p className="text-slate-500 text-xs">{b.contact_email}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-slate-300 text-sm">{b.tenant_name ?? '—'}</p>
                        {b.tenant_trn && <p className="text-slate-600 text-xs font-mono">TRN: {b.tenant_trn}</p>}
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-slate-300 text-sm">{em?.label ?? b.emirate}</span>
                        {b.trade_license_authority && <p className="text-slate-600 text-xs">{b.trade_license_authority}</p>}
                      </td>
                      <td className="px-4 py-4">
                        {b.trade_license_no
                          ? <span className="font-mono text-sm text-slate-300">{b.trade_license_no}</span>
                          : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-4">
                        <ExpiryBadge dateStr={b.trade_license_expiry} />
                      </td>
                      <td className="px-4 py-4">
                        {b.cost_center_code
                          ? <span className="font-mono text-xs bg-slate-800 border border-white/10 text-slate-300 px-2 py-1 rounded">{b.cost_center_code}</span>
                          : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-4 text-right text-slate-300">{b.invoice_count}</td>
                      <td className="px-4 py-4 text-right text-slate-300">{b.vehicle_count}</td>
                      <td className="px-4 py-4 text-center">
                        {b.is_active
                          ? <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">Active</span>
                          : <span className="text-xs bg-slate-700/60 text-slate-500 border border-white/10 px-2 py-0.5 rounded-full">Inactive</span>}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={() => setModal({ open: true, branch: b })}
                            className="text-xs text-slate-400 hover:text-white bg-slate-800 border border-white/10 px-3 py-1.5 rounded-lg transition-colors"
                          >Edit</button>
                          <button
                            onClick={() => setDeleteTarget(b)}
                            disabled={deleting === b.id}
                            className="text-xs text-red-400 hover:text-red-300 bg-red-500/5 border border-red-500/20 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                          >{deleting === b.id ? '…' : '🗑️ Delete'}</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      {modal.open && (
        <BranchModal
          branch={modal.branch}
          tenants={tenants}
          onClose={() => setModal({ open: false, branch: null })}
          onSaved={load}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <DeleteConfirmModal
          branch={deleteTarget}
          deleting={deleting === deleteTarget.id}
          error={deleteError}
          onCancel={() => { setDeleteTarget(null); setDeleteError(''); }}
          onConfirm={handleDeleteConfirm}
        />
      )}
    </div>
  );
}
