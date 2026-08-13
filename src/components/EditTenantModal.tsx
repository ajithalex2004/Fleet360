'use client';

/**
 * EditTenantModal — minimal-edit modal for an existing tenant.
 *
 * The full create modal has 4 tabs (basic / modules / booking / attachments).
 * This Edit modal is intentionally limited to the fields a platform admin
 * is most likely to need to change: identity, plan, contact, locale, status.
 * Module/booking/attachment edits are still done via the existing
 * /admin/tenants/[id] detail page.
 *
 * PATCH /api/admin/tenants/[id] — partial update; only the changed fields
 * are sent.
 */

import { useState, useEffect } from 'react';

export interface TenantForEdit {
  id: string;
  name: string;
  code: string | null;
  domain: string | null;
  plan: string;
  contactEmail: string | null;
  contactPhone: string | null;
  country: string | null;
  industry: string | null;
  currency: string | null;
  taxRate: number | null;
  supportedLanguages: string[] | null;
  defaultLanguage: string | null;
  isActive: boolean;
}

interface Props {
  tenant: TenantForEdit;
  onDone: () => void;
  onCancel: () => void;
}

const PLAN_OPTIONS = ['TRIAL', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE'];

export function EditTenantModal({ tenant, onDone, onCancel }: Props) {
  const [form, setForm]   = useState<TenantForEdit>(tenant);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setForm(tenant); }, [tenant]);

  const set = <K extends keyof TenantForEdit>(k: K, v: TenantForEdit[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    setSaving(true); setError(null);
    try {
      // Only send fields that differ from the original
      const changed: Record<string, unknown> = {};
      for (const k of Object.keys(tenant) as Array<keyof TenantForEdit>) {
        const before = tenant[k];
        const after  = form[k];
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          changed[k] = after;
        }
      }
      if (Object.keys(changed).length === 0) {
        onCancel();
        return;
      }
      const r = await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changed),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? `Save failed (${r.status})`);
        return;
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 rounded border border-white/10 bg-slate-900 text-white text-sm focus:outline-none focus:border-blue-500';
  const labelCls = 'block text-xs font-medium text-slate-300 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[90vh] bg-slate-900 border border-white/10 rounded-2xl flex flex-col shadow-2xl overflow-hidden">

        <div className="px-6 py-4 border-b border-white/10 flex items-start justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-white">Edit Tenant</h2>
            <p className="text-slate-400 text-xs mt-0.5 font-mono">{tenant.id}</p>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-white text-xl leading-none">✕</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
          {error && (
            <div className="p-3 rounded-lg bg-red-950/40 border border-red-500/30 text-red-300 text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label>
              <span className={labelCls}>Name</span>
              <input className={inputCls} value={form.name}
                onChange={e => set('name', e.target.value)} />
            </label>
            <label>
              <span className={labelCls}>Code</span>
              <input className={inputCls} value={form.code ?? ''}
                onChange={e => set('code', e.target.value || null)}
                placeholder="e.g. XLP, ACME" />
            </label>
            <label>
              <span className={labelCls}>Domain</span>
              <input className={inputCls} value={form.domain ?? ''}
                onChange={e => set('domain', e.target.value || null)}
                placeholder="company.com" />
            </label>
            <label>
              <span className={labelCls}>Plan</span>
              <select className={inputCls} value={form.plan}
                onChange={e => set('plan', e.target.value)}>
                {PLAN_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label>
              <span className={labelCls}>Contact email</span>
              <input className={inputCls} type="email" value={form.contactEmail ?? ''}
                onChange={e => set('contactEmail', e.target.value || null)} />
            </label>
            <label>
              <span className={labelCls}>Contact phone</span>
              <input className={inputCls} value={form.contactPhone ?? ''}
                onChange={e => set('contactPhone', e.target.value || null)} />
            </label>
            <label>
              <span className={labelCls}>Country</span>
              <input className={inputCls} value={form.country ?? ''}
                onChange={e => set('country', e.target.value || null)}
                placeholder="UAE" />
            </label>
            <label>
              <span className={labelCls}>Industry</span>
              <input className={inputCls} value={form.industry ?? ''}
                onChange={e => set('industry', e.target.value || null)} />
            </label>
            <label>
              <span className={labelCls}>Currency</span>
              <input className={inputCls} value={form.currency ?? ''}
                onChange={e => set('currency', e.target.value || null)}
                placeholder="AED" />
            </label>
            <label>
              <span className={labelCls}>Tax rate (%)</span>
              <input className={inputCls} type="number" min={0} max={100} step="0.01"
                value={form.taxRate ?? 0}
                onChange={e => set('taxRate', e.target.value === '' ? null : Number(e.target.value))} />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.isActive}
              onChange={e => set('isActive', e.target.checked)} />
            Active
            <span className="text-xs text-slate-500 ml-2">(uncheck to soft-delete; can be hard-deleted later)</span>
          </label>
        </div>

        <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-2 flex-shrink-0">
          <button onClick={onCancel}
            className="px-4 py-2 text-sm rounded border border-white/10 text-slate-300 hover:bg-white/5">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
