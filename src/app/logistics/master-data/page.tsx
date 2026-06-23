'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, Plus, RefreshCcw, Search, Trash2 } from 'lucide-react';
import { PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';

type SessionMe = { tenantId: string; userId?: string };
type MasterItem = {
  id: string;
  type: string;
  code: string;
  label: string;
  description: string | null;
  status: string;
  sortOrder: number;
  updatedAt: string | null;
};

const MASTER_TYPES = [
  'SERVICE_TYPE',
  'SHIPPER',
  'CUSTOMER',
  'PICKUP_LOCATION',
  'COUNTRY',
  'AIRPORT',
  'AIRLINE',
  'AGENT',
];

const emptyForm = {
  type: 'SERVICE_TYPE',
  code: '',
  label: '',
  description: '',
  status: 'ACTIVE',
  sortOrder: '10',
};

function withTenant(path: string, tenantId: string | null, extra?: Record<string, string | number | null | undefined>) {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);
  Object.entries(extra ?? {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
  });
  const query = params.toString();
  return `${path}${query ? `?${query}` : ''}`;
}

export default function LogisticsMasterDataPage() {
  const [me, setMe] = useState<SessionMe | null>(null);
  const [items, setItems] = useState<MasterItem[]>([]);
  const [type, setType] = useState('SERVICE_TYPE');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const tenantId = me?.tenantId ?? null;

  const groupedCounts = useMemo(() => {
    return items.reduce<Record<string, number>>((acc, item) => {
      acc[item.type] = (acc[item.type] ?? 0) + 1;
      return acc;
    }, {});
  }, [items]);

  const loadSession = useCallback(async () => {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!res.ok) throw new Error('Please sign in before opening Logistics master data.');
    setMe(await res.json());
  }, []);

  const loadData = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(withTenant('/api/logistics/master-data', tenantId, { type, search }), { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const payload = await res.json();
      setItems(payload.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load master data');
    } finally {
      setLoading(false);
    }
  }, [search, tenantId, type]);

  useEffect(() => {
    loadSession().catch(err => {
      setError(err instanceof Error ? err.message : 'Failed to load session');
      setLoading(false);
    });
  }, [loadSession]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function saveItem() {
    if (!tenantId) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(withTenant('/api/logistics/master-data', tenantId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          sortOrder: Number(form.sortOrder || 0),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setForm({ ...emptyForm, type });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save master data');
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(id: string) {
    if (!tenantId) return;
    setError('');
    try {
      const res = await fetch(withTenant('/api/logistics/master-data', tenantId, { id }), { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove master data');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logistics Master Data"
        subtitle="Controlled dropdown values for shipment operations: service types, shippers, locations, countries, airports, airlines, agents, and customers."
        icon={Database}
        accent="amber"
        actions={(
          <button onClick={loadData} className="btn-secondary inline-flex items-center gap-2">
            <RefreshCcw className="h-4 w-4" /> Refresh
          </button>
        )}
      />

      {error && <div className="rounded-2xl border border-rose-300 bg-rose-100 px-4 py-3 text-sm font-semibold text-rose-900">{error}</div>}

      <Panel title="Master Types" icon={Database} accent="amber">
        <div className="flex flex-wrap gap-2">
          {MASTER_TYPES.map(item => (
            <button
              key={item}
              onClick={() => {
                setType(item);
                setForm(prev => ({ ...prev, type: item }));
              }}
              className={`rounded-full border px-3 py-2 text-xs font-semibold ${type === item ? 'border-amber-300 bg-amber-100 text-amber-900' : 'border-white/10 bg-white/5 text-[color:var(--text-secondary)]'}`}
            >
              {item.replace(/_/g, ' ')} ({groupedCounts[item] ?? 0})
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Panel title="Add / Update Value" subtitle="Codes are normalized and unique per tenant and type." icon={Plus} accent="emerald">
          <div className="grid gap-3">
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">Type</label>
            <select value={form.type} onChange={e => setForm(prev => ({ ...prev, type: e.target.value }))} className="rounded-xl border border-white/10 bg-[color:var(--app-card)] px-3 py-2 text-[color:var(--text-primary)]">
              {MASTER_TYPES.map(item => <option key={item} value={item}>{item.replace(/_/g, ' ')}</option>)}
            </select>
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">Code</label>
            <input value={form.code} onChange={e => setForm(prev => ({ ...prev, code: e.target.value }))} placeholder="e.g. DXB_WH" className="rounded-xl border border-white/10 bg-[color:var(--app-card)] px-3 py-2 text-[color:var(--text-primary)]" />
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">Label</label>
            <input value={form.label} onChange={e => setForm(prev => ({ ...prev, label: e.target.value }))} placeholder="Visible dropdown label" className="rounded-xl border border-white/10 bg-[color:var(--app-card)] px-3 py-2 text-[color:var(--text-primary)]" />
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">Description</label>
            <textarea value={form.description} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} rows={3} className="rounded-xl border border-white/10 bg-[color:var(--app-card)] px-3 py-2 text-[color:var(--text-primary)]" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">Status</label>
                <select value={form.status} onChange={e => setForm(prev => ({ ...prev, status: e.target.value }))} className="mt-1 w-full rounded-xl border border-white/10 bg-[color:var(--app-card)] px-3 py-2 text-[color:var(--text-primary)]">
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">Sort</label>
                <input value={form.sortOrder} onChange={e => setForm(prev => ({ ...prev, sortOrder: e.target.value }))} type="number" className="mt-1 w-full rounded-xl border border-white/10 bg-[color:var(--app-card)] px-3 py-2 text-[color:var(--text-primary)]" />
              </div>
            </div>
            <button onClick={saveItem} disabled={saving} className="btn-primary mt-2 inline-flex items-center justify-center gap-2">
              <Plus className="h-4 w-4" /> {saving ? 'Saving...' : 'Save master value'}
            </button>
          </div>
        </Panel>

        <Panel
          title="Configured Values"
          subtitle={loading ? 'Loading values...' : `${items.length} value(s) for ${type.replace(/_/g, ' ')}`}
          icon={Search}
          accent="blue"
          actions={(
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search code, label, description"
              className="w-72 rounded-xl border border-white/10 bg-[color:var(--app-card)] px-3 py-2 text-sm text-[color:var(--text-primary)]"
            />
          )}
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-white/10 text-xs uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">
                <tr>
                  <th className="px-3 py-3">Code</th>
                  <th className="px-3 py-3">Label</th>
                  <th className="px-3 py-3">Description</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Sort</th>
                  <th className="px-3 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className="border-b border-white/6">
                    <td className="px-3 py-3 font-mono text-xs text-[color:var(--text-primary)]">{item.code}</td>
                    <td className="px-3 py-3 font-semibold text-[color:var(--text-primary)]">{item.label}</td>
                    <td className="px-3 py-3 text-[color:var(--text-secondary)]">{item.description ?? '-'}</td>
                    <td className="px-3 py-3"><StatusPill status={item.status} /></td>
                    <td className="px-3 py-3 text-[color:var(--text-secondary)]">{item.sortOrder}</td>
                    <td className="px-3 py-3 text-right">
                      <button onClick={() => removeItem(item.id)} className="btn-danger inline-flex items-center gap-1 px-3 py-1.5 text-xs">
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {!loading && items.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-10 text-center text-[color:var(--text-secondary)]">No values found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
