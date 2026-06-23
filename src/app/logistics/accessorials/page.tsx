'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, PackagePlus, Plus, RefreshCcw } from 'lucide-react';
import { KpiCard, KpiGrid, PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';

type SessionMe = { tenantId: string };
type Accessorial = {
  id: string;
  code: string;
  name: string;
  chargeType: string;
  defaultAmount: number | null;
  currency: string;
  taxable: boolean;
  status: string;
};

const emptyForm = {
  code: '',
  name: '',
  chargeType: 'ACCESSORIAL',
  defaultAmount: '',
  currency: 'AED',
  taxable: true,
};

function useTenantQuery(tenantId: string | null) {
  return useCallback((path: string, extra?: Record<string, string | number | null | undefined>) => {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    Object.entries(extra ?? {}).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
    });
    const query = params.toString();
    return `${path}${query ? `?${query}` : ''}`;
  }, [tenantId]);
}

export default function LogisticsAccessorialsPage() {
  const [me, setMe] = useState<SessionMe | null>(null);
  const [accessorials, setAccessorials] = useState<Accessorial[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const tenantId = me?.tenantId ?? null;
  const url = useTenantQuery(tenantId);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accessorials.filter(item => !q || [item.code, item.name, item.chargeType].some(value => value.toLowerCase().includes(q)));
  }, [accessorials, search]);

  const loadSession = useCallback(async () => {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!res.ok) throw new Error('Please sign in before opening accessorials.');
    setMe(await res.json());
  }, []);

  const loadData = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(url('/api/logistics/accessorials', { limit: 200 }), { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setAccessorials(Array.isArray(json.accessorials) ? json.accessorials : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load accessorial catalog');
    } finally {
      setLoading(false);
    }
  }, [tenantId, url]);

  useEffect(() => {
    loadSession().catch(err => {
      setError(err instanceof Error ? err.message : 'Failed to load session');
      setLoading(false);
    });
  }, [loadSession]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const save = useCallback(async () => {
    if (!tenantId) return;
    setSaving(true);
    try {
      const res = await fetch(url('/api/logistics/accessorials'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          tenantId,
          defaultAmount: form.defaultAmount ? Number(form.defaultAmount) : null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setForm(emptyForm);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save accessorial');
    } finally {
      setSaving(false);
    }
  }, [form, loadData, tenantId, url]);

  const defaultTotal = accessorials.reduce((sum, item) => sum + Number(item.defaultAmount ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accessorial Charges"
        subtitle="Tenant-managed fuel, toll, waiting, loading, detention, damage, and special handling charge catalog for freight billing."
        icon={PackagePlus}
        accent="amber"
        actions={<button onClick={loadData} className="btn-secondary inline-flex items-center gap-2"><RefreshCcw className="h-4 w-4" /> Refresh</button>}
      />
      {error && <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm font-semibold text-rose-100">{error}</div>}
      <KpiGrid>
        <KpiCard label="Catalog" value={accessorials.length} icon={PackagePlus} accent="blue" />
        <KpiCard label="Active" value={accessorials.filter(item => item.status === 'ACTIVE').length} icon={Plus} accent="emerald" />
        <KpiCard label="Default Base" value={`AED ${defaultTotal.toLocaleString()}`} icon={BadgeDollarSign} accent="amber" />
      </KpiGrid>

      <Panel title="New Accessorial" icon={Plus} accent="amber">
        <div className="grid gap-3 md:grid-cols-6">
          <input value={form.code} onChange={event => setForm(current => ({ ...current, code: event.target.value }))} placeholder="Code" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none" />
          <input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Name" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none md:col-span-2" />
          <input value={form.chargeType} onChange={event => setForm(current => ({ ...current, chargeType: event.target.value }))} placeholder="Type" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none" />
          <input value={form.defaultAmount} onChange={event => setForm(current => ({ ...current, defaultAmount: event.target.value }))} placeholder="Default amount" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none" />
          <button onClick={save} disabled={saving || !form.code || !form.name} className="btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </Panel>

      <Panel
        title="Accessorial Catalog"
        subtitle={loading ? 'Loading catalog...' : `${filtered.length} charge type(s)`}
        icon={PackagePlus}
        accent="amber"
        actions={<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search charge..." className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none" />}
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.12em] text-slate-400">
              <tr>
                <th className="px-3 py-3">Code</th>
                <th className="px-3 py-3">Name</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Default</th>
                <th className="px-3 py-3">Tax</th>
                <th className="px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <tr key={item.id} className="border-t border-white/8">
                  <td className="px-3 py-4 font-semibold text-white">{item.code}</td>
                  <td className="px-3 py-4 text-slate-300">{item.name}</td>
                  <td className="px-3 py-4 text-slate-300">{item.chargeType}</td>
                  <td className="px-3 py-4 font-semibold text-emerald-300">{item.currency} {Number(item.defaultAmount ?? 0).toLocaleString()}</td>
                  <td className="px-3 py-4 text-slate-300">{item.taxable ? 'Taxable' : 'Non-taxable'}</td>
                  <td className="px-3 py-4"><StatusPill status={item.status === 'ACTIVE' ? 'active' : 'pending'} label={item.status} /></td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && <tr><td colSpan={6} className="px-3 py-12 text-center text-slate-500">No accessorial charges configured.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
